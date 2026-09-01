/**
 * UI管理モジュール (HUD、モーダルダイアログ)
 */
import { UIState, StopReasonText, Config } from './constants.js';

const $ = (id) => document.getElementById(id);

export class UIManager {
    constructor(callbacks = {}) {
        this.cb = callbacks;
        this.alertTimer = null;

        // キャッシュ
        this.el = {
            wsStatus: $('ws-status'),
            wsStatusText: $('ws-status-text'),
            distance: $('distance-badge'),
            btnMode: $('btn-drive-mode'),
            btnModeText: $('btn-drive-mode-text'),
            btnStop: $('btn-emergency-stop'),
            btnStopText: $('btn-emergency-stop-text'),
            stopReasonHud: $('stop-reason-hud'),
            stopReasonText: $('status-stop-reason'),
            alertBanner: $('alert-banner'),
            alertMsg: $('alert-message'),
            torOverlay: $('tor-overlay'),
            torCountdown: $('tor-countdown'),
            disOverlay: $('disconnected-overlay'),
            aboutModal: $('about-modal')
        };

        this.initEvents();
    }

    initEvents() {
        this.el.btnMode?.addEventListener('click', () => this.cb.onDriveModeClick?.());
        this.el.btnStop?.addEventListener('click', () => this.cb.onStopClick?.());
        $('btn-tor-takeover')?.addEventListener('click', () => this.cb.onTorTakeoverClick?.());
        $('btn-about')?.addEventListener('click', () => this.el.aboutModal?.classList.remove('hidden'));
        $('btn-close-about')?.addEventListener('click', () => this.el.aboutModal?.classList.add('hidden'));
    }

    renderState(uiState, mcuData) {
        const isDis = uiState === UIState.DISCONNECTED;
        const isStopped = uiState === UIState.SAFE_STOP || uiState === UIState.EMERGENCY_STOP;
        const isTor = uiState === UIState.AUTO_TOR;
        const isPending = uiState === UIState.AUTO_PENDING || uiState === UIState.MANUAL_PENDING;
        const isAuto = uiState === UIState.AUTO || uiState === UIState.AUTO_PENDING;

        if (this.el.wsStatusText) this.el.wsStatusText.textContent = isDis ? '未接続' : '接続中';
        if (this.el.wsStatus) this.el.wsStatus.className = `hud-badge status-badge ${isDis ? 'disconnected' : 'connected'}`;
        this.el.disOverlay?.classList.toggle('hidden', !isDis);
        this.el.torOverlay?.classList.toggle('hidden', !isTor);

        if (isTor && mcuData?.tor_remaining_ms !== undefined && this.el.torCountdown) {
            this.el.torCountdown.textContent = (mcuData.tor_remaining_ms / 1000).toFixed(1);
        }

        if (this.el.distance) this.el.distance.textContent = mcuData?.front_distance_mm ?? '--';
        this.el.stopReasonHud?.classList.toggle('hidden', !isStopped);
        if (isStopped && this.el.stopReasonText) {
            let r = mcuData?.stop_reason;
            if (!r || r === 'NONE') {
                r = uiState === UIState.EMERGENCY_STOP ? 'EMERGENCY_BUTTON' : 'OBSTACLE';
            }
            this.el.stopReasonText.textContent = StopReasonText[r] || r;
        }

        if (this.el.btnMode) {
            if (this.el.btnModeText) this.el.btnModeText.textContent = isAuto ? 'AUTO MODE' : 'MANUAL MODE';
            this.el.btnMode.classList.toggle('auto-mode', isAuto);
            this.el.btnMode.classList.toggle('pending', isPending);
            this.el.btnMode.disabled = isDis || isPending || isStopped || isTor;
        }

        if (this.el.btnStop) {
            if (this.el.btnStopText) this.el.btnStopText.textContent = isStopped ? 'RESET' : 'STOP';
            this.el.btnStop.classList.toggle('reset-mode', isStopped);
            this.el.btnStop.disabled = isDis;
        }
    }

    showError(msg) {
        if (this.el.alertMsg) this.el.alertMsg.textContent = msg;
        this.el.alertBanner?.classList.remove('hidden');
        clearTimeout(this.alertTimer);
        this.alertTimer = setTimeout(() => this.el.alertBanner?.classList.add('hidden'), Config.ALERT_DISPLAY_DURATION_MS);
    }
}
