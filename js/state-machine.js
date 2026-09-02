/**
 * 状態遷移マシンモジュール
 */
import { UIState, MCUMode, ModeRequest, RejectReasonText, Config } from './constants.js';

const CLIENT_MODE = {
    [UIState.MANUAL]: 'MANUAL',
    [UIState.AUTO_PENDING]: 'MANUAL',
    [UIState.AUTO]: 'AUTO',
    [UIState.AUTO_MANUAL_PENDING]: 'AUTO',
    [UIState.TOR_MANUAL_PENDING]: 'AUTO',
    [UIState.AUTO_TOR]: 'AUTO',
    [UIState.AUTO_ABORT]: 'AUTO_ABORT',
    [UIState.MANUAL_ABORT]: 'MANUAL_ABORT'
};

export class StateMachine {
    constructor(app) {
        this.app = app;
        this.state = UIState.DISCONNECTED;
        this.pendingTimer = null;
        this.mcuData = { mode: MCUMode.MANUAL, front_distance_mm: 1200 };
        this.pendingModeRequest = ModeRequest.NONE;
        this.pendingManualAbort = false;
        this.pendingResetAbort = false;
    }

    getTransmitPayload() {
        const isManual = this.state === UIState.MANUAL;
        const payload = {
            client_mode: CLIENT_MODE[this.state] || 'MANUAL',
            throttle: isManual ? this.app.input.getThrottle() : 0,
            steering: isManual ? this.app.input.getSteering() : 0,
            mode_request: this.pendingModeRequest,
            manual_abort_request: this.pendingManualAbort,
            reset_abort_request: this.pendingResetAbort
        };
        this.pendingModeRequest = ModeRequest.NONE;
        this.pendingManualAbort = false;
        this.pendingResetAbort = false;
        return payload;
    }

    handleHeartbeat(data) {
        this.mcuData = data;
        if (data.request_reject_reason && data.request_reject_reason !== 'NONE') {
            this.app.ui.showError(`切替拒否: ${RejectReasonText[data.request_reject_reason] || data.request_reject_reason}`);
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

        if (this.state === UIState.AUTO_MANUAL_PENDING || this.state === UIState.TOR_MANUAL_PENDING) {
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
        if (mode === MCUMode.MANUAL_ABORT) return this.transitionTo(UIState.MANUAL_ABORT);
        if (mode === MCUMode.AUTO_ABORT) return this.transitionTo(UIState.AUTO_ABORT);
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

    startManualSwitch(fromTor = false) {
        this.pendingModeRequest = ModeRequest.MANUAL;
        const targetState = fromTor ? UIState.TOR_MANUAL_PENDING : UIState.AUTO_MANUAL_PENDING;
        this.transitionTo(targetState);
        this.scheduleManualResend(targetState);
    }

    scheduleManualResend(targetState) {
        this.clearTimer();
        this.pendingTimer = setTimeout(() => {
            if (this.state === targetState) {
                this.app.ui.showError('切替応答待ち (手動復帰を再送中...)');
                this.pendingModeRequest = ModeRequest.MANUAL;
                this.scheduleManualResend(targetState);
            }
        }, Config.MODE_SWITCH_TIMEOUT_MS);
    }

    requestDriveModeToggle() {
        if (this.state === UIState.MANUAL) {
            this.pendingModeRequest = ModeRequest.AUTO;
            this.transitionTo(UIState.AUTO_PENDING);
            this.pendingTimer = setTimeout(() => {
                if (this.state === UIState.AUTO_PENDING) {
                    this.app.ui.showError('モード切替タイムアウト');
                    this.transitionTo(UIState.MANUAL);
                }
            }, Config.MODE_SWITCH_TIMEOUT_MS);
        } else if (this.state === UIState.AUTO) {
            this.startManualSwitch(false);
        } else if (this.state === UIState.AUTO_TOR) {
            this.startManualSwitch(true);
        }
    }

    requestAbortAction() {
        if (this.state === UIState.AUTO_ABORT || this.state === UIState.MANUAL_ABORT) {
            this.requestResetAbort();
        } else {
            this.requestManualAbort();
        }
    }

    requestManualAbort() {
        this.pendingManualAbort = true;
        this.clearTimer();
    }

    requestResetAbort() {
        this.pendingResetAbort = true;
    }

    requestTorTakeover() {
        this.startManualSwitch(true);
    }

    handleDisconnect() {
        this.clearTimer();
        this.transitionTo(UIState.DISCONNECTED);
    }

    handleConnect() {
        this.syncToMCU();
    }
}
