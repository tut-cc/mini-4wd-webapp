/**
 * ミニ四駆自動運転 WebApp - 定数 & 設定
 */
export const UIState = {
    DISCONNECTED: 'DISCONNECTED',
    MANUAL: 'MANUAL',
    AUTO_PENDING: 'AUTO_PENDING',
    MANUAL_PENDING: 'MANUAL_PENDING',
    AUTO: 'AUTO',
    AUTO_TOR: 'AUTO_TOR',
    SAFE_STOP: 'SAFE_STOP',
    EMERGENCY_STOP: 'EMERGENCY_STOP'
};

export const MCUMode = {
    MANUAL: 'MANUAL',
    AUTO: 'AUTO',
    SAFE_STOP: 'SAFE_STOP',
    EMERGENCY_STOP: 'EMERGENCY_STOP'
};

export const ModeRequest = { NONE: 'NONE', MANUAL: 'MANUAL', AUTO: 'AUTO' };

export const StopReasonText = {
    OBSTACLE: '障害物検知',
    TOR_TIMEOUT: '引継ぎ時間切れ',
    EMERGENCY_BUTTON: '非常停止',
    COMM_TIMEOUT: '通信切断',
    SENSOR_ERROR: 'センサー異常'
};

export const RejectReasonText = {
    OBSTACLE_NEAR: '前方に障害物があります',
    SENSOR_NOT_READY: 'センサーが準備できていません',
    IN_TOR: '運転引継ぎ警告中です',
    IN_EMERGENCY: '非常停止中のため操作できません',
    MODE_MISMATCH: '停止中のため切替できません'
};

export const Config = {
    TRANSMIT_INTERVAL_MS: 100,
    WS_HEARTBEAT_TIMEOUT_MS: 1500,
    WS_RECONNECT_DELAY_MS: 1500,
    MODE_SWITCH_TIMEOUT_MS: 1000,
    ALERT_DISPLAY_DURATION_MS: 3000,
    TOUCH_MAX_DISTANCE: 60,
    INPUT_DEADBAND: 0.05
};
