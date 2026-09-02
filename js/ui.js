/**
 * UI管理モジュール (HUD、ダイアログ、状態バインド)
 */
import { UIState, StopReasonText, Config } from './constants.js';

const $ = (id) => document.getElementById(id);

export class UIManager {
    constructor(callbacks = {}) {
        this.cb = callbacks;
        this.alertTimer = null;

        // DOM参照
        this.el = {
            statusText: $('status-text'),
            distance: $('distance-val'),
            btnMode: $('btn-mode'),
            btnStop: $('btn-stop'),
            stopReasonText: $('stop-reason-text'),
            alert: $('alert-banner'),
            torCountdown: $('tor-countdown')
        };

        this.initEvents();
        this.requestWakeLock();
    }

    async requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                await navigator.wakeLock.request('screen');
            }
        } catch (_) {}
    }

    initEvents() {
        this.el.btnMode?.addEventListener('click', () => this.cb.onDriveModeClick?.());
        this.el.btnStop?.addEventListener('click', () => this.cb.onStopClick?.());
        $('btn-takeover')?.addEventListener('click', () => this.cb.onTorTakeoverClick?.());
        // INFO モーダルは HTML Popover API により自動管理 (JSイベントリスナー不要)
    }

    renderState(uiState, mcuData) {
        // body の data-state を切り替えるだけで CSS がオーバーレイやボタンスタイルを一括制御
        document.body.dataset.state = uiState;

        const isDis = uiState === UIState.DISCONNECTED;
        const isAborted = uiState === UIState.AUTO_ABORT || uiState === UIState.MANUAL_ABORT;
        const isTor = uiState === UIState.AUTO_TOR || uiState === UIState.TOR_MANUAL_PENDING;
        const isAuto = uiState.startsWith('AUTO');

        if (this.el.statusText) this.el.statusText.textContent = isDis ? '未接続' : '接続中';
        if (this.el.distance) this.el.distance.textContent = mcuData?.front_distance_mm ?? '--';
        if (this.el.btnMode) this.el.btnMode.textContent = isAuto ? 'AUTO MODE' : 'MANUAL MODE';
        if (this.el.btnStop) this.el.btnStop.textContent = isAborted ? 'RESET' : 'ABORT';

        if (isTor && mcuData?.tor_remaining_ms !== undefined && this.el.torCountdown) {
            this.el.torCountdown.textContent = (mcuData.tor_remaining_ms / 1000).toFixed(1);
        }

        if (isAborted && this.el.stopReasonText) {
            let r = mcuData?.stop_reason;
            if (!r || r === 'NONE') {
                r = (uiState === UIState.MANUAL_ABORT) ? 'MANUAL_ABORT_BUTTON' : 'OBSTACLE';
            }
            this.el.stopReasonText.textContent = StopReasonText[r] || r;
        }
    }

    showError(msg) {
        if (!this.el.alert) return;
        this.el.alert.textContent = msg;
        try {
            this.el.alert.showPopover?.();
        } catch (_) {}
        clearTimeout(this.alertTimer);
        this.alertTimer = setTimeout(() => {
            try { this.el.alert.hidePopover?.(); } catch (_) {}
        }, Config.ALERT_DISPLAY_DURATION_MS);
    }
}

