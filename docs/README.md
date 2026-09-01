# ミニ四駆自動運転 WebApp 設計ドキュメント

本ディレクトリには、ミニ四駆自動運転 WebApp および 車載マイコンとの通信・制御に関する設計仕様書がまとめられています。

## 📚 ドキュメント構成一覧

| ドキュメント | 主な内容 |
|---|---|
| 📄 **[system-architecture.md](file:///home/rsny/mini-4wd-webapp/docs/system-architecture.md)** | **システム全体構成・アーキテクチャ**<br>- 全体構成図（WebApp ⇄ マイコン ⇄ ハードウェア）<br>- 通信系統（制御WebSocketと映像ストリームの分離）<br>- WebApp と マイコンの責務分担 |
| 📄 **[ui-spec.md](file:///home/rsny/mini-4wd-webapp/docs/ui-spec.md)** | **WebApp UI仕様・画面遷移**<br>- UI画面状態遷移図<br>- 各モードにおけるUI表示・操作可否マトリクス<br>- 2軸独立制御（スロットル・ステアリング）入力仕様<br>- TOR / 非常停止 / 切断オーバーレイ仕様 |
| 📄 **[protocol.md](file:///home/rsny/mini-4wd-webapp/docs/protocol.md)** | **通信プロトコル・インターフェース仕様**<br>- 送信コマンド JSON スキーマ（`client_mode`, `throttle`, `steering`, etc.）<br>- 受信 Heartbeat JSON スキーマ（`mode`, `tor_active`, `stop_reason`, etc.）<br>- タイムアウトパラメータ一覧（100ms / 300ms / 1.5s / TOR猶予）<br>- 状態不一致時の安全判定マトリクス |
| 📄 **[sequences.md](file:///home/rsny/mini-4wd-webapp/docs/sequences.md)** | **状態遷移・シーケンス図集**<br>- モード切替（MANUAL ⇄ AUTO）の正常系・異常系・タイムアウト<br>- 手動操作・斜め走行・デッドマンタイマー動作<br>- TOR（運転引継ぎ要求）のライフサイクル<br>- EMERGENCY_STOP / SAFE_STOP の発報・復帰フロー<br>- 通信切断（Disconnect）と再接続（Reconnect） |

## 🚀 開発時のクイックリファレンス

### 重要な設計ルール
1. **Source of Truth は常にマイコン**
   - WebAppは状態を直接書き換えず、要求（`mode_request`）を送り、マイコンからの Heartbeat で確定反映します。
2. **2軸独立制御**
   - 前後スロットルと左右ステアリングは独立軸として並行制御し、同時押しによる斜め走行（前進旋回等）が可能です。
3. **安全側操作の即時受容**
   - EMERGENCY_STOP や 停止指示（スロットル0）、MANUAL復帰要求は、状態不一致時でも最優先で実行されます。
4. **二重のフェイルセーフ**
   - WebApp側：1.5秒未受信で `DISCONNECTED`（全操作ロック）
   - マイコン側：300ms未受信でデッドマン停止、通信断で `SAFE_STOP`
