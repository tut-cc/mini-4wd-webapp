# 通信プロトコル・インターフェース仕様書

本ドキュメントでは、WebApp と 車載マイコン間で送受信される通信データのフォーマット、Heartbeat、各種タイムアウト閾値、および状態不一致時の安全判定ルールについて定義します。

## 1. 通信方式の概要
- **WebApp画面配信**: HTTP GET（`index.html`, `js/*.js`, `style.css` 等をマイコンから直接配信）
- **制御・テレメトリ通信**: WebSocket（双方向 / テキスト形式 JSON）
- **通信周期**: 10 Hzで双方向定期通信
- **ポート統合**: 同一ポート（デフォルト: `8765`）で HTTP静的配信 と WebSocket制御 を同時に提供

## 2. データフォーマット仕様

### 2.1 WebApp → マイコン（操作コマンド）

WebAppは、自身が現在認識しているモード `client_mode` を付与してコマンドを送信します。マイコン側はこの値と実際の内部状態を照合して実行可否を判定します。

```json
{
  "client_mode": "MANUAL",
  "throttle": 1.0,
  "steering": -0.5,
  "mode_request": "NONE",
  "manual_abort_request": false,
  "reset_abort_request": false
}
```

| フィールド名 | 型 / 取り得る値 | 必須 | 内容・説明 |
|---|---|---|---|
| `client_mode` | `MANUAL` / `AUTO` / `AUTO_ABORT` / `MANUAL_ABORT` | ○ | WebAppが認識している現在モード |
| `throttle` | 数値 `-1.0 〜 1.0` | ○ | 前後スロットル指示（正: 前進、負: 後退、0: 停止） |
| `steering` | 数値 `-1.0 〜 1.0` | ○ | 左右ステアリング指示（負: 左、正: 右、0: 直進） |
| `mode_request` | `NONE` / `MANUAL` / `AUTO` | ○ | 運転モード切替要求（切替時以外は `NONE`） |
| `manual_abort_request` | `true` / `false` | ○ | 手動中断要求（最優先処理）※旧 `emergency_stop_request` 互換 |
| `reset_abort_request` | `true` / `false` | ○ | AUTO_ABORT / MANUAL_ABORT の解除・リセット要求 ※旧 `reset_stop_request` 互換 |

### 2.2 マイコン → WebApp（Heartbeat）

マイコンは100ms周期で自身の最新状態を送信します。

```json
{
  "mode": "AUTO",
  "front_distance_mm": 450,
  "tor_active": true,
  "tor_remaining_ms": 3500,
  "stop_reason": "NONE",
  "request_reject_reason": "NONE"
}
```

| フィールド名 | 型 / 取り得る値 | 内容 |
|---|---|---|
| `mode` | `MANUAL` / `AUTO` / `AUTO_ABORT` / `MANUAL_ABORT` | マイコンの確定現在モード |
| `front_distance_mm` | 整数 (mm) | 前方測距センサーの値 |
| `tor_active` | `true` / `false` | TOR（運転引継ぎ要求）発生中フラグ |
| `tor_remaining_ms` | 整数 (ms) | TOR残り猶予時間（通常時は `0`） |
| `stop_reason` | 列挙型（後述） | 中断（自動中断・手動中断）の要因 |
| `request_reject_reason` | 列挙型（後述） | モード切替や復帰要求が拒否された理由 |

#### `stop_reason`（中断要因）の定義
- `NONE`: 中断なし（正常）
- `OBSTACLE`: 前方障害物検知（AUTO_ABORT）
- `TOR_TIMEOUT`: TOR猶予時間切れ（AUTO_ABORT）
- `MANUAL_ABORT_BUTTON`: WebAppまたは車体からの手動中断ボタン押下（MANUAL_ABORT）
- `COMM_TIMEOUT`: 通信途絶による自律中断（AUTO_ABORT）
- `SENSOR_ERROR`: 測距センサやカメラ等の異常検知（AUTO_ABORT）

