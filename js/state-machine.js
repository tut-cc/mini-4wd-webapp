/**
 * 状態遷移マシンモジュール (UI状態遷移 & 安全ルール管理)
 */

import {
    UIState,
    ClientMode,
    MCUMode,
    ModeRequest,
    StopReason,
    RejectReason,
    RejectReasonText,
    Config
} from './constants.js';

const CLIENT_MODE_MAP = {
    [UIState.MANUAL]: ClientMode.MANUAL,
    [UIState.AUTO_PENDING]: ClientMode.MANUAL,
    [UIState.AUTO]: ClientMode.AUTO,
    [UIState.MANUAL_PENDING]: ClientMode.AUTO,
    [UIState.AUTO_TOR]: ClientMode.AUTO,
    [UIState.SAFE_STOP]: ClientMode.SAFE_STOP,
    [UIState.EMERGENCY_STOP]: ClientMode.EMERGENCY_STOP
};

export class StateMachine {
    constructor(app) {
        this.app = app;
        this.currentState = UIState.DISCONNECTED;
        this.pendingTimer = null;

        this.mcuData = {
            mode: MCUMode.MANUAL,
            front_distance_mm: 1200,
            tor_active: false,
            tor_remaining_ms: 0,
            stop_reason: StopReason.NONE,
            request_reject_reason: RejectReason.NONE,
            heartbeat_seq: 0
        };

        this.pendingModeRequest = ModeRequest.NONE;
        this.pendingEmergencyStop = false;
        this.pendingResetStop = false;
    }

    getClientMode() {
        return CLIENT_MODE_MAP[this.currentState] ?? ClientMode.MANUAL;
    }

    getTransmitPayload() {
        const isManual = (this.currentState === UIState.MANUAL);
        const payload = {
            client_mode: this.getClientMode(),
            throttle: isManual ? this.app.input.getThrottle() : 0.0,
            steering: isManual ? this.app.input.getSteering() : 0.0,
            mode_request: this.pendingModeRequest,
            emergency_stop_request: this.pendingEmergencyStop,
            reset_stop_request: this.pendingResetStop
        };

        this.pendingModeRequest = ModeRequest.NONE;
        this.pendingEmergencyStop = false;
        this.pendingResetStop = false;
        return payload;
    }

    handleHeartbeat(data) {
        this.mcuData = data;

        if (data.request_reject_reason && data.request_reject_reason !== RejectReason.NONE) {
            const reasonMsg = RejectReasonText[data.request_reject_reason] || data.request_reject_reason;
            this.app.ui.showError(`REJECTED: ${reasonMsg}`);
        }

        if (this.currentState === UIState.DISCONNECTED) {
            return this.transitionToMCUState();
        }

        if (this.currentState === UIState.AUTO_PENDING) {
            if (data.mode === MCUMode.AUTO) {
                this.clearPendingTimer();
                return this.transitionTo(data.tor_active ? UIState.AUTO_TOR : UIState.AUTO);
            }
            if (data.request_reject_reason !== RejectReason.NONE || data.mode !== MCUMode.MANUAL) {
                this.clearPendingTimer();
                return this.transitionToMCUState();
            }
            return;
        }

        if (this.currentState === UIState.MANUAL_PENDING) {
            if (data.mode === MCUMode.MANUAL) {
                this.clearPendingTimer();
                return this.transitionTo(UIState.MANUAL);
            }
            if (data.mode !== MCUMode.AUTO) {
                this.clearPendingTimer();
                return this.transitionToMCUState();
            }
            return;
        }

        this.transitionToMCUState();
    }

    transitionToMCUState() {
        const { mode, tor_active } = this.mcuData;
        if (mode === MCUMode.EMERGENCY_STOP) return this.transitionTo(UIState.EMERGENCY_STOP);
        if (mode === MCUMode.SAFE_STOP) return this.transitionTo(UIState.SAFE_STOP);
        if (mode === MCUMode.AUTO) return this.transitionTo(tor_active ? UIState.AUTO_TOR : UIState.AUTO);
        this.transitionTo(UIState.MANUAL);
    }

    transitionTo(newState) {
        this.currentState = newState;
        this.app.input.setEnabled(newState === UIState.MANUAL);
        this.app.ui.renderState(this.currentState, this.mcuData);
    }

    clearPendingTimer() {
        if (this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
        }
    }

    requestDriveModeToggle() {
        if (this.currentState === UIState.MANUAL) {
            this.pendingModeRequest = ModeRequest.AUTO;
            this.transitionTo(UIState.AUTO_PENDING);

            this.pendingTimer = setTimeout(() => {
                if (this.currentState === UIState.AUTO_PENDING) {
                    this.app.ui.showError('MODE SWITCH TIMEOUT');
                    this.transitionTo(UIState.MANUAL);
                }
            }, Config.MODE_SWITCH_TIMEOUT_MS);

        } else if (this.currentState === UIState.AUTO) {
            this.pendingModeRequest = ModeRequest.MANUAL;
            this.transitionTo(UIState.MANUAL_PENDING);

            this.pendingTimer = setTimeout(() => {
                if (this.currentState === UIState.MANUAL_PENDING) {
                    this.app.ui.showError('MODE SWITCH TIMEOUT (RESENDING)');
                    this.pendingModeRequest = ModeRequest.MANUAL;
                }
            }, Config.MODE_SWITCH_TIMEOUT_MS);
        }
    }

    requestEmergencyStop() {
        this.pendingEmergencyStop = true;
        this.clearPendingTimer();
        this.transitionTo(UIState.EMERGENCY_STOP);
    }

    requestResetStop() {
        this.pendingResetStop = true;
    }

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
