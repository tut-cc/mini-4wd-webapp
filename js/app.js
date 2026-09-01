/**
 * ミニ四駆自動運転 WebApp - メインエントリーポイント
 */
import { InputController } from './input.js';
import { CameraManager } from './camera.js';
import { UIManager } from './ui.js';
import { CommManager } from './comm.js';
import { StateMachine } from './state-machine.js';

export class Mini4WDApp {
    constructor() {
        this.input = new InputController(() => this.stateMachine.requestEmergencyStop());
        this.camera = new CameraManager();

        this.ui = new UIManager({
            onDriveModeClick: () => this.stateMachine.requestDriveModeToggle(),
            onEmergencyStopClick: () => this.stateMachine.requestEmergencyStop(),
            onResetStopClick: () => this.stateMachine.requestResetStop(),
            onTorTakeoverClick: () => this.stateMachine.requestTorTakeover(),
            onCameraSettingsSave: (url) => this.camera.applyCameraUrl(url)
        });

        this.stateMachine = new StateMachine(this);

        this.comm = new CommManager({
            onConnect: () => this.stateMachine.handleConnect(),
            onDisconnect: () => this.stateMachine.handleDisconnect(),
            onHeartbeat: (data) => this.stateMachine.handleHeartbeat(data),
            getTransmitPayload: () => this.stateMachine.getTransmitPayload()
        });

        this.frameCount = 0;
        this.lastFpsTimestamp = performance.now();
        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    loop(ts) {
        this.frameCount++;
        if (ts - this.lastFpsTimestamp >= 1000) {
            this.ui.updateFPS(this.frameCount);
            this.frameCount = 0;
            this.lastFpsTimestamp = ts;
        }
        this.ui.renderGauges(this.input.getThrottle(), this.input.getSteering());
        requestAnimationFrame(this.loop);
    }
}

window.addEventListener('DOMContentLoaded', () => { window.app = new Mini4WDApp(); });
