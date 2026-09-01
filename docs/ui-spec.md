# WebApp UI仕様・画面遷移設計書

本ドキュメントでは、ミニ四駆自動運転 WebApp（FPV Cockpit - Minimal Monochrome）の画面構成、UI状態遷移、モバイル操作入力仕様（ブラインドタッチ操作）、および各モードにおける操作可否マトリクスについて定義します。

---

## 1. 画面レイアウトコンセプト（モバイル & モノクロミニマルHUD）

スマートフォン操作を前提とし、**「画面のほぼ100%がラジコンのカメラ映像（FPV）」「操作UIは装飾を最小限に抑えた極薄モノクロHUD（白・黒・グレーのみ）」「画面を見ずに親指の感覚だけで操作できる（ブラインドタッチ）」** 設計を採用しています。

```mermaid
flowchart TB
    subgraph Viewport["スマートフォン全画面 (100vw × 100dvh)"]
        subgraph Layer1["【最背面】ラジコン車載カメラ映像 (FPV Layer)"]
            L1["リアルタイムカメラ映像 (MJPEG) / FPVシミュレータ (モノクロワイヤーフレーム)"]
        end
        subgraph Layer2["【操作層】インビジブル・ブラインドタッチゾーン (Touch Layer)"]
            L2A["👈 左親指ゾーン: スロットル (前後スワイプ)"]
            L2B["👉 右親指ゾーン: ステアリング (左右スワイプ)"]
        end
        subgraph Layer3["【最前面】極薄モノクロHUDオーバーレイ (HUD Overlay Layer)"]
            L3A["上部: 接続 / モード / FPS / 前方距離 / STOPボタン (白黒)"]
            L3B["左右端: 極細ホワイトラインゲージ (視界を遮らない超スリム表示)"]
            L3C["下部: AUTO/MANUAL切替ボタン / 停止解除ボタン (フラットモノクロ)"]
        end
    end
```

### 1.1 モノクロームデザイン方針
- **カラーパレット**: 白（`#ffffff`）、黒（`#000000`）、グレー（`#888888` / `rgba(255, 255, 255, 0.2)`）のみを使用。カラーアクセント（赤・青・黄・緑のネオン/グロー）は一切排除。
- **装飾の最小化**: ネオングロー、カラーシャドウ、グラデーション背景を全廃し、細線とフラットな反転表示（白背景×黒文字 / 黒背景×白文字）に統一。
- **視界の最大化**: カメラ映像（またはシミュレータ）の視認性を最優先し、HUD要素は透過率の高い極薄レイアウトとする。

---

## 2. UI画面状態遷移図

WebAppはマイコンからのHeartbeatを監視し、現在のモードおよび通信状態に応じてUI状態を遷移させます。

```mermaid
stateDiagram-v2
    [*] --> DISCONNECTED

    DISCONNECTED --> CONNECTED: マイコンからHeartbeat受信
    CONNECTED --> DISCONNECTED: 1.5秒間 Heartbeat未受信

    state CONNECTED {
        [*] --> MANUAL

        MANUAL --> AUTO_PENDING: AUTO切替ボタン押下
        AUTO_PENDING --> AUTO: Heartbeat (mode=AUTO) 受信
        AUTO_PENDING --> MANUAL: 要求拒否 または 1.0秒タイムアウト

        AUTO --> MANUAL_PENDING: MANUAL切替ボタン押下
        MANUAL_PENDING --> MANUAL: Heartbeat (mode=MANUAL) 受信
        MANUAL_PENDING --> AUTO: 1.0秒タイムアウト

        AUTO --> AUTO_TOR: Heartbeat (tor_active=true) 受信
        AUTO_TOR --> AUTO: Heartbeat (tor_active=false) 受信 (自律解消)
        AUTO_TOR --> MANUAL: 「TAKE OVER」押下による引継ぎ
        AUTO_TOR --> SAFE_STOP: Heartbeat (mode=SAFE_STOP) 受信 (TOR時間切れ)

        MANUAL --> SAFE_STOP: Heartbeat (mode=SAFE_STOP) 受信 (障害物検知等)
        AUTO --> SAFE_STOP: Heartbeat (mode=SAFE_STOP) 受信 (障害物検知等)

        SAFE_STOP --> MANUAL: 「RESET / RESUME」押下 & Heartbeat (mode=MANUAL)

        MANUAL --> EMERGENCY_STOP: STOP押下 または Heartbeat受信
        AUTO --> EMERGENCY_STOP: STOP押下 または Heartbeat受信
        AUTO_TOR --> EMERGENCY_STOP: STOP押下 または Heartbeat受信
        SAFE_STOP --> EMERGENCY_STOP: STOP押下 または Heartbeat受信

        EMERGENCY_STOP --> MANUAL: 「RESET STOP」押下 & Heartbeat (mode=MANUAL)
    }
```

---

## 3. 各モードにおけるUI表示・操作可否マトリクス

### 操作可否一覧表

