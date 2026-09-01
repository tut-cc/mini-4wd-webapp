/**
 * カメラ管理モジュール
 */
import { Config } from './constants.js';

export class CameraManager {
    constructor() {
        this.img = document.getElementById('camera-stream');
        this.applyCameraUrl(localStorage.getItem(Config.STORAGE_KEY_CAMERA_URL) || Config.DEFAULT_CAMERA_URL);
    }

    applyCameraUrl(url) {
        this.url = url?.trim() || Config.DEFAULT_CAMERA_URL;
        localStorage.setItem(Config.STORAGE_KEY_CAMERA_URL, this.url);
        if (this.img) this.img.src = this.url;
    }
}
