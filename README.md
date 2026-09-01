# mini-4wd-webapp
ミニ四駆自動運転車を遠隔操作・監視するためのWebアプリケーション

---

## 🚀 起動・利用手順

マイコン（`mock_server.py`）が **Web操作画面の配信（HTTP）** と **リアルタイム制御通信（WebSocket）** の両方を同一ポート（8765）で提供します。そのため、コマンド1つで起動可能です。

### 1. サーバーを起動
```bash
python3 mock_server.py
```
- ポート `8765` で Webサーバー＆WebSocketサーバーが起動します。
- ターミナル上で `1` 〜 `5` のキーを押すことで、シナリオ（通常走行、TOR警告、障害物検知など）をリアルタイムに切り替えられます。

### 2. ブラウザでアクセス
ブラウザで以下のURLを開きます：
👉 **http://localhost:8765**

画面を開くだけで、自動的に WebSocket も接続されて操作・監視が可能になります。

---

## 📖 仕様・設計ドキュメント
詳細な仕様書は [`docs/`](file:///home/rsny/mini-4wd-webapp/docs/README.md) にあります。
- [システムアーキテクチャ](file:///home/rsny/mini-4wd-webapp/docs/system-architecture.md)
- [UI仕様・画面設計](file:///home/rsny/mini-4wd-webapp/docs/ui-spec.md)
- [通信プロトコル仕様](file:///home/rsny/mini-4wd-webapp/docs/protocol.md)
- [状態遷移・シーケンス図](file:///home/rsny/mini-4wd-webapp/docs/sequences.md)

