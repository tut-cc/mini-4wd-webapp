/**
 * 入力制御モジュール (仮想ジョイスティック & キーボード統括)
 */

import { VirtualStick } from './virtual-stick.js';
import { KeyboardController } from './keyboard.js';
import { Config } from '../constants.js';

export class InputController {
    constructor(onEmergencyStopCallback) {
        this.enabled = true;

        // 仮想ジョイスティック (左: スロットル, 右: ステアリング)
        this.throttleStick = new VirtualStick({
            zoneElement: document.getElementById('touch-throttle-zone'),
            baseElement: document.getElementById('throttle-joystick-base'),
            thumbElement: document.getElementById('throttle-joystick-thumb'),
            axis: 'y',
            maxDistance: Config.TOUCH_MAX_DISTANCE,
            deadband: Config.INPUT_DEADBAND
        });

        this.steeringStick = new VirtualStick({
            zoneElement: document.getElementById('touch-steering-zone'),
            baseElement: document.getElementById('steering-joystick-base'),
            thumbElement: document.getElementById('steering-joystick-thumb'),
            axis: 'x',
            maxDistance: Config.TOUCH_MAX_DISTANCE,
            deadband: Config.INPUT_DEADBAND
        });

        // キーボード
        this.keyboard = new KeyboardController({
            onEmergencyStop: onEmergencyStopCallback
        });
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.throttleStick.enabled = enabled;
        this.steeringStick.enabled = enabled;
        this.keyboard.enabled = enabled;
        if (!enabled) {
            this.reset();
        }
    }

    reset() {
        this.throttleStick.reset();
        this.steeringStick.reset();
        this.keyboard.reset();
    }

    getThrottle() {
        if (!this.enabled) return 0.0;
        if (this.keyboard.isActive()) {
            return this.keyboard.getThrottle();
        }
        return this.throttleStick.getValue();
    }

    getSteering() {
        if (!this.enabled) return 0.0;
        if (this.keyboard.isActive()) {
            return this.keyboard.getSteering();
        }
        return this.steeringStick.getValue();
    }
}
