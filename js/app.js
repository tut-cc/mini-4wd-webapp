/**
 * ミニ四駆自動運転 WebApp - メインエントリーポイント
 */
import { InputController } from './input.js';
import { UIManager } from './ui.js';
import { CommManager } from './comm.js';
import { StateMachine } from './state-machine.js';

export class Mini4WDApp {
    constructor() {
        this.input = new InputController();

        this.ui = new UIManager({
            onDriveModeClick: () => this.stateMachine.requestDriveModeToggle(),
            onStopClick: () => this.stateMachine.requestStopAction(),
            onTorTakeoverClick: () => this.stateMachine.requestTorTakeover()
        });

        this.stateMachine = new StateMachine(this);

        this.comm = new CommManager({
            onConnect: () => this.stateMachine.handleConnect(),
            onDisconnect: () => this.stateMachine.handleDisconnect(),
            onHeartbeat: (data) => this.stateMachine.handleHeartbeat(data),
            getTransmitPayload: () => this.stateMachine.getTransmitPayload()
        });
    }
}

window.addEventListener('DOMContentLoaded', () => { window.app = new Mini4WDApp(); });
