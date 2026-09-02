import { Config } from './constants.js';

const norm = (v) => {
    const r = v / Config.TOUCH_MAX_DISTANCE;
    return Math.abs(r) < Config.INPUT_DEADBAND ? 0 : Math.max(-1, Math.min(1, r));
};

export class InputController {
    constructor() {
        this.zone = document.getElementById('touch-zone');
        this.base = document.getElementById('joystick');
        this.thumb = document.getElementById('joystick-thumb');
        this.pointerId = null;
        this.throttle = this.steering = this.startX = this.startY = 0;
        this.enabled = true;
        this.initEvents();
    }

    initEvents() {
        if (!this.zone || !this.base || !this.thumb) return;

        this.zone.onpointerdown = (e) => {
            if (!this.enabled || this.pointerId !== null || e.button > 0) return;
            this.pointerId = e.pointerId;
            this.zone.setPointerCapture(e.pointerId);

            const r = this.zone.getBoundingClientRect();
            this.startX = e.clientX;
            this.startY = e.clientY;
            this.base.style.setProperty('--x', `${e.clientX - r.left}px`);
            this.base.style.setProperty('--y', `${e.clientY - r.top}px`);
            this.thumb.style.setProperty('--tx', '0px');
            this.thumb.style.setProperty('--ty', '0px');
            this.base.hidden = false;
            this.throttle = this.steering = 0;
        };

        this.zone.onpointermove = (e) => {
            if (this.pointerId !== e.pointerId) return;
            const dx = e.clientX - this.startX;
            const dy = this.startY - e.clientY; // 上方向が前進
            const dist = Math.hypot(dx, dy);
            const scale = dist > Config.TOUCH_MAX_DISTANCE ? Config.TOUCH_MAX_DISTANCE / dist : 1;

            this.thumb.style.setProperty('--tx', `${dx * scale}px`);
            this.thumb.style.setProperty('--ty', `${-dy * scale}px`);
            this.steering = norm(dx);
            this.throttle = norm(dy);
        };

        this.zone.onpointerup = this.zone.onpointercancel = (e) => {
            if (this.pointerId === e.pointerId) this.reset();
        };
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) this.reset();
    }

    reset() {
        this.pointerId = null;
        this.throttle = this.steering = 0;
        if (this.base) this.base.hidden = true;
    }

    getThrottle() { return this.enabled ? this.throttle : 0; }
    getSteering() { return this.enabled ? this.steering : 0; }
}
