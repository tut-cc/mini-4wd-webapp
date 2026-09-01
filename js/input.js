/**
 * 入力制御モジュール (仮想ジョイスティック & キーボード)
 */
import { Config } from './constants.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const deadband = (v, db) => (Math.abs(v) < db ? 0 : v);

class VirtualStick {
    constructor({ zone, base, thumb, axis = 'y' }) {
        this.zone = zone;
        this.base = base;
        this.thumb = thumb;
        this.axis = axis;
        this.pointerId = null;
        this.value = 0;
        this.enabled = true;

        if (!zone || !base || !thumb) return;

        zone.addEventListener('pointerdown', (e) => {
            if (!this.enabled || this.pointerId !== null || (e.button !== undefined && e.button !== 0)) return;
            e.preventDefault();
            this.pointerId = e.pointerId;
            try { zone.setPointerCapture(e.pointerId); } catch (_) {}

            const rect = zone.getBoundingClientRect();
            base.style.left = `${e.clientX - rect.left}px`;
            base.style.top = `${e.clientY - rect.top}px`;
            thumb.style.transform = 'translate(-50%, -50%)';
            base.classList.remove('hidden');

            this.startPos = (axis === 'y') ? e.clientY : e.clientX;
            this.value = 0;
        });

        zone.addEventListener('pointermove', (e) => {
            if (this.pointerId !== e.pointerId) return;
            e.preventDefault();
            const pos = (axis === 'y') ? e.clientY : e.clientX;
            const delta = (axis === 'y') ? (this.startPos - pos) : (pos - this.startPos);
            this.value = deadband(clamp(delta / Config.TOUCH_MAX_DISTANCE, -1, 1), Config.INPUT_DEADBAND);

            const offset = (axis === 'y' ? -this.value : this.value) * (Config.TOUCH_MAX_DISTANCE * 0.5);
            thumb.style.transform = axis === 'y'
                ? `translate(-50%, calc(-50% + ${offset}px))`
                : `translate(calc(-50% + ${offset}px), -50%)`;
        });

        const onEnd = (e) => {
            if (this.pointerId !== e.pointerId) return;
            try { zone.releasePointerCapture?.(e.pointerId); } catch (_) {}
            this.reset();
        };
        zone.addEventListener('pointerup', onEnd);
        zone.addEventListener('pointercancel', onEnd);
    }

    reset() {
        this.pointerId = null;
        this.value = 0;
        this.base?.classList.add('hidden');
    }
}

export class InputController {
    constructor(onEmergencyStop) {
        this.enabled = true;
        this.keys = { up: 0, down: 0, left: 0, right: 0 };

        this.throttleStick = new VirtualStick({
            zone: document.getElementById('touch-throttle-zone'),
            base: document.getElementById('throttle-joystick-base'),
            thumb: document.getElementById('throttle-joystick-thumb'),
            axis: 'y'
        });

        this.steeringStick = new VirtualStick({
            zone: document.getElementById('touch-steering-zone'),
            base: document.getElementById('steering-joystick-base'),
            thumb: document.getElementById('steering-joystick-thumb'),
            axis: 'x'
        });

        const keyMap = {
            ArrowUp: 'up', w: 'up', W: 'up',
            ArrowDown: 'down', s: 'down', S: 'down',
            ArrowLeft: 'left', a: 'left', A: 'left',
            ArrowRight: 'right', d: 'right', D: 'right'
        };

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                return onEmergencyStop?.();
            }
            if (keyMap[e.key]) {
                e.preventDefault();
                this.keys[keyMap[e.key]] = 1;
            }
        });

        window.addEventListener('keyup', (e) => {
            if (keyMap[e.key]) {
                e.preventDefault();
                this.keys[keyMap[e.key]] = 0;
            }
        });
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.throttleStick.enabled = enabled;
        this.steeringStick.enabled = enabled;
        if (!enabled) this.reset();
    }

    reset() {
        this.throttleStick.reset();
        this.steeringStick.reset();
        Object.keys(this.keys).forEach(k => (this.keys[k] = 0));
    }

    getThrottle() {
        if (!this.enabled) return 0;
        const kb = this.keys.up - this.keys.down;
        return kb !== 0 ? kb : this.throttleStick.value;
    }

    getSteering() {
        if (!this.enabled) return 0;
        const kb = this.keys.right - this.keys.left;
        return kb !== 0 ? kb : this.steeringStick.value;
    }
}
