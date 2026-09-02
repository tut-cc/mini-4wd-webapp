/**
 * 入力制御モジュール
 */
import { Config } from './constants.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const deadband = (v, db) => (Math.abs(v) < db ? 0 : v);

export class InputController {
    constructor() {
        this.zone = document.getElementById('touch-zone');
        this.base = document.getElementById('joystick');
        this.thumb = document.getElementById('joystick-thumb');

        this.pointerId = null;
        this.startX = 0;
        this.startY = 0;
        this.throttle = 0;
        this.steering = 0;
        this.enabled = true;

        this.initEvents();
    }

    initEvents() {
        if (!this.zone || !this.base || !this.thumb) return;

        this.zone.addEventListener('pointerdown', (e) => {
            if (!this.enabled || this.pointerId !== null || e.button > 0) return;
            e.preventDefault();
            this.pointerId = e.pointerId;
            this.zone.setPointerCapture(e.pointerId);

            const rect = this.zone.getBoundingClientRect();
            this.startX = e.clientX;
            this.startY = e.clientY;
            this.base.style.setProperty('--x', `${e.clientX - rect.left}px`);
            this.base.style.setProperty('--y', `${e.clientY - rect.top}px`);
            this.thumb.style.setProperty('--tx', '0px');
            this.thumb.style.setProperty('--ty', '0px');
            this.base.hidden = false;

            this.throttle = 0;
            this.steering = 0;
        });

        this.zone.addEventListener('pointermove', (e) => {
            if (this.pointerId !== e.pointerId) return;
            e.preventDefault();

            const dx = e.clientX - this.startX;
            const dy = this.startY - e.clientY; // 上方向が前進
            const maxDist = Config.TOUCH_MAX_DISTANCE;
            const dist = Math.hypot(dx, dy);
            const scale = dist > maxDist ? maxDist / dist : 1;

            this.thumb.style.setProperty('--tx', `${dx * scale}px`);
            this.thumb.style.setProperty('--ty', `${-dy * scale}px`);

            this.steering = deadband(clamp(dx / maxDist, -1, 1), Config.INPUT_DEADBAND);
            this.throttle = deadband(clamp(dy / maxDist, -1, 1), Config.INPUT_DEADBAND);
        });

        const onEnd = (e) => {
            if (this.pointerId !== e.pointerId) return;
            this.reset();
        };

        this.zone.addEventListener('pointerup', onEnd);
        this.zone.addEventListener('pointercancel', onEnd);
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) this.reset();
    }

    reset() {
        this.pointerId = null;
        this.throttle = 0;
        this.steering = 0;
        if (this.base) this.base.hidden = true;
    }

    getThrottle() { return this.enabled ? this.throttle : 0; }
    getSteering() { return this.enabled ? this.steering : 0; }
}
