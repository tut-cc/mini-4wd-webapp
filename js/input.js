/**
 * 入力制御モジュール (スマホタッチ・ブラインド操作・キーボード・ゲームパッド)
 */

import { Config } from './constants.js';

export const InputZone = Object.freeze({
    THROTTLE: 'throttle',
    STEERING: 'steering'
});

export class InputController {
    constructor(onEmergencyStopCallback) {
        this.onEmergencyStop = onEmergencyStopCallback;
        this.enabled = true;

        this.throttle = 0.0;
        this.steering = 0.0;

        this.keys = {
            up: false,
            down: false,
            left: false,
            right: false
        };

        this.gamepadConnected = false;

        this.touchState = {
            throttle: {
                active: false,
                touchId: null,
                startY: 0,
                currentY: 0,
                maxDistance: Config.TOUCH_MAX_DISTANCE
            },
            steering: {
                active: false,
                touchId: null,
                startX: 0,
                currentX: 0,
                maxDistance: Config.TOUCH_MAX_DISTANCE
            }
        };

        this.mouseState = {
            activeZone: null,
            startY: 0,
            startX: 0
        };

        this.throttleZone = document.getElementById('touch-throttle-zone');
        this.steeringZone = document.getElementById('touch-steering-zone');
        this.throttleJoystickBase = document.getElementById('throttle-joystick-base');
        this.throttleJoystickThumb = document.getElementById('throttle-joystick-thumb');
        this.steeringJoystickBase = document.getElementById('steering-joystick-base');
        this.steeringJoystickThumb = document.getElementById('steering-joystick-thumb');

        this.initTouchEvents();
        this.initMouseEvents();
        this.initKeyboardEvents();
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.reset();
        }
    }

    reset() {
        this.throttle = 0.0;
        this.steering = 0.0;

        this.keys.up = false;
        this.keys.down = false;
        this.keys.left = false;
        this.keys.right = false;

        this.touchState.throttle.active = false;
        this.touchState.throttle.touchId = null;
        this.touchState.steering.active = false;
        this.touchState.steering.touchId = null;

        if (this.throttleJoystickBase) this.throttleJoystickBase.classList.add('hidden');
        if (this.steeringJoystickBase) this.steeringJoystickBase.classList.add('hidden');
    }

    initTouchEvents() {
        // 左ゾーン: スロットル (前後)
        this.throttleZone.addEventListener('touchstart', (e) => {
            if (!this.enabled) return;
            e.preventDefault();

            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (!this.touchState.throttle.active) {
                    this.touchState.throttle.active = true;
                    this.touchState.throttle.touchId = touch.identifier;
                    this.touchState.throttle.startY = touch.clientY;
                    this.touchState.throttle.currentY = touch.clientY;

                    const rect = this.throttleZone.getBoundingClientRect();
                    const localX = touch.clientX - rect.left;
                    const localY = touch.clientY - rect.top;
                    this.throttleJoystickBase.style.left = `${localX}px`;
                    this.throttleJoystickBase.style.top = `${localY}px`;
                    this.throttleJoystickThumb.style.transform = 'translate(-50%, -50%)';
                    this.throttleJoystickBase.classList.remove('hidden');
                    break;
                }
            }
        }, { passive: false });

        this.throttleZone.addEventListener('touchmove', (e) => {
            if (!this.enabled || !this.touchState.throttle.active) return;
            e.preventDefault();

            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (touch.identifier === this.touchState.throttle.touchId) {
                    this.touchState.throttle.currentY = touch.clientY;
                    const deltaY = this.touchState.throttle.startY - touch.clientY;
                    const maxDist = this.touchState.throttle.maxDistance;

                    let norm = deltaY / maxDist;
                    norm = Math.max(-1.0, Math.min(1.0, norm));
                    if (Math.abs(norm) < Config.INPUT_DEADBAND) norm = 0.0;

                    this.throttle = norm;
                    const visualY = -norm * (maxDist * 0.5);
                    this.throttleJoystickThumb.style.transform = `translate(-50%, calc(-50% + ${visualY}px))`;
                    break;
                }
            }
        }, { passive: false });

        const endThrottleTouch = (e) => {
            if (!this.touchState.throttle.active) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this.touchState.throttle.touchId) {
                    this.touchState.throttle.active = false;
                    this.touchState.throttle.touchId = null;
                    this.throttle = 0.0;
                    this.throttleJoystickBase.classList.add('hidden');
                    break;
                }
            }
        };

        this.throttleZone.addEventListener('touchend', endThrottleTouch, { passive: false });
        this.throttleZone.addEventListener('touchcancel', endThrottleTouch, { passive: false });

        // 右ゾーン: ステアリング (左右)
        this.steeringZone.addEventListener('touchstart', (e) => {
            if (!this.enabled) return;
            e.preventDefault();

            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (!this.touchState.steering.active) {
                    this.touchState.steering.active = true;
                    this.touchState.steering.touchId = touch.identifier;
                    this.touchState.steering.startX = touch.clientX;
                    this.touchState.steering.currentX = touch.clientX;

                    const rect = this.steeringZone.getBoundingClientRect();
                    const localX = touch.clientX - rect.left;
                    const localY = touch.clientY - rect.top;
                    this.steeringJoystickBase.style.left = `${localX}px`;
                    this.steeringJoystickBase.style.top = `${localY}px`;
                    this.steeringJoystickThumb.style.transform = 'translate(-50%, -50%)';
                    this.steeringJoystickBase.classList.remove('hidden');
                    break;
                }
            }
        }, { passive: false });

        this.steeringZone.addEventListener('touchmove', (e) => {
            if (!this.enabled || !this.touchState.steering.active) return;
            e.preventDefault();

            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (touch.identifier === this.touchState.steering.touchId) {
                    this.touchState.steering.currentX = touch.clientX;
                    const deltaX = touch.clientX - this.touchState.steering.startX;
                    const maxDist = this.touchState.steering.maxDistance;

                    let norm = deltaX / maxDist;
                    norm = Math.max(-1.0, Math.min(1.0, norm));
                    if (Math.abs(norm) < Config.INPUT_DEADBAND) norm = 0.0;

                    this.steering = norm;
                    const visualX = norm * (maxDist * 0.5);
                    this.steeringJoystickThumb.style.transform = `translate(calc(-50% + ${visualX}px), -50%)`;
                    break;
                }
            }
        }, { passive: false });

        const endSteeringTouch = (e) => {
            if (!this.touchState.steering.active) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this.touchState.steering.touchId) {
                    this.touchState.steering.active = false;
                    this.touchState.steering.touchId = null;
                    this.steering = 0.0;
                    this.steeringJoystickBase.classList.add('hidden');
                    break;
                }
            }
        };

        this.steeringZone.addEventListener('touchend', endSteeringTouch, { passive: false });
        this.steeringZone.addEventListener('touchcancel', endSteeringTouch, { passive: false });
    }

    initMouseEvents() {
        this.throttleZone.addEventListener('mousedown', (e) => {
            if (!this.enabled || e.button !== 0) return;
            this.mouseState.activeZone = InputZone.THROTTLE;
            this.mouseState.startY = e.clientY;

            const rect = this.throttleZone.getBoundingClientRect();
            this.throttleJoystickBase.style.left = `${e.clientX - rect.left}px`;
            this.throttleJoystickBase.style.top = `${e.clientY - rect.top}px`;
            this.throttleJoystickThumb.style.transform = 'translate(-50%, -50%)';
            this.throttleJoystickBase.classList.remove('hidden');
        });

        this.steeringZone.addEventListener('mousedown', (e) => {
            if (!this.enabled || e.button !== 0) return;
            this.mouseState.activeZone = InputZone.STEERING;
            this.mouseState.startX = e.clientX;

            const rect = this.steeringZone.getBoundingClientRect();
            this.steeringJoystickBase.style.left = `${e.clientX - rect.left}px`;
            this.steeringJoystickBase.style.top = `${e.clientY - rect.top}px`;
            this.steeringJoystickThumb.style.transform = 'translate(-50%, -50%)';
            this.steeringJoystickBase.classList.remove('hidden');
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.enabled || !this.mouseState.activeZone) return;

            if (this.mouseState.activeZone === InputZone.THROTTLE) {
                const deltaY = this.mouseState.startY - e.clientY;
                const maxDist = Config.TOUCH_MAX_DISTANCE;
                let norm = Math.max(-1.0, Math.min(1.0, deltaY / maxDist));
                if (Math.abs(norm) < Config.INPUT_DEADBAND) norm = 0.0;
                this.throttle = norm;
                const visualY = -norm * (maxDist * 0.5);
                this.throttleJoystickThumb.style.transform = `translate(-50%, calc(-50% + ${visualY}px))`;
            } else if (this.mouseState.activeZone === InputZone.STEERING) {
                const deltaX = e.clientX - this.mouseState.startX;
                const maxDist = Config.TOUCH_MAX_DISTANCE;
                let norm = Math.max(-1.0, Math.min(1.0, deltaX / maxDist));
                if (Math.abs(norm) < Config.INPUT_DEADBAND) norm = 0.0;
                this.steering = norm;
                const visualX = norm * (maxDist * 0.5);
                this.steeringJoystickThumb.style.transform = `translate(calc(-50% + ${visualX}px), -50%)`;
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.mouseState.activeZone === InputZone.THROTTLE) {
                this.throttle = 0.0;
                this.throttleJoystickBase.classList.add('hidden');
            } else if (this.mouseState.activeZone === InputZone.STEERING) {
                this.steering = 0.0;
                this.steeringJoystickBase.classList.add('hidden');
            }
            this.mouseState.activeZone = null;
        });
    }

    initKeyboardEvents() {
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.keys.up = true;
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.keys.down = true;
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.keys.left = true;
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.keys.right = true;
            }

            this.updateFromKeyboard();
        });

        window.addEventListener('keyup', (e) => {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.keys.up = false;
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.keys.down = false;
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.keys.left = false;
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.keys.right = false;
            }

            this.updateFromKeyboard();
        });
    }

    updateFromKeyboard() {
        if (!this.enabled) return;

        let targetThrottle = 0.0;
        let targetSteering = 0.0;

        if (this.keys.up && !this.keys.down) targetThrottle = 1.0;
        if (this.keys.down && !this.keys.up) targetThrottle = -1.0;

        if (this.keys.left && !this.keys.right) targetSteering = -1.0;
        if (this.keys.right && !this.keys.left) targetSteering = 1.0;

        const isKeyboardActive = this.keys.up || this.keys.down || this.keys.left || this.keys.right;
        if (isKeyboardActive) {
            this.throttle = targetThrottle;
            this.steering = targetSteering;
        } else if (!this.touchState.throttle.active && !this.mouseState.activeZone) {
            if (!this.keys.up && !this.keys.down) this.throttle = 0.0;
            if (!this.keys.left && !this.keys.right) this.steering = 0.0;
        }
    }

    pollGamepad() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const pad = gamepads[0];

        if (!pad) {
            this.gamepadConnected = false;
            return;
        }

        this.gamepadConnected = true;

        if (this.enabled) {
            const deadband = Config.GAMEPAD_DEADBAND;
            let stickX = pad.axes[0] || pad.axes[2] || 0;
            let stickY = -(pad.axes[1] || 0);

            if (Math.abs(stickX) < deadband) stickX = 0;
            if (Math.abs(stickY) < deadband) stickY = 0;

            const isKeyboardActive = this.keys.up || this.keys.down || this.keys.left || this.keys.right;
            const isTouchActive = this.touchState.throttle.active || this.touchState.steering.active || this.mouseState.activeZone;

            if (!isKeyboardActive && !isTouchActive) {
                this.throttle = stickY;
                this.steering = stickX;
            }
        }

        if (pad.buttons[0]?.pressed || pad.buttons[1]?.pressed || pad.buttons[2]?.pressed || pad.buttons[3]?.pressed) {
            if (this.onEmergencyStop) this.onEmergencyStop();
        }
    }

    getThrottle() {
        return this.enabled ? this.throttle : 0.0;
    }

    getSteering() {
        return this.enabled ? this.steering : 0.0;
    }
}
