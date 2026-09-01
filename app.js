/**
 * ミニ四駆自動運転 WebApp (Client Controller)
 * 
 * 設計ドキュメント（docs/）に完全準拠したクラスベースのステートマシン実装:
 * - Source of Truth は車載マイコン (Heartbeat)
 * - 2軸独立制御 (スロットル / ステアリング、斜め走行対応、自動中立復帰)
 * - 状態遷移管理 (MANUAL, AUTO_PENDING, MANUAL_PENDING, AUTO, AUTO_TOR, SAFE_STOP, EMERGENCY_STOP, DISCONNECTED)
 * - タイムアウト監視 (100ms周期送信, 1000ms Pendingタイムアウト, 1500ms 切断判定)
 */

// ==========================================
// 定数 & 列挙型定義
// ==========================================

const UIState = Object.freeze({
    DISCONNECTED: 'DISCONNECTED',
    MANUAL: 'MANUAL',
    AUTO_PENDING: 'AUTO_PENDING',
    MANUAL_PENDING: 'MANUAL_PENDING',
    AUTO: 'AUTO',
    AUTO_TOR: 'AUTO_TOR',
    SAFE_STOP: 'SAFE_STOP',
    EMERGENCY_STOP: 'EMERGENCY_STOP'
});

const ClientMode = Object.freeze({
    MANUAL: 'MANUAL',
    AUTO: 'AUTO',
    SAFE_STOP: 'SAFE_STOP',
    EMERGENCY_STOP: 'EMERGENCY_STOP'
});

const ModeRequest = Object.freeze({
    NONE: 'NONE',
    MANUAL: 'MANUAL',
    AUTO: 'AUTO'
});

const StopReasonText = Object.freeze({
    NONE: 'NONE (正常走行/待機)',
    OBSTACLE: '前方障害物検知',
    TOR_TIMEOUT: 'TOR時間切れ (自動安全停止)',
    EMERGENCY_BUTTON: '非常停止ボタン押下',
    COMM_TIMEOUT: '通信途絶による安全停止',
    SENSOR_ERROR: 'センサー異常検知'
});

const RejectReasonText = Object.freeze({
    NONE: 'NONE',
    OBSTACLE_NEAR: '前方に障害物を検知しています (距離不足)',
    SENSOR_NOT_READY: 'センサーが初期化中または値が不安定です',
    IN_TOR: '運転引継ぎ(TOR)発生中のため切替できません',
    IN_EMERGENCY: '非常停止中のため操作できません',
    MODE_MISMATCH: '車両の状態と一致しない操作要求です'
});

// ==========================================
// 1. InputController クラス (2軸独立入力制御)
// ==========================================

class InputController {
    /**
     * @param {Function} onEmergencyStopCallback 非常停止キー(Space)押下時のコールバック
     */
    constructor(onEmergencyStopCallback) {
        this.onEmergencyStop = onEmergencyStopCallback;
        this.enabled = true;

        // 2軸独立制御値 (-1.0 〜 1.0)
        this.throttle = 0.0;
        this.steering = 0.0;

        // キーボード押下状態
        this.keys = {
            up: false,
            down: false,
            left: false,
            right: false
        };

        // スライダーDOM
        this.throttleSlider = document.getElementById('throttle-slider');
        this.steeringSlider = document.getElementById('steering-slider');

        // ゲームパッド接続状態
        this.gamepadConnected = false;

        this.initEventListeners();
    }

    /**
     * 操作入力の有効/無効を設定（無効化時は自動的に0リセット）
     * @param {boolean} enabled 
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        this.throttleSlider.disabled = !enabled;
        this.steeringSlider.disabled = !enabled;
        if (!enabled) {
            this.reset();
        }
    }

    /**
     * 操作入力を中央・中立位置（0.0）にリセット
     */
    reset() {
        this.throttle = 0.0;
        this.steering = 0.0;
        this.throttleSlider.value = "0";
        this.steeringSlider.value = "0";
        this.keys.up = false;
        this.keys.down = false;
        this.keys.left = false;
        this.keys.right = false;
    }

