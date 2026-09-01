/**
 * カメラ管理モジュール (車載カメラストリーム受信管理)
 */

import { Config } from './constants.js';

export class CameraManager {
    constructor() {
        this.cameraStreamImg = document.getElementById('camera-stream');
        this.cameraModeLabel = document.getElementById('camera-mode-label');

        const savedUrl = localStorage.getItem(Config.STORAGE_KEY_CAMERA_URL) || Config.DEFAULT_CAMERA_URL;
        this.applyCameraUrl(savedUrl);
    }

    applyCameraUrl(url) {
        this.streamUrl = (url && url.trim()) ? url.trim() : Config.DEFAULT_CAMERA_URL;
        localStorage.setItem(Config.STORAGE_KEY_CAMERA_URL, this.streamUrl);

        if (this.cameraStreamImg) {
            this.cameraStreamImg.src = this.streamUrl;
        }
        if (this.cameraModeLabel) {
            this.cameraModeLabel.textContent = 'LIVE';
        }
    }
}