#### `request_reject_reason`（要求拒否理由）の定義
- `NONE`: 拒否なし（正常受諾）
- `SENSOR_NOT_READY`: センサが初期化中または値が不安定
- `OBSTACLE_NEAR`: 前方に障害物があるためAUTO切替不可
- `IN_TOR`: TOR中のためAUTO切替等の要求を拒否
- `IN_MANUAL_ABORT`: 手動中断中のため走行・切替要求を拒否
- `MODE_MISMATCH`: WebAppの認識モードと実状態が不一致のため拒否

### 2.3 TOR（Take Over Request）の表現ルール

```text
通常AUTO時:
  mode = "AUTO"
  tor_active = false
  tor_remaining_ms = 0

TOR発生時 (AUTO_TOR):
  mode = "AUTO"
  tor_active = true
  tor_remaining_ms = 3500
```

WebAppは `tor_active: true` を受信した際に、UI内部で `AUTO_TOR` 状態として扱い、警告オーバーレイを表示します。

## 3. タイムアウト & 定常通信パラメータ一覧

| パラメータ名 | 閾値 / 周期 | 監視主体 | 説明・タイムアウト時の動作 |
|---|---|---|---|
| **Heartbeat 送信周期** | `100 ms` | マイコン | マイコンからWebAppへの定期状態通知 |
| **操作コマンド送信周期** | `100 ms` | WebApp | キー押下中または値変更時の送信周期 |
| **デッドマンタイマー** | `300 ms` | マイコン | 操作コマンドが途絶えた場合にモーターを自動停止 |
| **Pending タイムアウト** | `1,000 ms` | WebApp | モード切替要求後、マイコンの状態が変わらない場合に要求失敗と判定 |
| **通信切断判定** | `1,500 ms` | WebApp / マイコン | Heartbeat途絶で `DISCONNECTED` 遷移、マイコンは `AUTO_ABORT` |
| **TOR 猶予時間** | `3,000 〜 5,000 ms` | マイコン | カウントダウンが0に達した場合、マイコンが `AUTO_ABORT` へ自律遷移 |

## 4. モード不一致時の安全判定マトリクス

WebAppの認識しているモード（`client_mode`）とマイコンの実際のモード（`mode`）が不一致である場合、マイコンは以下のルールで操作の受容または破棄を判定します。

- **安全側操作（手動中断・スロットル0・手動介入）は不一致でも即時実行する**
- **危険な操作（中断中・自律走行中の走行指示）は破棄して誤発進・衝突を防ぐ**

| マイコンの現在状態 | WebApp認識 (`client_mode`) | 送信された操作・要求 | 判定 | 動作内容 |
|---|---|---|---|---|
| **任意** | 任意 | `manual_abort_request: true` | **即時実行** | 最優先で全出力を遮断し `MANUAL_ABORT` |
| **任意** | 任意 | `throttle: 0.0` (停止指示) | **実行** | 安全側操作のため受容し停止 |
| **AUTO** (TOR中含む) | 任意 | `mode_request: MANUAL` | **実行** | 手動介入として即座に `MANUAL` へ遷移 |
| **AUTO_ABORT** | MANUAL | `throttle != 0.0` (走行指示) | **破棄** | 誤発進防止のため無視し、最新状態を返信 |
| **MANUAL_ABORT** | MANUAL | `throttle != 0.0` (走行指示) | **破棄** | 中断中のため無視し、最新状態を返信 |
| **AUTO** (走行中) | MANUAL | `throttle != 0.0` (走行指示) | **破棄** | 自律制御優先のため手動操作を破棄 |
| **AUTO_ABORT** | MANUAL | `mode_request: AUTO` | **拒否** | 中断状態からのAUTO直行は拒否（要リセット） |
| **AUTO_ABORT** / **MANUAL_ABORT** | AUTO_ABORT / MANUAL_ABORT | `reset_abort_request: true` | **安全確認後実行** | 障害物がクリアであれば `MANUAL` へ復帰 |
