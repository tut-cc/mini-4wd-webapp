/**
 * UI管理モジュール (画面描画 & HUD制御)
 */

import { UIState, StopReason, StopReasonText, Config } from './constants.js';

export class UIManager {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.alertTimeout = null;

        this.initDOMElements();
        this.bindEvents();
    }

    initDOMElements() {
        this.wsStatus = document.getElementById('ws-status');
        this.wsStatusText = document.getElementById('ws-status-text');
        this.modeBadge = document.getElementById('mode-badge');
        this.distanceBadge = document.getElementById('distance-badge');
        this.distanceHudCard = document.getElementById('distance-hud-card');
        this.fpsCounter = document.getElementById('fps-counter');
        this.gamepadStatus = document.getElementById('gamepad-status');

        this.throttleBarFill = document.getElementById('throttle-bar-fill');
        this.steeringBarFill = document.getElementById('steering-bar-fill');
        this.throttleValue = document.getElementById('throttle-value');
        this.steeringValue = document.getElementById('steering-value');
        this.steeringGuideMarker = document.getElementById('steering-guide-marker');

        this.btnDriveMode = document.getElementById('btn-drive-mode');
        this.btnDriveModeText = document.getElementById('btn-drive-mode-text');
        this.btnResetStop = document.getElementById('btn-reset-stop');
        this.btnResetStopText = document.getElementById('btn-reset-stop-text');
        this.btnEmergencyStop = document.getElementById('btn-emergency-stop');
        this.btnFullscreen = document.getElementById('btn-fullscreen');
        this.btnAbout = document.getElementById('btn-about');
        this.btnCloseAbout = document.getElementById('btn-close-about');
        this.btnCameraSettings = document.getElementById('btn-camera-settings');
        this.btnSaveCamera = document.getElementById('btn-save-camera');
        this.btnCloseCamera = document.getElementById('btn-close-camera');

        this.stopReasonHud = document.getElementById('stop-reason-hud');
        this.statusStopReason = document.getElementById('status-stop-reason');

        this.alertBanner = document.getElementById('alert-banner');
        this.alertMessage = document.getElementById('alert-message');

        this.aboutModal = document.getElementById('about-modal');
        this.cameraModal = document.getElementById('camera-modal');
        this.cameraUrlInput = document.getElementById('camera-url-input');
        this.torOverlay = document.getElementById('tor-overlay');
        this.torCountdown = document.getElementById('tor-countdown');
        this.btnTorTakeover = document.getElementById('btn-tor-takeover');
        this.disconnectedOverlay = document.getElementById('disconnected-overlay');
    }

    bindEvents() {
        this.btnDriveMode.addEventListener('click', () => {
            if (this.callbacks.onDriveModeClick) this.callbacks.onDriveModeClick();
        });

        this.btnEmergencyStop.addEventListener('click', () => {
            if (this.callbacks.onEmergencyStopClick) this.callbacks.onEmergencyStopClick();
        });

        this.btnResetStop.addEventListener('click', () => {
            if (this.callbacks.onResetStopClick) this.callbacks.onResetStopClick();
        });

        this.btnTorTakeover.addEventListener('click', () => {
            if (this.callbacks.onTorTakeoverClick) this.callbacks.onTorTakeoverClick();
        });

        this.btnFullscreen.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        });

        this.btnAbout.addEventListener('click', () => {
            this.aboutModal.classList.remove('hidden');
        });

        this.btnCloseAbout.addEventListener('click', () => {
            this.aboutModal.classList.add('hidden');
        });

        this.btnCameraSettings.addEventListener('click', () => {
            const currentUrl = localStorage.getItem(Config.STORAGE_KEY_CAMERA_URL) || Config.DEFAULT_CAMERA_URL;
            this.cameraUrlInput.value = currentUrl;
            this.cameraModal.classList.remove('hidden');
        });

        this.btnCloseCamera.addEventListener('click', () => {
            this.cameraModal.classList.add('hidden');
        });

        this.btnSaveCamera.addEventListener('click', () => {
            const url = this.cameraUrlInput.value.trim();
            if (this.callbacks.onCameraSettingsSave) {
                this.callbacks.onCameraSettingsSave(url);
            }
            this.cameraModal.classList.add('hidden');
        });
    }

    renderState(uiState, mcuData) {
        const dist = (mcuData && mcuData.front_distance_mm !== undefined) ? mcuData.front_distance_mm : '--';
        const rawStopReason = mcuData ? mcuData.stop_reason : StopReason.NONE;
        const stopReason = StopReasonText[rawStopReason] || rawStopReason || StopReasonText[StopReason.NONE];

        if (this.modeBadge) {
            let displayMode = uiState;
            if (uiState === UIState.MANUAL_PENDING) {
                displayMode = 'MANUAL';
            } else if (uiState === UIState.AUTO_PENDING) {
                displayMode = 'AUTO';
            } else if (uiState === UIState.EMERGENCY_STOP) {
                displayMode = 'STOP';
            } else if (uiState === UIState.SAFE_STOP) {
                displayMode = 'SAFE STOP';
            }
            this.modeBadge.textContent = displayMode;
            this.modeBadge.className = `hud-badge mode-badge mode-${uiState.toLowerCase().replace('_', '')}`;
        }
        this.distanceBadge.textContent = String(dist);

        if (uiState === UIState.SAFE_STOP || uiState === UIState.EMERGENCY_STOP) {
            this.stopReasonHud.classList.remove('hidden');
            this.statusStopReason.textContent = stopReason;
        } else {
            this.stopReasonHud.classList.add('hidden');
        }

        switch (uiState) {
            case UIState.DISCONNECTED:
                this.disconnectedOverlay.classList.remove('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = '未接続';
                this.wsStatus.className = 'hud-badge status-badge disconnected';

                this.btnDriveMode.disabled = true;
                this.btnEmergencyStop.disabled = true;
                this.btnResetStop.classList.add('hidden');
                break;

            case UIState.MANUAL:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = '接続中';
                this.wsStatus.className = 'hud-badge status-badge connected';

                this.btnDriveMode.classList.remove('hidden', 'auto-mode', 'pending');
                this.btnDriveModeText.textContent = 'MANUAL MODE';
                this.btnDriveMode.disabled = false;

                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.AUTO_PENDING:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = '接続中';
                this.wsStatus.className = 'hud-badge status-badge connected';

                this.btnDriveMode.classList.remove('hidden');
                this.btnDriveMode.classList.add('auto-mode', 'pending');
                this.btnDriveModeText.textContent = 'AUTO MODE';
                this.btnDriveMode.disabled = true;

                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.MANUAL_PENDING:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = '接続中';
                this.wsStatus.className = 'hud-badge status-badge connected';

                this.btnDriveMode.classList.remove('hidden', 'auto-mode');
                this.btnDriveMode.classList.add('pending');
                this.btnDriveModeText.textContent = 'MANUAL MODE';
                this.btnDriveMode.disabled = true;

                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.AUTO:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = '接続中';
                this.wsStatus.className = 'hud-badge status-badge connected';

                this.btnDriveMode.classList.remove('hidden', 'pending');
                this.btnDriveMode.classList.add('auto-mode');
                this.btnDriveModeText.textContent = 'AUTO MODE';
                this.btnDriveMode.disabled = false;

                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.AUTO_TOR:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.remove('hidden');
                this.wsStatusText.textContent = '接続中';
                this.wsStatus.className = 'hud-badge status-badge connected';

                if (mcuData && mcuData.tor_remaining_ms !== undefined) {
                    const sec = (mcuData.tor_remaining_ms / 1000).toFixed(1);
                    this.torCountdown.textContent = sec;
                }

                this.btnDriveMode.classList.add('hidden');
                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.SAFE_STOP:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = '接続中';
                this.wsStatus.className = 'hud-badge status-badge connected';

                this.btnDriveMode.classList.add('hidden');
                this.btnResetStop.classList.remove('hidden');
                this.btnResetStopText.textContent = 'RESET / 再開';
                this.btnResetStop.disabled = false;
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.EMERGENCY_STOP:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = '接続中';
                this.wsStatus.className = 'hud-badge status-badge connected';

                this.btnDriveMode.classList.add('hidden');
                this.btnResetStop.classList.remove('hidden');
                this.btnResetStopText.textContent = 'RESET / 再開';
                this.btnResetStop.disabled = false;
                this.btnEmergencyStop.disabled = true;
                break;
        }
    }

    renderGauges(throttle, steering) {
        const tPct = Math.round(throttle * 100);
        const sPct = Math.round(steering * 100);

        this.throttleValue.textContent = `${tPct > 0 ? '+' : ''}${tPct}%`;
        this.steeringValue.textContent = `${sPct > 0 ? 'R' : sPct < 0 ? 'L' : ''}${Math.abs(sPct)}%`;

        if (throttle >= 0) {
            this.throttleBarFill.style.bottom = '50%';
            this.throttleBarFill.style.top = 'auto';
            this.throttleBarFill.style.height = `${throttle * 50}%`;
        } else {
            this.throttleBarFill.style.top = '50%';
            this.throttleBarFill.style.bottom = 'auto';
            this.throttleBarFill.style.height = `${Math.abs(throttle) * 50}%`;
        }

        if (steering >= 0) {
            this.steeringBarFill.style.left = '50%';
            this.steeringBarFill.style.right = 'auto';
            this.steeringBarFill.style.width = `${steering * 50}%`;
        } else {
            this.steeringBarFill.style.right = '50%';
            this.steeringBarFill.style.left = 'auto';
            this.steeringBarFill.style.width = `${Math.abs(steering) * 50}%`;
        }

        if (this.steeringGuideMarker) {
            const markerX = steering * 30;
            this.steeringGuideMarker.style.transform = `translate(calc(-50% + ${markerX}px), -50%)`;
        }
    }

    updateGamepadStatus(active) {
        if (this.gamepadStatus) {
            if (active) {
                this.gamepadStatus.classList.remove('hidden');
                this.gamepadStatus.classList.add('active');
            } else {
                this.gamepadStatus.classList.add('hidden');
                this.gamepadStatus.classList.remove('active');
            }
        }
    }

    updateFPS(fps) {
        if (this.fpsCounter) {
            this.fpsCounter.textContent = `${fps} FPS`;
        }
    }

    showError(msg) {
        this.alertMessage.textContent = msg;
        this.alertBanner.classList.remove('hidden');
        if (this.alertTimeout) clearTimeout(this.alertTimeout);
        this.alertTimeout = setTimeout(() => {
            this.alertBanner.classList.add('hidden');
        }, Config.ALERT_DISPLAY_DURATION_MS);
    }
}
