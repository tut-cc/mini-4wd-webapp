# mini-4wd-webapp
ミニ四駆自動運転車をスマートフォン等のブラウザから遠隔操作するためのWebアプリ

## 起動・利用手順

マイコン（`mock_server.py`）が **Web操作画面の配信（HTTP）** と **リアルタイム制御通信（WebSocket）** の両方を同一ポート（8765）で提供します。

### 1. サーバーを起動
```bash
python3 mock_server.py
```
- ポート `8765` で Webサーバー＆WebSocketサーバーが起動します。
- ターミナル上で `1` 〜 `5` のキーを押すことで、動作シナリオ（手動走行、自動運転、TOR警告、自動中断、手動中断）をリアルタイムに切り替えられます。

### 2. ブラウザ（スマホまたはPC）でアクセス
スマホやPCのブラウザで以下のURLを開きます：
👉 **http://<サーバーのIPアドレスまたはlocalhost>:8765**

- 画面の任意の場所をタッチ（またはマウスクリック）してスワイプすることで走行操作が可能です。
- 右上の「INFO」ボタンからいつでも操作説明を確認できます。

## サーバーアーキテクチャ

マイコン実機（Raspberry Pi / ESP32 等）への移植や実機開発を容易にするため、サーバーは **共通制御・通信コア (`server/`)** と **モック固有機能 (`mock/`)** に綺麗に分離されています。

```text
mini-4wd-webapp/
├── server/                     # 車載マイコン・実機でもそのまま使える共通パッケージ
│   ├── constants.py            # プロトコル定数 (モード・停止要因・拒否理由)
│   ├── controller.py           # 制御コア (Source of Truth・安全マトリクス・TOR・デッドマン監視)
│   ├── http_ws_server.py       # 軽量非同期HTTP/WebSocket/MJPEGサーバー (標準ライブラリのみ)
│   └── camera_base.py          # カメラ映像プロバイダの基底インターフェース
│
├── mock/                       # モック開発専用パッケージ
│   ├── camera.py               # 疑似コース・疑似カメラ
│   ├── scenario.py             # テストシナリオ管理
│   └── scenarios.json          # シナリオ定義データ
│
├── mock_server.py              # モック起動エントリポイント
└── examples/
    └── real_server_template.py # マイコン実機向け実装サンプル
```

- **実機マイコン向けに開発する場合:**
  - `server/` パッケージをそのまま利用し、[`examples/real_server_template.py`](examples/real_server_template.py) のように実機のPWMドライバ（モーター/サーボ）やカメラモジュールをバインドするだけで実機サーバーを構築できます。
