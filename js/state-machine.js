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
            this.transitionToMCUState();
            return;
        }

        if (this.currentState === UIState.AUTO_PENDING) {
            if (data.mode === MCUMode.AUTO) {
                this.clearPendingTimer();
                this.transitionTo(data.tor_active ? UIState.AUTO_TOR : UIState.AUTO);
                return;
            }
            if (data.request_reject_reason !== RejectReason.NONE || data.mode !== MCUMode.MANUAL) {
                this.clearPendingTimer();
                this.transitionToMCUState();
                return;
            }
            return;
        }

        if (this.currentState === UIState.MANUAL_PENDING) {
            if (data.mode === MCUMode.MANUAL) {
                this.clearPendingTimer();
                this.transitionTo(UIState.MANUAL);
                return;
            }
            if (data.mode !== MCUMode.AUTO) {
                this.clearPendingTimer();
                this.transitionToMCUState();
                return;
            }
            return;
        }

        this.transitionToMCUState();
    }

    transitionToMCUState() {
        const mode = this.mcuData.mode;

        if (mode === MCUMode.EMERGENCY_STOP) {
            this.transitionTo(UIState.EMERGENCY_STOP);
        } else if (mode === MCUMode.SAFE_STOP) {
            this.transitionTo(UIState.SAFE_STOP);
        } else if (mode === MCUMode.AUTO) {
            if (this.mcuData.tor_active) {
                this.transitionTo(UIState.AUTO_TOR);
            } else {
                this.transitionTo(UIState.AUTO);
            }
        } else if (mode === MCUMode.MANUAL) {
            this.transitionTo(UIState.MANUAL);
        }
    }

    transitionTo(newState) {
        this.currentState = newState;

        if (newState === UIState.MANUAL) {
            this.app.input.setEnabled(true);
        } else {
            this.app.input.setEnabled(false);
        }

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