    initEventListeners() {
        // --- スライダー入力 (操作中は値を反映、離したら即座に 0.0 復帰) ---
        const resetThrottleSlider = () => {
            if (!this.enabled) return;
            this.throttle = 0.0;
            this.throttleSlider.value = "0";
        };

        const resetSteeringSlider = () => {
            if (!this.enabled) return;
            this.steering = 0.0;
            this.steeringSlider.value = "0";
        };

        this.throttleSlider.addEventListener('input', (e) => {
            if (!this.enabled) return;
            this.throttle = parseFloat(e.target.value);
        });
        this.throttleSlider.addEventListener('change', resetThrottleSlider);
        this.throttleSlider.addEventListener('mouseup', resetThrottleSlider);
        this.throttleSlider.addEventListener('touchend', resetThrottleSlider);

        this.steeringSlider.addEventListener('input', (e) => {
            if (!this.enabled) return;
            this.steering = parseFloat(e.target.value);
        });
        this.steeringSlider.addEventListener('change', resetSteeringSlider);
        this.steeringSlider.addEventListener('mouseup', resetSteeringSlider);
        this.steeringSlider.addEventListener('touchend', resetSteeringSlider);

        // --- キーボード入力 (WASD / 矢印キー、同時押し斜め走行対応) ---
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;

            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') this.keys.up = true;
            if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') this.keys.down = true;
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = true;
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = true;

            // Spaceキーは非常停止（最優先）
            if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                if (this.onEmergencyStop) this.onEmergencyStop();
            }

            this.updateFromKeyboard();
        });

        window.addEventListener('keyup', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') this.keys.up = false;
            if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') this.keys.down = false;
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = false;
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = false;

            this.updateFromKeyboard();
        });
    }

    updateFromKeyboard() {
        if (!this.enabled) return;

        let targetThrottle = 0.0;
        let targetSteering = 0.0;

        // スロットル軸 (前後独立)
        if (this.keys.up && !this.keys.down) targetThrottle = 1.0;
        if (this.keys.down && !this.keys.up) targetThrottle = -1.0;

        // ステアリング軸 (左右独立)
        if (this.keys.left && !this.keys.right) targetSteering = -1.0;
        if (this.keys.right && !this.keys.left) targetSteering = 1.0;

        const isKeyboardActive = this.keys.up || this.keys.down || this.keys.left || this.keys.right;
        if (isKeyboardActive) {
            this.throttle = targetThrottle;
            this.steering = targetSteering;
            this.throttleSlider.value = String(targetThrottle);
            this.steeringSlider.value = String(targetSteering);
        } else {
            // キーを離した軸を 0 に中立復帰
            if (!this.keys.up && !this.keys.down) {
                this.throttle = 0.0;
                this.throttleSlider.value = "0";
            }
            if (!this.keys.left && !this.keys.right) {
                this.steering = 0.0;
                this.steeringSlider.value = "0";
            }
        }
    }

    /**
     * Gamepad API ポーリング
     */
    pollGamepad() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const pad = gamepads[0];

        if (!pad) {
            this.gamepadConnected = false;
            return;
        }

        this.gamepadConnected = true;

        if (this.enabled) {
            const deadband = 0.08;
            let stickX = pad.axes[0] || pad.axes[2] || 0;
            let stickY = -(pad.axes[1] || 0);

            if (Math.abs(stickX) < deadband) stickX = 0;
            if (Math.abs(stickY) < deadband) stickY = 0;

            const isKeyboardActive = this.keys.up || this.keys.down || this.keys.left || this.keys.right;
            if (!isKeyboardActive && !this.throttleSlider.matches(':active')) {
                this.throttle = stickY;
                this.throttleSlider.value = String(stickY);
            }
            if (!isKeyboardActive && !this.steeringSlider.matches(':active')) {
                this.steering = stickX;
                this.steeringSlider.value = String(stickX);
            }
        }

        // ボタン 0, 1, 2, 3 (A/B/X/Y) で非常停止
        if (pad.buttons[0]?.pressed || pad.buttons[1]?.pressed || pad.buttons[2]?.pressed || pad.buttons[3]?.pressed) {
            if (this.onEmergencyStop) this.onEmergencyStop();
        }
    }

    getThrottle() {
        return this.enabled ? this.throttle : 0.0;
    }

    getSteering() {
        return this.enabled ? this.steering : 0.0;
    }
}

