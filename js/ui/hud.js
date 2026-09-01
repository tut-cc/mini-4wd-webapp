/**
 * HUD & 状態表示制御
 */

import { $, setText, setHidden, toggleClass, setDisabled, on } from './dom.js';
import { UIState, StopReason, StopReasonText, Config } from '../constants.js';

export class HudManager {
    constructor(callbacks = {}) {
        this.callbacks = callbacks;
        this.alertTimeout = null;

        // Elements
        this.wsStatus = $('ws-status');
        this.wsStatusText = $('ws-status-text');
        this.distanceBadge = $('distance-badge');
        this.fpsCounter = $('fps-counter');

        this.throttleBarFill = $('throttle-bar-fill');
        this.steeringBarFill = $('steering-bar-fill');
        this.throttleValue = $('throttle-value');
        this.steeringValue = $('steering-value');
        this.steeringGuideMarker = $('steering-guide-marker');

        this.btnDriveMode = $('btn-drive-mode');
        this.btnDriveModeText = $('btn-drive-mode-text');
        this.btnResetStop = $('btn-reset-stop');
        this.btnResetStopText = $('btn-reset-stop-text');
        this.btnEmergencyStop = $('btn-emergency-stop');

        this.stopReasonHud = $('stop-reason-hud');
        this.statusStopReason = $('status-stop-reason');

        this.alertBanner = $('alert-banner');
        this.alertMessage = $('alert-message');

        this.torOverlay = $('tor-overlay');
        this.torCountdown = $('tor-countdown');
        this.btnTorTakeover = $('btn-tor-takeover');
        this.disconnectedOverlay = $('disconnected-overlay');

        this.bindEvents();
    }

    bindEvents() {
        on(this.btnDriveMode, 'click', () => this.callbacks.onDriveModeClick?.());
        on(this.btnEmergencyStop, 'click', () => this.callbacks.onEmergencyStopClick?.());
        on(this.btnResetStop, 'click', () => this.callbacks.onResetStopClick?.());
        on(this.btnTorTakeover, 'click', () => this.callbacks.onTorTakeoverClick?.());
    }

    renderState(uiState, mcuData) {
        const isDisconnected = (uiState === UIState.DISCONNECTED);
        const isStopped = (uiState === UIState.SAFE_STOP || uiState === UIState.EMERGENCY_STOP);
        const isTor = (uiState === UIState.AUTO_TOR);
        const isPending = (uiState === UIState.AUTO_PENDING || uiState === UIState.MANUAL_PENDING);
        const isAuto = (uiState === UIState.AUTO || uiState === UIState.AUTO_PENDING);

        // 接続状態 & オーバーレイ
        setText(this.wsStatusText, isDisconnected ? '未接続' : '接続中');
        if (this.wsStatus) this.wsStatus.className = `hud-badge status-badge ${isDisconnected ? 'disconnected' : 'connected'}`;
        setHidden(this.disconnectedOverlay, !isDisconnected);
        setHidden(this.torOverlay, !isTor);
        if (isTor && mcuData?.tor_remaining_ms !== undefined) {
            setText(this.torCountdown, (mcuData.tor_remaining_ms / 1000).toFixed(1));
        }

        // 前方距離 & 停止理由
        setText(this.distanceBadge, mcuData?.front_distance_mm ?? '--');
        setHidden(this.stopReasonHud, !isStopped);
        if (isStopped) {
            const rawReason = mcuData?.stop_reason || StopReason.NONE;
            setText(this.statusStopReason, StopReasonText[rawReason] || rawReason);
        }

        // ドライブモードボタン & リセットボタン
        setHidden(this.btnDriveMode, isStopped || isTor);
        setHidden(this.btnResetStop, !isStopped);

        if (!isStopped && !isTor) {
            setText(this.btnDriveModeText, isAuto ? 'AUTO MODE' : 'MANUAL MODE');
            toggleClass(this.btnDriveMode, 'auto-mode', isAuto);
            toggleClass(this.btnDriveMode, 'pending', isPending);
            setDisabled(this.btnDriveMode, isDisconnected || isPending);
        }

        if (isStopped) {
            setText(this.btnResetStopText, 'RESET / 再開');
            setDisabled(this.btnResetStop, isDisconnected);
        }

        setDisabled(this.btnEmergencyStop, isDisconnected || uiState === UIState.EMERGENCY_STOP);
    }

    renderGauges(throttle, steering) {
        const tPct = Math.round(throttle * 100);
        const sPct = Math.round(steering * 100);

        setText(this.throttleValue, `${tPct > 0 ? '+' : ''}${tPct}%`);
        setText(this.steeringValue, `${sPct > 0 ? 'R' : sPct < 0 ? 'L' : ''}${Math.abs(sPct)}%`);

        if (this.throttleBarFill) {
            const isFwd = throttle >= 0;
            Object.assign(this.throttleBarFill.style, {
                bottom: isFwd ? '50%' : 'auto',
                top: isFwd ? 'auto' : '50%',
                height: `${Math.abs(throttle) * 50}%`
            });
        }

        if (this.steeringBarFill) {
            const isRight = steering >= 0;
            Object.assign(this.steeringBarFill.style, {
                left: isRight ? '50%' : 'auto',
                right: isRight ? 'auto' : '50%',
                width: `${Math.abs(steering) * 50}%`
            });
        }

        if (this.steeringGuideMarker) {
            this.steeringGuideMarker.style.transform = `translate(calc(-50% + ${steering * 30}px), -50%)`;
        }
    }

    updateFPS(fps) {
        setText(this.fpsCounter, `${fps} FPS`);
    }

    showError(msg) {
        setText(this.alertMessage, msg);
        setHidden(this.alertBanner, false);
        if (this.alertTimeout) clearTimeout(this.alertTimeout);
        this.alertTimeout = setTimeout(() => setHidden(this.alertBanner, true), Config.ALERT_DISPLAY_DURATION_MS);
    }
}
