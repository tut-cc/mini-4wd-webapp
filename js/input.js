/**
 * 入力制御モジュール (統合2D仮想ジョイスティック)
 */
import { Config } from './constants.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const deadband = (v, db) => (Math.abs(v) < db ? 0 : v);

export class InputController {
    constructor() {
        this.zone = document.getElementById('touch-layer');
        this.base = document.getElementById('joystick-base');
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
            if (!this.enabled || this.pointerId !== null || (e.button !== undefined && e.button !== 0)) return;
            e.preventDefault();
            this.pointerId = e.pointerId;
            try { this.zone.setPointerCapture(e.pointerId); } catch (_) {}

            const rect = this.zone.getBoundingClientRect();
            this.startX = e.clientX;
            this.startY = e.clientY;
            this.base.style.left = `${e.clientX - rect.left}px`;
            this.base.style.top = `${e.clientY - rect.top}px`;
            this.thumb.style.transform = 'translate(-50%, -50%)';
            this.base.classList.remove('hidden');

            this.throttle = 0;
            this.steering = 0;
        });

        this.zone.addEventListener('pointermove', (e) => {
            if (this.pointerId !== e.pointerId) return;
            e.preventDefault();

            const dx = e.clientX - this.startX;
            const dy = this.startY - e.clientY; // 上方向が前進(正)

            const maxDist = Config.TOUCH_MAX_DISTANCE;
            const dist = Math.hypot(dx, dy);
            const scale = dist > maxDist ? maxDist / dist : 1;
            const cx = dx * scale;
            const cy = -dy * scale;

            this.thumb.style.transform = `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;

            this.steering = deadband(clamp(dx / maxDist, -1, 1), Config.INPUT_DEADBAND);
            this.throttle = deadband(clamp(dy / maxDist, -1, 1), Config.INPUT_DEADBAND);
        });

        const onEnd = (e) => {
            if (this.pointerId !== e.pointerId) return;
            try { this.zone.releasePointerCapture?.(e.pointerId); } catch (_) {}
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
        this.base?.classList.add('hidden');
    }

    getThrottle() {
        return this.enabled ? this.throttle : 0;
    }

    getSteering() {
        return this.enabled ? this.steering : 0;
    }
}
