/**
 * 通信管理モジュール (WebSocket通信 & 定期ループ)
 */
import { Config } from './constants.js';

export class CommManager {
    constructor(cb) {
        this.cb = cb;
        this.ws = null;
        this.lastHeartbeat = 0;
        this.connected = false;

        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.wsUrl = `${proto}//${location.host || 'localhost:8765'}`;

        this.connect();
        setInterval(() => {
            if (this.connected && Date.now() - this.lastHeartbeat > Config.WS_HEARTBEAT_TIMEOUT_MS) {
                this.onLost();
            }
            if (this.ws?.readyState === WebSocket.OPEN) {
                const payload = this.cb.getTransmitPayload?.();
                if (payload) this.ws.send(JSON.stringify(payload));
            }
        }, Config.TRANSMIT_INTERVAL_MS);
    }

    connect() {
        try {
            this.ws = new WebSocket(this.wsUrl);
        } catch (_) {
            this.onLost();
            return setTimeout(() => this.connect(), Config.WS_RECONNECT_DELAY_MS);
        }

        this.ws.onopen = () => {
            this.connected = true;
            this.lastHeartbeat = Date.now();
            this.cb.onConnect?.();
        };

        this.ws.onmessage = (e) => {
            try {
                this.lastHeartbeat = Date.now();
                if (!this.connected) {
                    this.connected = true;
                    this.cb.onConnect?.();
                }
                this.cb.onHeartbeat?.(JSON.parse(e.data));
            } catch (_) {}
        };

        this.ws.onclose = this.ws.onerror = () => {
            this.onLost();
            setTimeout(() => this.connect(), Config.WS_RECONNECT_DELAY_MS);
        };
    }

    onLost() {
        if (this.connected) {
            this.connected = false;
            this.cb.onDisconnect?.();
        }
    }
}
