# WebApp / マイコン 設計仕様書

> [!NOTE]
> 本ドキュメントは関心ごとに以下の各専門ドキュメントへ分割・整理されました。  
> 最新の設計および詳細な図は各ドキュメントをご参照ください。

## 📚 ドキュメント一覧

1. **[システム全体構成・アーキテクチャ設計書 (system-architecture.md)](file:///home/rsny/mini-4wd-webapp/docs/system-architecture.md)**
   - システム全体構成図（WebApp ⇄ マイコン ⇄ 車体ハードウェア）
   - 制御（WebSocket）と映像（ストリーム）の2系統通信
   - WebApp と マイコンの責務分担

2. **[WebApp UI仕様・画面遷移設計書 (ui-spec.md)](file:///home/rsny/mini-4wd-webapp/docs/ui-spec.md)**
   - UI画面状態遷移図
   - 各モード別 UI表示・操作可否マトリクス
   - 2軸独立制御（スロットル・ステアリング）入力仕様
   - TOR / 非常停止 / 切断オーバーレイ仕様

3. **[通信プロトコル・インターフェース仕様書 (protocol.md)](file:///home/rsny/mini-4wd-webapp/docs/protocol.md)**
   - 送信コマンド（`client_mode`, `throttle`, etc.）JSONスキーマ
   - 受信 Heartbeat（`mode`, `tor_active`, etc.）JSONスキーマ
   - タイムアウト・パラメータ一覧
   - 状態不一致時の安全判定マトリクス

4. **[状態遷移・シーケンス図集 (sequences.md)](file:///home/rsny/mini-4wd-webapp/docs/sequences.md)**
   - モード切替（MANUAL ⇄ AUTO）
   - 手動操作とデッドマンタイマー
   - TORライフサイクル
   - 非常停止・安全停止の発報と復帰
   - 通信切断と再接続