// ==========================================
// 2. UIManager クラス (画面描画 & UI操作)
// ==========================================

class UIManager {
    /**
     * @param {Object} callbacks UIイベントコールバック
     */
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.initDOMElements();
        this.bindEvents();
        this.alertTimeout = null;
    }

    initDOMElements() {
        // トップステータスバー
        this.wsStatus = document.getElementById('ws-status');
        this.modeBadge = document.getElementById('mode-badge');
        this.distanceBadge = document.getElementById('distance-badge');
        this.fpsCounter = document.getElementById('fps-counter');
        this.gamepadStatus = document.getElementById('gamepad-status');

        // メーター・ゲージ
        this.throttleGauge = document.getElementById('throttle-gauge');
        this.steeringPointer = document.getElementById('steering-pointer');
        this.throttleValue = document.getElementById('throttle-value');
        this.steeringValue = document.getElementById('steering-value');

        // 車両ステータス
        this.statusModeText = document.getElementById('status-mode-text');
        this.statusDistanceText = document.getElementById('status-distance-text');
        this.statusStopReason = document.getElementById('status-stop-reason');

        // 操作ボタン
        this.btnDriveMode = document.getElementById('btn-drive-mode');
        this.btnEmergencyStop = document.getElementById('btn-emergency-stop');
        this.btnResetStop = document.getElementById('btn-reset-stop');
        this.btnFullscreen = document.getElementById('btn-fullscreen');
        this.btnAbout = document.getElementById('btn-about');
        this.btnCloseAbout = document.getElementById('btn-close-about');
        this.aboutModal = document.getElementById('about-modal');

        // アラートバナー
        this.alertBanner = document.getElementById('alert-banner');
        this.alertMessage = document.getElementById('alert-message');

        // オーバーレイ
        this.torOverlay = document.getElementById('tor-overlay');
        this.torCountdown = document.getElementById('tor-countdown');
        this.btnTorTakeover = document.getElementById('btn-tor-takeover');
        this.disconnectedOverlay = document.getElementById('disconnected-overlay');
    }

    bindEvents() {
        this.btnDriveMode.addEventListener('click', () => {
            if (this.callbacks.onDriveModeClick) this.callbacks.onDriveModeClick();
        });

        this.btnEmergencyStop.addEventListener('click', () => {
            if (this.callbacks.onEmergencyStopClick) this.callbacks.onEmergencyStopClick();
        });

        this.btnResetStop.addEventListener('click', () => {
            if (this.callbacks.onResetStopClick) this.callbacks.onResetStopClick();
        });

        this.btnTorTakeover.addEventListener('click', () => {
            if (this.callbacks.onTorTakeoverClick) this.callbacks.onTorTakeoverClick();
        });

        this.btnFullscreen.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        });

        this.btnAbout.addEventListener('click', () => {
            this.aboutModal.classList.remove('hidden');
        });

        this.btnCloseAbout.addEventListener('click', () => {
            this.aboutModal.classList.add('hidden');
        });
    }

    /**
     * UI状態とMCUテレメトリデータに基づき画面全体を更新
     * @param {string} uiState 現在のUIState
     * @param {Object} mcuData マイコンからのHeartbeatデータ
     */
    renderState(uiState, mcuData) {
        const dist = (mcuData && mcuData.front_distance_mm !== undefined) ? mcuData.front_distance_mm : '--';
        const stopReason = mcuData ? (StopReasonText[mcuData.stop_reason] || mcuData.stop_reason) : 'NONE';

        // 1. バッジ & ステータステキスト更新
        this.modeBadge.textContent = `MODE: ${uiState}`;
        this.modeBadge.className = `status-badge mode-badge mode-${uiState.toLowerCase().replace('_', '')}`;
        this.distanceBadge.textContent = `前方距離: ${dist} mm`;
        this.statusModeText.textContent = uiState;
        this.statusDistanceText.textContent = `${dist} mm`;
        this.statusStopReason.textContent = stopReason;

        // 2. 状態ごとのUI要素（ボタン・オーバーレイ等）制御
        switch (uiState) {
            case UIState.DISCONNECTED:
                this.disconnectedOverlay.classList.remove('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatus.textContent = 'WS: 未接続 (OFFLINE)';
                this.wsStatus.className = 'status-badge disconnected';

                this.btnDriveMode.disabled = true;
                this.btnEmergencyStop.disabled = true;
                this.btnResetStop.classList.add('hidden');
                break;

            case UIState.MANUAL:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatus.textContent = 'WS: 接続中 (ONLINE)';
                this.wsStatus.className = 'status-badge connected';

                this.btnDriveMode.classList.remove('hidden', 'auto-mode', 'pending');
                this.btnDriveMode.textContent = 'Auto Mode へ切替';
                this.btnDriveMode.disabled = false;

                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.AUTO_PENDING:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatus.textContent = 'WS: 接続中 (ONLINE)';
                this.wsStatus.className = 'status-badge connected';

                this.btnDriveMode.classList.remove('hidden', 'auto-mode');
                this.btnDriveMode.classList.add('pending');
                this.btnDriveMode.textContent = '切替中 (Pending)...';
                this.btnDriveMode.disabled = true;

                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.MANUAL_PENDING:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatus.textContent = 'WS: 接続中 (ONLINE)';
                this.wsStatus.className = 'status-badge connected';

                this.btnDriveMode.classList.remove('hidden');
                this.btnDriveMode.classList.add('auto-mode', 'pending');
                this.btnDriveMode.textContent = '切替中 (Pending)...';
                this.btnDriveMode.disabled = true;

                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.AUTO:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatus.textContent = 'WS: 接続中 (ONLINE)';
                this.wsStatus.className = 'status-badge connected';

                this.btnDriveMode.classList.remove('hidden', 'pending');
                this.btnDriveMode.classList.add('auto-mode');
                this.btnDriveMode.textContent = 'Manual Mode へ切替';
                this.btnDriveMode.disabled = false;

                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.AUTO_TOR:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.remove('hidden');
                this.wsStatus.textContent = 'WS: 接続中 (ONLINE)';
                this.wsStatus.className = 'status-badge connected';

                if (mcuData && mcuData.tor_remaining_ms !== undefined) {
                    const sec = (mcuData.tor_remaining_ms / 1000).toFixed(1);
                    this.torCountdown.textContent = sec;
                }

                this.btnDriveMode.classList.add('hidden');
                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.SAFE_STOP:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatus.textContent = 'WS: 接続中 (ONLINE)';
                this.wsStatus.className = 'status-badge connected';

                this.btnDriveMode.classList.add('hidden');
                this.btnResetStop.classList.remove('hidden');
                this.btnResetStop.textContent = '手動モードで再開 (リセット)';
                this.btnResetStop.disabled = false;
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.EMERGENCY_STOP:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatus.textContent = 'WS: 接続中 (ONLINE)';
                this.wsStatus.className = 'status-badge connected';

                this.btnDriveMode.classList.add('hidden');
                this.btnResetStop.classList.remove('hidden');
                this.btnResetStop.textContent = '🚨 安全確認・非常停止を解除';
                this.btnResetStop.disabled = false;
                this.btnEmergencyStop.disabled = true;
                break;
        }
    }

    /**
     * スロットル・ステアリングのゲージ・針を描画
     */
    renderGauges(throttle, steering) {
        const tVal = Math.round(throttle * 100);
        const sVal = Math.round(steering * 100);

        this.throttleValue.textContent = String(tVal);
        this.steeringValue.textContent = String(sVal);

        // スロットルゲージ fill
        const maxOffset = 125;
        const offset = maxOffset - (Math.abs(throttle) * maxOffset);
        this.throttleGauge.style.strokeDashoffset = String(offset);

        if (throttle < 0) {
            this.throttleGauge.style.stroke = 'var(--accent-red)';
        } else if (throttle > 0.8) {
            this.throttleGauge.style.stroke = 'var(--accent-orange)';
        } else {
            this.throttleGauge.style.stroke = 'var(--accent-blue)';
        }

        // ステアリング針 (-45deg 〜 45deg)
        const rot = steering * 45;
        this.steeringPointer.style.transform = `rotate(${rot}deg)`;
    }

    updateGamepadStatus(active) {
        if (active) {
            this.gamepadStatus.textContent = 'Gamepad: On';
            this.gamepadStatus.classList.add('active');
        } else {
            this.gamepadStatus.textContent = 'Gamepad: Off';
            this.gamepadStatus.classList.remove('active');
        }
    }

    updateFPS(fps) {
        this.fpsCounter.textContent = `FPS: ${fps}`;
    }

    /**
     * エラー通知・拒否バナーの表示
     */
    showError(msg) {
        this.alertMessage.textContent = msg;
        this.alertBanner.classList.remove('hidden');
        if (this.alertTimeout) clearTimeout(this.alertTimeout);
        this.alertTimeout = setTimeout(() => {
            this.alertBanner.classList.add('hidden');
        }, 3000);
    }
}

