/**
 * UI管理モジュール (HUD、ゲージ、モーダルダイアログ)
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
            fps: $('fps-counter'),
            throttleFill: $('throttle-bar-fill'),
            steeringFill: $('steering-bar-fill'),
            throttleVal: $('throttle-value'),
            steeringVal: $('steering-value'),
            btnMode: $('btn-drive-mode'),
            btnModeText: $('btn-drive-mode-text'),
            btnReset: $('btn-reset-stop'),
            btnResetText: $('btn-reset-stop-text'),
            btnStop: $('btn-emergency-stop'),
            stopReasonHud: $('stop-reason-hud'),
            stopReasonText: $('status-stop-reason'),
            alertBanner: $('alert-banner'),
            alertMsg: $('alert-message'),
            torOverlay: $('tor-overlay'),
            torCountdown: $('tor-countdown'),
            disOverlay: $('disconnected-overlay'),
            aboutModal: $('about-modal'),
            camModal: $('camera-modal'),
            camInput: $('camera-url-input')
        };

        this.initEvents();
    }

    initEvents() {
        this.el.btnMode?.addEventListener('click', () => this.cb.onDriveModeClick?.());
        this.el.btnStop?.addEventListener('click', () => this.cb.onEmergencyStopClick?.());
        this.el.btnReset?.addEventListener('click', () => this.cb.onResetStopClick?.());
        $('btn-tor-takeover')?.addEventListener('click', () => this.cb.onTorTakeoverClick?.());

        $('btn-fullscreen')?.addEventListener('click', () => {
            document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : document.documentElement.requestFullscreen().catch(() => {});
        });
        $('btn-about')?.addEventListener('click', () => this.el.aboutModal?.classList.remove('hidden'));
        $('btn-close-about')?.addEventListener('click', () => this.el.aboutModal?.classList.add('hidden'));

        $('btn-camera-settings')?.addEventListener('click', () => {
            if (this.el.camInput) this.el.camInput.value = localStorage.getItem(Config.STORAGE_KEY_CAMERA_URL) || Config.DEFAULT_CAMERA_URL;
            this.el.camModal?.classList.remove('hidden');
        });
        $('btn-close-camera')?.addEventListener('click', () => this.el.camModal?.classList.add('hidden'));
        $('btn-save-camera')?.addEventListener('click', () => {
            const url = this.el.camInput?.value.trim() || Config.DEFAULT_CAMERA_URL;
            this.cb.onCameraSettingsSave?.(url);
            this.el.camModal?.classList.add('hidden');
        });
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
            const r = mcuData?.stop_reason || 'NONE';
            this.el.stopReasonText.textContent = StopReasonText[r] || r;
        }

        this.el.btnMode?.classList.toggle('hidden', isStopped || isTor);
        this.el.btnReset?.classList.toggle('hidden', !isStopped);

        if (!isStopped && !isTor && this.el.btnMode) {
            if (this.el.btnModeText) this.el.btnModeText.textContent = isAuto ? 'AUTO MODE' : 'MANUAL MODE';
            this.el.btnMode.classList.toggle('auto-mode', isAuto);
            this.el.btnMode.classList.toggle('pending', isPending);
            this.el.btnMode.disabled = isDis || isPending;
        }

        if (isStopped && this.el.btnReset) {
            if (this.el.btnResetText) this.el.btnResetText.textContent = 'RESET / 再開';
            this.el.btnReset.disabled = isDis;
        }

        if (this.el.btnStop) this.el.btnStop.disabled = isDis || uiState === UIState.EMERGENCY_STOP;
    }

    renderGauges(thr, str) {
        const tPct = Math.round(thr * 100);
        const sPct = Math.round(str * 100);
        if (this.el.throttleVal) this.el.throttleVal.textContent = `${tPct > 0 ? '+' : ''}${tPct}%`;
        if (this.el.steeringVal) this.el.steeringVal.textContent = `${sPct > 0 ? 'R' : sPct < 0 ? 'L' : ''}${Math.abs(sPct)}%`;

        if (this.el.throttleFill) {
            const fwd = thr >= 0;
            Object.assign(this.el.throttleFill.style, {
                bottom: fwd ? '50%' : 'auto',
                top: fwd ? 'auto' : '50%',
                height: `${Math.abs(thr) * 50}%`
            });
        }
        if (this.el.steeringFill) {
            const right = str >= 0;
            Object.assign(this.el.steeringFill.style, {
                left: right ? '50%' : 'auto',
                right: right ? 'auto' : '50%',
                width: `${Math.abs(str) * 50}%`
            });
        }
    }

    updateFPS(fps) {
        if (this.el.fps) this.el.fps.textContent = `${fps} FPS`;
    }

    showError(msg) {
        if (this.el.alertMsg) this.el.alertMsg.textContent = msg;
        this.el.alertBanner?.classList.remove('hidden');
        clearTimeout(this.alertTimer);
        this.alertTimer = setTimeout(() => this.el.alertBanner?.classList.add('hidden'), Config.ALERT_DISPLAY_DURATION_MS);
    }
}
