# mini-4wd-webapp
ミニ四駆自動運転車をスマートフォン等のブラウザから遠隔操作・監視するためのWebアプリケーション (FPV Cockpit - Minimal Monochrome)

---

## 主な特徴

- **モバイルファースト & フルスクリーンFPV:**
  - 画面のほぼ100%がラジコン車載カメラ映像（またはモノクロワイヤーフレームFPVシミュレータ）。
  - UIパーツは極薄のモノクロHUD化し、視界を邪魔しません。
- **完全モノクローム & 最小限の装飾 (Monochrome Minimal):**
  - カラー（青・赤・黄・ネオン等）を全廃し、白・黒・グレーのみで構成。
  - 装飾を極限まで削ぎ落とし、視認性と操作性を最優先したプロトコル調デザイン。
- **ブラインドタッチ操作（画面を見ずに親指感覚で操作）:**
  - **画面左半分:** スロットル（前後スワイプ、離すと停止）
  - **画面右半分:** ステアリング（左右スワイプ、離すと直進）
  - ボタンの位置を探す必要がなく、触れた場所から直感的にリニア操作できます。
- **堅牢な安全機能:**
  - 最優先「STOP」ボタン
  - 運転引継ぎ警告（TOR）のリアルタイムカウントダウン & Take Over機能
  - マイコンの確定状態を同期する Source of Truth 設計

---

## 起動・利用手順

マイコン（`mock_server.py`）が **Web操作画面の配信（HTTP）** と **リアルタイム制御通信（WebSocket）** の両方を同一ポート（8765）で提供します。

### 1. サーバーを起動
```bash
python3 mock_server.py
```
- ポート `8765` で Webサーバー＆WebSocketサーバーが起動します。
- ターミナル上で `1` 〜 `5` のキーを押すことで、シナリオ（通常走行、TOR警告、障害物検知など）をリアルタイムに切り替えられます。

### 2. ブラウザ（スマホまたはPC）でアクセス
スマホやPCのブラウザで以下のURLを開きます：
👉 **http://<サーバーのIPアドレスまたはlocalhost>:8765**

- PCではキーボード（WASD / 矢印キー / Space停止）やゲームパッド、マウスドラッグでも操作可能です。
- カメラ映像ストリーム（MJPEG URL）は右上の「CAM」ボタンから設定可能です。

---

## 仕様・設計ドキュメント
詳細な仕様書は [`docs/`](file:///home/rsny/mini-4wd-webapp/docs/README.md) にあります。
- [システムアーキテクチャ](file:///home/rsny/mini-4wd-webapp/docs/system-architecture.md)
- [UI仕様・画面設計](file:///home/rsny/mini-4wd-webapp/docs/ui-spec.md)
- [通信プロトコル仕様](file:///home/rsny/mini-4wd-webapp/docs/protocol.md)
- [状態遷移・シーケンス図](file:///home/rsny/mini-4wd-webapp/docs/sequences.md)


