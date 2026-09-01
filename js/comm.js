/**
 * 通信管理モジュール (WebSocket通信 & 定期ループ)
 */

import { Config } from './constants.js';

export class CommManager {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.ws = null;
        this.lastHeartbeatTime = 0;
        this.connected = false;

        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = location.host || 'localhost:8765';
        this.wsUrl = `${wsProto}//${wsHost}`;

        this.connect();
        this.startTransmitLoop();
    }

    connect() {
        try {
            this.ws = new WebSocket(this.wsUrl);
        } catch (e) {
            this.onConnectionLost();
            setTimeout(() => this.connect(), Config.WS_RECONNECT_DELAY_MS);
            return;
        }

        this.ws.onopen = () => {
            this.connected = true;
            this.lastHeartbeatTime = Date.now();
            if (this.callbacks.onConnect) this.callbacks.onConnect();
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.lastHeartbeatTime = Date.now();
                if (!this.connected) {
                    this.connected = true;
                    if (this.callbacks.onConnect) this.callbacks.onConnect();
                }
                if (this.callbacks.onHeartbeat) this.callbacks.onHeartbeat(data);
            } catch (e) {
                console.error('[CommManager] Invalid Heartbeat JSON:', e);
            }
        };

        this.ws.onclose = () => {
            this.onConnectionLost();
            setTimeout(() => this.connect(), Config.WS_RECONNECT_DELAY_MS);
        };

        this.ws.onerror = () => {
            this.onConnectionLost();
        };
    }

    onConnectionLost() {
        if (this.connected) {
            this.connected = false;
            if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
        }
    }

    startTransmitLoop() {
        setInterval(() => {
            if (this.connected && Date.now() - this.lastHeartbeatTime > Config.WS_HEARTBEAT_TIMEOUT_MS) {
                this.onConnectionLost();
            }

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const payload = this.callbacks.getTransmitPayload();
                if (payload) {
                    this.ws.send(JSON.stringify(payload));
                }
            }
        }, Config.TRANSMIT_INTERVAL_MS);
    }
}