// ==========================================
// 3. CommManager クラス (WebSocket通信 & 定期ループ)
// ==========================================

class CommManager {
    /**
     * @param {Object} callbacks 通信イベントコールバック
     */
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
            setTimeout(() => this.connect(), 2000);
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
            setTimeout(() => this.connect(), 1500);
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

    /**
     * 100ms 周期の定期送信 & 1.5s Heartbeat未受信監視ループ
     */
    startTransmitLoop() {
        setInterval(() => {
            // 1.5s Watchdog: Heartbeat未受信で切断判定
            if (this.connected && Date.now() - this.lastHeartbeatTime > 1500) {
                this.onConnectionLost();
            }

            // 100ms 周期で操作コマンドを送信
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const payload = this.callbacks.getTransmitPayload();
                if (payload) {
                    this.ws.send(JSON.stringify(payload));
                }
            }
        }, 100);
    }
}

// ==========================================
// 4. StateMachine クラス (UI状態遷移 & 安全ルール管理)
// ==========================================

class StateMachine {
    /**
     * @param {Mini4WDApp} app 
     */
    constructor(app) {
        this.app = app;
        this.currentState = UIState.DISCONNECTED;
        this.pendingTimer = null;

        // マイコンからの最新Heartbeatデータ (Source of Truth)
        this.mcuData = {
            mode: 'MANUAL',
            front_distance_mm: 1200,
            tor_active: false,
            tor_remaining_ms: 0,
            stop_reason: 'NONE',
            request_reject_reason: 'NONE',
            heartbeat_seq: 0
        };

        // 次回定期送信するワンショット要求
        this.pendingModeRequest = ModeRequest.NONE;
        this.pendingEmergencyStop = false;
        this.pendingResetStop = false;
    }

