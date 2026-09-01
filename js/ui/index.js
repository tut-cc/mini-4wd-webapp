/**
 * UI管理モジュール (HudManager & ModalManager 統括)
 */

import { HudManager } from './hud.js';
import { ModalManager } from './modal.js';

export class UIManager {
    constructor(callbacks = {}) {
        this.hud = new HudManager(callbacks);
        this.modal = new ModalManager(callbacks);
    }

    renderState(uiState, mcuData) {
        this.hud.renderState(uiState, mcuData);
    }

    renderGauges(throttle, steering) {
        this.hud.renderGauges(throttle, steering);
    }

    updateFPS(fps) {
        this.hud.updateFPS(fps);
    }

    showError(msg) {
        this.hud.showError(msg);
    }
}
