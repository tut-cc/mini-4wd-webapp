/**
 * 状態遷移マシンモジュール
 */
import { UIState, MCUMode, ModeRequest, RejectReasonText, Config } from './constants.js';

const CLIENT_MODE = {
    [UIState.MANUAL]: 'MANUAL',
    [UIState.AUTO_PENDING]: 'MANUAL',
    [UIState.AUTO]: 'AUTO',
    [UIState.MANUAL_PENDING]: 'AUTO',
    [UIState.AUTO_TOR]: 'AUTO',
    [UIState.SAFE_STOP]: 'SAFE_STOP',
    [UIState.EMERGENCY_STOP]: 'EMERGENCY_STOP'
};

export class StateMachine {
    constructor(app) {
        this.app = app;
        this.state = UIState.DISCONNECTED;
        this.pendingTimer = null;
        this.mcuData = { mode: MCUMode.MANUAL, front_distance_mm: 1200 };
        this.pendingModeRequest = ModeRequest.NONE;
        this.pendingEmergencyStop = false;
        this.pendingResetStop = false;
    }

    getTransmitPayload() {
        const isManual = this.state === UIState.MANUAL;
        const payload = {
            client_mode: CLIENT_MODE[this.state] || 'MANUAL',
            throttle: isManual ? this.app.input.getThrottle() : 0,
            steering: isManual ? this.app.input.getSteering() : 0,
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
        if (data.request_reject_reason && data.request_reject_reason !== 'NONE') {
            this.app.ui.showError(`REJECTED: ${RejectReasonText[data.request_reject_reason] || data.request_reject_reason}`);
        }

        if (this.state === UIState.DISCONNECTED) return this.syncToMCU();

        if (this.state === UIState.AUTO_PENDING) {
            if (data.mode === MCUMode.AUTO) {
                this.clearTimer();
                return this.transitionTo(data.tor_active ? UIState.AUTO_TOR : UIState.AUTO);
            }
            if (data.request_reject_reason !== 'NONE' || data.mode !== MCUMode.MANUAL) {
                this.clearTimer();
                return this.syncToMCU();
            }
            return;
        }

        if (this.state === UIState.MANUAL_PENDING) {
            if (data.mode === MCUMode.MANUAL) {
                this.clearTimer();
                return this.transitionTo(UIState.MANUAL);
            }
            if (data.mode !== MCUMode.AUTO) {
                this.clearTimer();
                return this.syncToMCU();
            }
            return;
        }

        this.syncToMCU();
    }

    syncToMCU() {
        const { mode, tor_active } = this.mcuData;
        if (mode === MCUMode.EMERGENCY_STOP) return this.transitionTo(UIState.EMERGENCY_STOP);
        if (mode === MCUMode.SAFE_STOP) return this.transitionTo(UIState.SAFE_STOP);
        if (mode === MCUMode.AUTO) return this.transitionTo(tor_active ? UIState.AUTO_TOR : UIState.AUTO);
        this.transitionTo(UIState.MANUAL);
    }

    transitionTo(newState) {
        this.state = newState;
        this.app.input.setEnabled(newState === UIState.MANUAL);
        this.app.ui.renderState(this.state, this.mcuData);
    }

    clearTimer() {
        if (this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
        }
    }

    requestDriveModeToggle() {
        if (this.state === UIState.MANUAL) {
            this.pendingModeRequest = ModeRequest.AUTO;
            this.transitionTo(UIState.AUTO_PENDING);
            this.pendingTimer = setTimeout(() => {
                if (this.state === UIState.AUTO_PENDING) {
                    this.app.ui.showError('MODE SWITCH TIMEOUT');
                    this.transitionTo(UIState.MANUAL);
                }
            }, Config.MODE_SWITCH_TIMEOUT_MS);
        } else if (this.state === UIState.AUTO) {
            this.pendingModeRequest = ModeRequest.MANUAL;
            this.transitionTo(UIState.MANUAL_PENDING);
            this.pendingTimer = setTimeout(() => {
                if (this.state === UIState.MANUAL_PENDING) {
                    this.app.ui.showError('MODE SWITCH TIMEOUT (RESENDING)');
                    this.pendingModeRequest = ModeRequest.MANUAL;
                }
            }, Config.MODE_SWITCH_TIMEOUT_MS);
        }
    }

    requestEmergencyStop() {
        this.pendingEmergencyStop = true;
        this.clearTimer();
        this.transitionTo(UIState.EMERGENCY_STOP);
    }

    requestResetStop() { this.pendingResetStop = true; }
    requestTorTakeover() { this.pendingModeRequest = ModeRequest.MANUAL; }
    handleDisconnect() { this.clearTimer(); this.transitionTo(UIState.DISCONNECTED); }
    handleConnect() { this.syncToMCU(); }
}