    /**
     * マイコンへ送信する認識モード client_mode
     */
    getClientMode() {
        switch (this.currentState) {
            case UIState.MANUAL:
            case UIState.AUTO_PENDING:
                return ClientMode.MANUAL;
            case UIState.AUTO:
            case UIState.MANUAL_PENDING:
            case UIState.AUTO_TOR:
                return ClientMode.AUTO;
            case UIState.SAFE_STOP:
                return ClientMode.SAFE_STOP;
            case UIState.EMERGENCY_STOP:
                return ClientMode.EMERGENCY_STOP;
            default:
                return ClientMode.MANUAL;
        }
    }

    /**
     * 100ms周期送信ペイロードを構築
     */
    getTransmitPayload() {
        const isManualDriving = (this.currentState === UIState.MANUAL);

        const payload = {
            client_mode: this.getClientMode(),
            throttle: isManualDriving ? this.app.input.getThrottle() : 0.0,
            steering: isManualDriving ? this.app.input.getSteering() : 0.0,
            mode_request: this.pendingModeRequest,
            emergency_stop_request: this.pendingEmergencyStop,
            reset_stop_request: this.pendingResetStop
        };

        // ワンショット要求フラグをリセット
        this.pendingModeRequest = ModeRequest.NONE;
        this.pendingEmergencyStop = false;
        this.pendingResetStop = false;

        return payload;
    }

