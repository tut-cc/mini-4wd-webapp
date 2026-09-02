import { UIState, MCUMode, ModeRequest, RejectReasonText, Config } from './constants.js';

export class StateMachine {
    constructor(app) {
        this.app = app;
        this.state = UIState.DISCONNECTED;
        this.timer = null;
        this.mcuData = { mode: MCUMode.MANUAL, front_distance_mm: 1200 };
        this.pendingModeRequest = ModeRequest.NONE;
        this.pendingManualAbort = false;
        this.pendingResetAbort = false;
    }

    getTransmitPayload() {
        const isManual = this.state === UIState.MANUAL;
        const payload = {
            client_mode: this.state.includes('ABORT') ? this.state : (this.state.startsWith('AUTO') ? 'AUTO' : 'MANUAL'),
            throttle: isManual ? this.app.input.getThrottle() : 0,
            steering: isManual ? this.app.input.getSteering() : 0,
            mode_request: this.pendingModeRequest,
            manual_abort_request: this.pendingManualAbort,
            reset_abort_request: this.pendingResetAbort
        };
        this.pendingModeRequest = ModeRequest.NONE;
        this.pendingManualAbort = this.pendingResetAbort = false;
        return payload;
    }

    handleHeartbeat(data) {
        this.mcuData = data;
        if (data.request_reject_reason && data.request_reject_reason !== 'NONE') {
            this.app.ui.showError(`切替拒否: ${RejectReasonText[data.request_reject_reason] || data.request_reject_reason}`);
        }

        if (this.state === UIState.AUTO_PENDING) {
            if (data.mode === MCUMode.AUTO) { this.clearTimer(); return this.transitionTo(data.tor_active ? UIState.AUTO_TOR : UIState.AUTO); }
            if (data.request_reject_reason !== 'NONE' || data.mode !== MCUMode.MANUAL) { this.clearTimer(); return this.syncToMCU(); }
            return;
        }

        if (this.state.endsWith('_PENDING')) {
            if (data.mode === MCUMode.MANUAL) { this.clearTimer(); return this.transitionTo(UIState.MANUAL); }
            if (data.mode !== MCUMode.AUTO) { this.clearTimer(); return this.syncToMCU(); }
            return;
        }

        this.syncToMCU();
    }

    syncToMCU() {
        const { mode, tor_active } = this.mcuData;
        this.transitionTo(
            mode === MCUMode.MANUAL_ABORT ? UIState.MANUAL_ABORT :
            mode === MCUMode.AUTO_ABORT ? UIState.AUTO_ABORT :
            mode === MCUMode.AUTO ? (tor_active ? UIState.AUTO_TOR : UIState.AUTO) : UIState.MANUAL
        );
    }

    transitionTo(newState) {
        this.state = newState;
        this.app.input.setEnabled(newState === UIState.MANUAL);
        this.app.ui.renderState(this.state, this.mcuData);
    }

    clearTimer() {
        clearTimeout(this.timer);
        this.timer = null;
    }

    startManualSwitch(fromTor = false) {
        this.pendingModeRequest = ModeRequest.MANUAL;
        const target = fromTor ? UIState.TOR_MANUAL_PENDING : UIState.AUTO_MANUAL_PENDING;
        this.transitionTo(target);
        this.clearTimer();
        this.timer = setTimeout(function retry() {
            if (this.state === target) {
                this.app.ui.showError('切替応答待ち (手動復帰を再送中...)');
                this.pendingModeRequest = ModeRequest.MANUAL;
                this.timer = setTimeout(retry.bind(this), Config.MODE_SWITCH_TIMEOUT_MS);
            }
        }.bind(this), Config.MODE_SWITCH_TIMEOUT_MS);
    }

    requestDriveModeToggle() {
        if (this.state === UIState.MANUAL) {
            this.pendingModeRequest = ModeRequest.AUTO;
            this.transitionTo(UIState.AUTO_PENDING);
            this.clearTimer();
            this.timer = setTimeout(() => {
                if (this.state === UIState.AUTO_PENDING) {
                    this.app.ui.showError('モード切替タイムアウト');
                    this.transitionTo(UIState.MANUAL);
                }
            }, Config.MODE_SWITCH_TIMEOUT_MS);
        } else if (this.state.startsWith('AUTO')) {
            this.startManualSwitch(this.state === UIState.AUTO_TOR);
        }
    }

    requestAbortAction() {
        if (this.state.includes('ABORT')) this.pendingResetAbort = true;
        else { this.pendingManualAbort = true; this.clearTimer(); }
    }

    requestTorTakeover() { this.startManualSwitch(true); }
    handleDisconnect() { this.clearTimer(); this.transitionTo(UIState.DISCONNECTED); }
    handleConnect() { this.syncToMCU(); }
}