| UI状態 | スロットル / ステアリング（タッチ・キー） | モード切替ボタン | 非常停止ボタン | 復帰 / リセットボタン | 画面表示・アラート |
|---|---|---|---|---|---|
| **MANUAL** | **有効**（操作送信） | 有効（`AUTO` 要求） | **有効**（即時発報） | 非表示 | FPVカメラ映像、前方距離HUD、薄型操作ガイド |
| **AUTO_PENDING** | 無効 | 無効（「PENDING...」） | **有効** | 非表示 | モード要求 Pending 表示（モノクロバッジ） |
| **AUTO** | 無効（ロック） | 有効（`MANUAL` 要求） | **有効** | 非表示 | 自動運転中ステータス表示（白黒反転バッジ） |
| **AUTO_TOR** | 無効（引継ぎ優先） | 「TAKE OVER」強調 | **有効** | 非表示 | **白枠点滅オーバーレイ**、カウントダウン、TAKE OVERボタン |
| **SAFE_STOP** | 無効（ロック） | 無効 | **有効** | **有効**（「RESET / RESUME」） | 停止理由（障害物/タイムアウト等）HUD表示 |
| **EMERGENCY_STOP** | 無効（完全ロック） | 無効 | 無効（発報済） | **有効**（「RESET STOP」） | **白黒点滅アラート**、停止理由表示 |
| **DISCONNECTED** | 無効（完全ロック） | 無効 | 無効 | 無効 | 切断オーバーレイ（自動再接続試行） |

---

## 4. 手動操作入力仕様（2軸独立・スマホブラインド操作）

### 4.1 左右分割ブラインドタッチ操作
画面のボタンを目視して探す必要がなく、スマホを横持ちした両親指で直感的に操作できます。

- **👈 画面左半分（左親指ゾーン）**:
  - 画面左半分のどこでも指を触れた位置が基準点となり、上下ドラッグでスロットル操作（上に動かすと前進 `0.0 〜 1.0`、下に動かすと後退 `0.0 〜 -1.0`）。
  - 指を離すと即座に `0.0`（停止/ブレーキ）へ自動復帰。
- **👉 画面右半分（右親指ゾーン）**:
  - 画面右半分のどこでも指を触れた位置が基準点となり、左右ドラッグでステアリング操作（左に動かすと左旋回 `0.0 〜 -1.0`、右に動かすと右旋回 `0.0 〜 1.0`）。
  - 指を離すと即座に `0.0`（直進）へ自動復帰。
- **マルチタッチ対応**: 両親指によるスロットル＋ステアリングの同時斜め走行操作に完全対応。

```mermaid
stateDiagram-v2
    state MANUAL {
        state Throttle_Zone {
            [*] --> TOUCH_START: 画面左側をタッチ
            TOUCH_START --> FORWARD: 上方向スワイプ (throttle > 0)
            TOUCH_START --> BACKWARD: 下方向スワイプ (throttle < 0)
            FORWARD --> TOUCH_END: 指を離す (throttle = 0)
            BACKWARD --> TOUCH_END: 指を離す (throttle = 0)
            TOUCH_END --> [*]
        }
        --
        state Steering_Zone {
            [*] --> TOUCH_START_STR: 画面右側をタッチ
            TOUCH_START_STR --> LEFT: 左方向スワイプ (steering < 0)
            TOUCH_START_STR --> RIGHT: 右方向スワイプ (steering > 0)
            LEFT --> TOUCH_END_STR: 指を離す (steering = 0)
            RIGHT --> TOUCH_END_STR: 指を離す (steering = 0)
            TOUCH_END_STR --> [*]
        }
    }
```

### 4.2 操作入力と送信データの組み合わせ

| 操作入力 (タッチスワイプ / WASD / パッド) | `throttle` | `steering` | 車両の挙動 |
|---|---|---|---|
| タッチなし（ニュートラル） | `0.0` | `0.0` | 停止・中立 |
| 左手: 上スワイプ | `1.0` | `0.0` | 直進前進 |
| 左手: 下スワイプ | `-1.0` | `0.0` | 直進後退 |
| 左手上 + 右手左スワイプ | `1.0` | `-1.0` | **前進左旋回（斜め前左）** |
| 左手上 + 右手右スワイプ | `1.0` | `1.0` | **前進右旋回（斜め前右）** |
| 左手下 + 右手左スワイプ | `-1.0` | `-1.0` | **後退左旋回（斜め後左）** |
| 左手下 + 右手右スワイプ | `-1.0` | `1.0` | **後退右旋回（斜め後右）** |

---

## 5. 特殊画面仕様

### 5.1 TOR（Take Over Request: 運転引継ぎ要求）オーバーレイ
- **発生契機**: マイコンの Heartbeat で `tor_active = true` を検知した瞬間。
- **表示内容**:
  - 白枠点滅パルス警告。
  - 残り時間 `tor_remaining_ms` のリアルタイムカウントダウン（例: `4.5s`）。
  - 中央に特大の **「TAKE OVER」ボタン** を表示。

### 5.2 EMERGENCY_STOP（非常停止）画面
- **表示内容**:
  - モノクロ反転点滅HUD警告表示。
  - スロットル/ステアリングの完全無効化。
  - 停止理由（`EMERGENCY_BUTTON` 等）を明示。
  - **「RESET STOP」ボタン** を表示。

### 5.3 DISCONNECTED（通信切断）オーバーレイ
- **発生契機**: Heartbeat が 1.5秒 以上途絶えた場合。
- **表示内容**:
  - 半透明黒オーバーレイとミニマルスピナー表示。
  - 自動再接続ループ（1.5秒周期）を実行。

---

## 6. 関連ドキュメント

- [システム全体構成・アーキテクチャ設計書](file:///home/rsny/mini-4wd-webapp/docs/system-architecture.md)
- [通信プロトコル仕様書](file:///home/rsny/mini-4wd-webapp/docs/protocol.md)
- [状態遷移・シーケンス図集](file:///home/rsny/mini-4wd-webapp/docs/sequences.md)