    /**
     * Heartbeat 受信ハンドラ (Source of Truth に基づく状態遷移)
     */
    handleHeartbeat(data) {
        this.mcuData = data;

        // 拒否理由がある場合はエラー通知を表示
        if (data.request_reject_reason && data.request_reject_reason !== 'NONE') {
            const reasonMsg = RejectReasonText[data.request_reject_reason] || data.request_reject_reason;
            this.app.ui.showError(`要求拒否: ${reasonMsg}`);
        }

        // 切断状態からの復帰
        if (this.currentState === UIState.DISCONNECTED) {
            this.transitionToMCUState();
            return;
        }

        // AUTO_PENDING 中の判定
        if (this.currentState === UIState.AUTO_PENDING) {
            if (data.mode === 'AUTO') {
                this.clearPendingTimer();
                this.transitionTo(data.tor_active ? UIState.AUTO_TOR : UIState.AUTO);
                return;
            }
            if (data.request_reject_reason !== 'NONE' || data.mode !== 'MANUAL') {
                this.clearPendingTimer();
                this.transitionToMCUState();
                return;
            }
            return; // まだ確定返答待ち
        }

        // MANUAL_PENDING 中の判定
        if (this.currentState === UIState.MANUAL_PENDING) {
            if (data.mode === 'MANUAL') {
                this.clearPendingTimer();
                this.transitionTo(UIState.MANUAL);
                return;
            }
            if (data.mode !== 'AUTO') {
                this.clearPendingTimer();
                this.transitionToMCUState();
                return;
            }
            return;
        }

        // 定常時の同期遷移
        this.transitionToMCUState();
    }

    /**
     * MCUの確定状態（Source of Truth）に基づいて UIState を遷移
     */
    transitionToMCUState() {
        const mode = this.mcuData.mode;

        if (mode === 'EMERGENCY_STOP') {
            this.transitionTo(UIState.EMERGENCY_STOP);
        } else if (mode === 'SAFE_STOP') {
            this.transitionTo(UIState.SAFE_STOP);
        } else if (mode === 'AUTO') {
            if (this.mcuData.tor_active) {
                this.transitionTo(UIState.AUTO_TOR);
            } else {
                this.transitionTo(UIState.AUTO);
            }
        } else if (mode === 'MANUAL') {
            this.transitionTo(UIState.MANUAL);
        }
    }

    transitionTo(newState) {
        this.currentState = newState;

        // 入力有効化 (MANUALモードのみ操作有効、他は自動無効化)
        if (newState === UIState.MANUAL) {
            this.app.input.setEnabled(true);
        } else {
            this.app.input.setEnabled(false);
        }

        // UI描画を確定更新
        this.app.ui.renderState(this.currentState, this.mcuData);
    }

    clearPendingTimer() {
        if (this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
        }
    }

    // --- ユーザー操作トリガー ---

