/**
 * キーボード入力制御
 */

export class KeyboardController {
    constructor({ onEmergencyStop } = {}) {
        this.onEmergencyStop = onEmergencyStop;
        this.enabled = true;

        this.keys = {
            up: false,
            down: false,
            left: false,
            right: false
        };

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
                this.onEmergencyStop?.();
                return;
            }

            if (this.handleKey(e.key, true)) {
                e.preventDefault();
            }
        });

        window.addEventListener('keyup', (e) => {
            if (this.handleKey(e.key, false)) {
                e.preventDefault();
            }
        });
    }

    handleKey(key, isDown) {
        let handled = false;
        if (key === 'ArrowUp' || key === 'w' || key === 'W') {
            this.keys.up = isDown;
            handled = true;
        } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
            this.keys.down = isDown;
            handled = true;
        } else if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
            this.keys.left = isDown;
            handled = true;
        } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
            this.keys.right = isDown;
            handled = true;
        }

        if (handled) {
            this.update();
        }
        return handled;
    }

    update() {
        const fwd = this.keys.up ? 1.0 : 0.0;
        const rev = this.keys.down ? 1.0 : 0.0;
        const right = this.keys.right ? 1.0 : 0.0;
        const left = this.keys.left ? 1.0 : 0.0;

        this.throttle = fwd - rev;
        this.steering = right - left;
        this.active = this.keys.up || this.keys.down || this.keys.left || this.keys.right;
    }

    reset() {
        this.keys.up = false;
        this.keys.down = false;
        this.keys.left = false;
        this.keys.right = false;
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
