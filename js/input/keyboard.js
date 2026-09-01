/**
 * キーボード入力制御
 */

const KEY_MAP = {
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right'
};

export class KeyboardController {
    constructor({ onEmergencyStop } = {}) {
        this.onEmergencyStop = onEmergencyStop;
        this.enabled = true;
        this.keys = { up: false, down: false, left: false, right: false };
        this.throttle = 0.0;
        this.steering = 0.0;
        this.active = false;

        this.initEvents();
    }

    initEvents() {
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            if (e.code === 'Space') {
                e.preventDefault();
                return this.onEmergencyStop?.();
            }
            if (this.handleKey(e.key, true)) e.preventDefault();
        });

        window.addEventListener('keyup', (e) => {
            if (this.handleKey(e.key, false)) e.preventDefault();
        });
    }

    handleKey(key, isDown) {
        const action = KEY_MAP[key];
        if (!action) return false;
        this.keys[action] = isDown;
        this.update();
        return true;
    }

    update() {
        this.throttle = (this.keys.up ? 1.0 : 0.0) - (this.keys.down ? 1.0 : 0.0);
        this.steering = (this.keys.right ? 1.0 : 0.0) - (this.keys.left ? 1.0 : 0.0);
        this.active = Object.values(this.keys).some(Boolean);
    }

    reset() {
        Object.keys(this.keys).forEach((k) => (this.keys[k] = false));
        this.throttle = 0.0;
        this.steering = 0.0;
        this.active = false;
    }

    isActive() {
        return this.enabled && this.active;
    }

    getThrottle() {
        return this.enabled ? this.throttle : 0.0;
    }

    getSteering() {
        return this.enabled ? this.steering : 0.0;
    }
}