    /**
     * モード切替ボタン押下 (MANUAL ⇄ AUTO)
     */
    requestDriveModeToggle() {
        if (this.currentState === UIState.MANUAL) {
            // MANUAL -> AUTO 切替要求
            this.pendingModeRequest = ModeRequest.AUTO;
            this.transitionTo(UIState.AUTO_PENDING);

            // 1.0秒 Pending タイムアウト監視
            this.pendingTimer = setTimeout(() => {
                if (this.currentState === UIState.AUTO_PENDING) {
                    this.app.ui.showError('モード切替がタイムアウトしました');
                    this.transitionTo(UIState.MANUAL);
                }
            }, 1000);

        } else if (this.currentState === UIState.AUTO) {
            // AUTO -> MANUAL 切替要求
            this.pendingModeRequest = ModeRequest.MANUAL;
            this.transitionTo(UIState.MANUAL_PENDING);

            // 1.0秒 Pending タイムアウト監視 (未達時は再送)
            this.pendingTimer = setTimeout(() => {
                if (this.currentState === UIState.MANUAL_PENDING) {
                    this.app.ui.showError('モード切替がタイムアウトしました (MANUAL要求を再送)');
                    this.pendingModeRequest = ModeRequest.MANUAL;
                }
            }, 1000);
        }
    }

    /**
     * 非常停止ボタン押下 (最優先)
     */
    requestEmergencyStop() {
        this.pendingEmergencyStop = true;
        this.clearPendingTimer();
        this.transitionTo(UIState.EMERGENCY_STOP);
    }

    /**
     * SAFE_STOP / EMERGENCY_STOP 解除・リセットボタン押下
     */
    requestResetStop() {
        this.pendingResetStop = true;
    }

    /**
     * TOR警告画面の「手動操作へ切替」ボタン押下
     */
    requestTorTakeover() {
        this.pendingModeRequest = ModeRequest.MANUAL;
    }

    handleDisconnect() {
        this.clearPendingTimer();
        this.transitionTo(UIState.DISCONNECTED);
    }

    handleConnect() {
        this.transitionToMCUState();
    }
}

// ==========================================
// 5. Mini4WDApp クラス (メインオーケストレーター)
// ==========================================

class Mini4WDApp {
    constructor() {
        // 1. 入力コントローラー
        this.input = new InputController(() => this.stateMachine.requestEmergencyStop());

        // 2. UIマネージャー
        this.ui = new UIManager({
            onDriveModeClick: () => this.stateMachine.requestDriveModeToggle(),
            onEmergencyStopClick: () => this.stateMachine.requestEmergencyStop(),
            onResetStopClick: () => this.stateMachine.requestResetStop(),
            onTorTakeoverClick: () => this.stateMachine.requestTorTakeover()
        });

        // 3. ステートマシン
        this.stateMachine = new StateMachine(this);

        // 4. 通信マネージャー
        this.comm = new CommManager({
            onConnect: () => this.stateMachine.handleConnect(),
            onDisconnect: () => this.stateMachine.handleDisconnect(),
            onHeartbeat: (data) => this.stateMachine.handleHeartbeat(data),
            getTransmitPayload: () => this.stateMachine.getTransmitPayload()
        });

        // 5. 描画ループ & FPS計測 (60 FPS)
        this.frameCount = 0;
        this.lastFpsTimestamp = performance.now();
        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    loop(timestamp) {
        this.frameCount++;
        if (timestamp - this.lastFpsTimestamp >= 1000) {
            const fps = this.frameCount;
            this.ui.updateFPS(fps);
            this.frameCount = 0;
            this.lastFpsTimestamp = timestamp;
        }

        // ゲームパッド状態をポーリング
        this.input.pollGamepad();
        this.ui.updateGamepadStatus(this.input.gamepadConnected);

        // メーター・ゲージを描画
        this.ui.renderGauges(this.input.getThrottle(), this.input.getSteering());

        requestAnimationFrame(this.loop);
    }
}

// アプリケーション起動
window.addEventListener('DOMContentLoaded', () => {
    window.app = new Mini4WDApp();
});
