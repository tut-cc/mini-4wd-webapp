/**
 * モーダルダイアログ & 設定管理
 */

import { $, on, setHidden } from './dom.js';
import { Config } from '../constants.js';

export class ModalManager {
    constructor(callbacks = {}) {
        this.callbacks = callbacks;

        // Elements
        this.aboutModal = $('about-modal');
        this.cameraModal = $('camera-modal');
        this.cameraUrlInput = $('camera-url-input');

        this.btnAbout = $('btn-about');
        this.btnCloseAbout = $('btn-close-about');
        this.btnCameraSettings = $('btn-camera-settings');
        this.btnSaveCamera = $('btn-save-camera');
        this.btnCloseCamera = $('btn-close-camera');
        this.btnFullscreen = $('btn-fullscreen');

        this.bindEvents();
    }

    bindEvents() {
        on(this.btnFullscreen, 'click', () => {
            document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : document.documentElement.requestFullscreen().catch(() => {});
        });

        on(this.btnAbout, 'click', () => setHidden(this.aboutModal, false));
        on(this.btnCloseAbout, 'click', () => setHidden(this.aboutModal, true));

        on(this.btnCameraSettings, 'click', () => {
            if (this.cameraUrlInput) {
                this.cameraUrlInput.value = localStorage.getItem(Config.STORAGE_KEY_CAMERA_URL) || Config.DEFAULT_CAMERA_URL;
            }
            setHidden(this.cameraModal, false);
        });

        on(this.btnCloseCamera, 'click', () => setHidden(this.cameraModal, true));

        on(this.btnSaveCamera, 'click', () => {
            const url = this.cameraUrlInput?.value.trim() || Config.DEFAULT_CAMERA_URL;
            this.callbacks.onCameraSettingsSave?.(url);
            setHidden(this.cameraModal, true);
        });
    }
}
