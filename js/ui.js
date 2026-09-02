/**
 * UI管理モジュール (HUD、モーダルダイアログ)
 */
import { UIState, StopReasonText, Config } from './constants.js';

const $ = (id) => document.getElementById(id);

export class UIManager {
    constructor(callbacks = {}) {
        this.cb = callbacks;
        this.alertTimer = null;

        // DOMキャッシュ
        this.el = {
            statusBadge: $('status-badge'),
            statusText: $('status-text'),
            distance: $('distance-val'),
            btnMode: $('btn-mode'),
            btnStop: $('btn-stop'),
            stopReason: $('stop-reason'),
            stopReasonText: $('stop-reason-text'),
            alert: $('alert-banner'),
            torOverlay: $('tor-overlay'),
            torCountdown: $('tor-countdown'),
            disOverlay: $('disconnected-overlay'),
            infoModal: $('info-modal')
        };

        this.initEvents();
    }

    initEvents() {
        this.el.btnMode?.addEventListener('click', () => this.cb.onDriveModeClick?.());
        this.el.btnStop?.addEventListener('click', () => this.cb.onStopClick?.());
        $('btn-takeover')?.addEventListener('click', () => this.cb.onTorTakeoverClick?.());
        $('btn-info')?.addEventListener('click', () => this.el.infoModal?.classList.remove('hidden'));
        
        // 背景タップ/クリックで閉じる
        this.el.infoModal?.addEventListener('click', (e) => {
            if (e.target === this.el.infoModal) {
                this.el.infoModal.classList.add('hidden');
            }
        });
    }

    renderState(uiState, mcuData) {
        const isDis = uiState === UIState.DISCONNECTED;
        const isAborted = uiState === UIState.AUTO_ABORT || uiState === UIState.MANUAL_ABORT;
        const isTor = uiState === UIState.AUTO_TOR || uiState === UIState.TOR_MANUAL_PENDING;
        const isPending = uiState === UIState.AUTO_PENDING || uiState === UIState.AUTO_MANUAL_PENDING || uiState === UIState.TOR_MANUAL_PENDING;
        const isAuto = uiState === UIState.AUTO || uiState === UIState.AUTO_PENDING || uiState === UIState.AUTO_MANUAL_PENDING;

        if (this.el.statusText) this.el.statusText.textContent = isDis ? '未接続' : '接続中';
        if (this.el.statusBadge) this.el.statusBadge.classList.toggle('disconnected', isDis);
        this.el.disOverlay?.classList.toggle('hidden', !isDis);
        this.el.torOverlay?.classList.toggle('hidden', !isTor);

        if (isTor && mcuData?.tor_remaining_ms !== undefined && this.el.torCountdown) {
            this.el.torCountdown.textContent = (mcuData.tor_remaining_ms / 1000).toFixed(1);
        }

        if (this.el.distance) this.el.distance.textContent = mcuData?.front_distance_mm ?? '--';
        this.el.stopReason?.classList.toggle('hidden', !isAborted);
        if (isAborted && this.el.stopReasonText) {
            let r = mcuData?.stop_reason;
            if (!r || r === 'NONE') {
                r = (uiState === UIState.MANUAL_ABORT) ? 'MANUAL_ABORT_BUTTON' : 'OBSTACLE';
            }
            this.el.stopReasonText.textContent = StopReasonText[r] || r;
        }

        if (this.el.btnMode) {
            this.el.btnMode.textContent = isAuto ? 'AUTO MODE' : 'MANUAL MODE';
            this.el.btnMode.classList.toggle('auto-mode', isAuto);
            this.el.btnMode.classList.toggle('pending', isPending);
            this.el.btnMode.disabled = isDis || isPending || isAborted || isTor;
        }

        if (this.el.btnStop) {
            this.el.btnStop.textContent = isAborted ? 'RESET' : 'ABORT';
            this.el.btnStop.classList.toggle('reset-mode', isAborted);
            this.el.btnStop.disabled = isDis;
        }
    }

    showError(msg) {
        if (this.el.alert) this.el.alert.textContent = msg;
        this.el.alert?.classList.remove('hidden');
        clearTimeout(this.alertTimer);
        this.alertTimer = setTimeout(() => this.el.alert?.classList.add('hidden'), Config.ALERT_DISPLAY_DURATION_MS);
    }
}
