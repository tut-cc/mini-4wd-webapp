# システム全体構成・アーキテクチャ設計書

本ドキュメントでは、ミニ四駆自動運転システムにおける WebApp、車載マイコン、ハードウェア各コンポーネントの全体構成、通信系統、および責務分担について定義します。

---

## 1. システム全体構成図

```mermaid
flowchart TB
    subgraph Client["操作端末 (PC / スマートフォン / タブレット)"]
        UI["WebApp UI (HTML5 / CSS / JavaScript)"]
        GP["入力デバイス (Gamepad API / Keyboard / Touch)"]
        GP --> UI
    end

    subgraph Comm["通信ネットワーク (Wi-Fi)"]
        HTTP_UI["WebApp配信 (HTTP / index.html, JS, CSS)"]
        WS_CH["制御・テレメトリ通信 (WebSocket / 双方向 100ms)"]
        CAM_CH["カメラ映像ストリーム (MJPEG / WebRTC / HTTP)"]
    end

    subgraph MCU["車載マイコン (ESP32 / Raspberry Pi 等)"]
        HTTP_SVR["Web Server (WebApp静的ファイル配信)"]
        WS_SVR["WebSocket Server (制御通信)"]
        CTRL["制御・状態管理コア (Source of Truth)"]
        FAIL["フェイルセーフ / デッドマン監視"]
        CAM_DRV["カメラキャプチャ・配信"]
        MOTOR_DRV["モータードライバ制御 (PWM)"]
        SERVO_DRV["ステアリングサーボ制御 (PWM)"]
        
        WS_SVR <--> CTRL
        FAIL --> CTRL
        CTRL --> MOTOR_DRV
        CTRL --> SERVO_DRV
    end

    subgraph Hardware["車体ハードウェア"]
        M_DRV["モータードライバ IC"] --> DC_M["駆動用 DCモーター (前後)"]
        SERVO["ステアリングサーボ (左右)"]
        LIDAR["前方測距センサー (ToF / 超音波)"] --> CTRL
        CAM["広角カメラモジュール"] --> CAM_DRV
    end

    UI <--> WS_CH <--> WS_SVR
    CAM_DRV --> CAM_CH --> UI
    MOTOR_DRV --> M_DRV
    SERVO_DRV --> SERVO
```

---

## 2. 通信系統設計
車載マイコンは以下の3つの役割・通信経路を提供します。

```mermaid
flowchart LR
    subgraph WebApp["操作端末 / ブラウザ"]
        W_STATIC["Web画面読み込み (HTML/CSS/JS)"]
        W_CTRL["制御・UIモジュール"]
        W_VIDEO["映像描画モジュール (Canvas / img)"]
    end

    subgraph Network["Wi-Fi 通信"]
        direction TB
        HTTP_STATIC["【画面配信】 HTTP GET\n- index.html / app.js / style.css\n- 初回アクセス時"]
        WS["【制御系統】 WebSocket\n- 低遅延・軽量JSON\n- 100ms周期 双方向\n- 操作コマンド / Heartbeat"]
        HTTP_CAM["【映像系統】 HTTP/MJPEG または WebRTC\n- 映像フレームストリーム\n- 制御とは非同期"]
    end

    subgraph MCU["車載マイコン"]
        M_HTTP["Web Server タスク"]
        M_CTRL["制御・状態管理タスク"]
        M_CAM["カメラ配信タスク"]
    end

    W_STATIC <-- HTTP GET --> M_HTTP
    W_CTRL <--> WS <--> M_CTRL
    M_CAM --> HTTP_CAM --> W_VIDEO
```

1. **WebApp配信系統（HTTP GET）**
   - 操作端末がマイコンのIP/ポート（例: `http://localhost:8765/` や `http://192.168.4.1:8765/`）にアクセスすることで、マイコンから直接Web操作画面（HTML/JS/CSS）を配信します。
2. **制御・テレメトリ系統（WebSocket）**
   - 操作コマンドの送信、マイコンからの定期Heartbeat（テレメトリ）送信用。
   - 軽量なJSONフォーマットを用い、100ms周期で低遅延にやり取りします。
3. **映像配信系統（MJPEG / WebRTC / HTTP Stream）**
   - カメラ映像専用のストリーム。
   - 制御通信のパケット遅延やブロッキングを防ぐため、完全に独立した経路として扱います。

---

## 3. WebApp と マイコンの責務分担

```mermaid
flowchart TD
    subgraph WebApp_Role["WebApp (クライアント)"]
        R1["UI表示・ステータス描画"]
        R2["キーボード/ゲームパッド/タッチ入力の受付"]
        R3["認識モード (client_mode) と操作要求の送信"]
        R4["Heartbeat受信監視 (未受信1.5秒で切断判定)"]
        R5["Pendingタイムアウト管理 (1.0秒)"]
        R6["TOR警告・カウントダウン表示"]
    end

    subgraph MCU_Role["マイコン (MCU: Source of Truth)"]
        M1["確定モード (mode) の管理・決定"]
        M2["受信コマンドの状態照合・安全判定 (マトリクス)"]
        M3["自律走行制御・白線/障害物検知"]
        M4["TOR判定・残り時間カウント"]
        M5["デッドマンタイマー (300ms) による自動停止"]
        M6["PWMによるモーター・サーボ物理制御"]
        M7["Heartbeat定期ブロードキャスト (100ms)"]
    end
```

### 責務分担の基本ルール

| 項目 | WebApp (UI) | 車載マイコン (MCU) |
|---|---|---|
| **モード決定権** | **なし**（要求 `mode_request` を送るのみ） | **あり（Source of Truth）** |
| **画面・操作状態** | マイコンの Heartbeat に基づき確定更新 | 自身の内部状態を Heartbeat で返信 |
| **手動走行指示** | スロットル/ステアリングの数値を定期送信 | 状態照合・デッドマン監視の上でPWM出力 |
| **異常停止** | 非常停止要求、停止中の操作ロック | 非常停止・障害物停止・自動出力遮断 |
| **通信監視** | 1.5秒途絶で `DISCONNECTED` 表示 | 300ms途絶でモーター停止、通信断で `SAFE_STOP` |

---

## 4. 関連ドキュメント

- [UI仕様・画面遷移図](file:///home/rsny/mini-4wd-webapp/docs/ui-spec.md)
- [通信プロトコル仕様書](file:///home/rsny/mini-4wd-webapp/docs/protocol.md)
- [状態遷移・シーケンス図集](file:///home/rsny/mini-4wd-webapp/docs/sequences.md)
