/**
 * ミニ四駆自動運転 WebApp - 定数 & 列挙型 (Enum) 定義
 * 
 * すべてのEnumは Object.freeze() で保護され、イミュータブルな疑似Enumとして機能します。
 */

// ==========================================
// 1. 状態・モード定義 (Enums)
// ==========================================

/**
 * WebApp UI 表示状態
 */
export const UIState = Object.freeze({
    DISCONNECTED: 'DISCONNECTED',
    MANUAL: 'MANUAL',
    AUTO_PENDING: 'AUTO_PENDING',
    MANUAL_PENDING: 'MANUAL_PENDING',
    AUTO: 'AUTO',
    AUTO_TOR: 'AUTO_TOR',
    SAFE_STOP: 'SAFE_STOP',
    EMERGENCY_STOP: 'EMERGENCY_STOP'
});

/**
 * WebAppが認識している現在モード (送信パケット用)
 */
export const ClientMode = Object.freeze({
    MANUAL: 'MANUAL',
    AUTO: 'AUTO',
    SAFE_STOP: 'SAFE_STOP',
    EMERGENCY_STOP: 'EMERGENCY_STOP'
});

/**
 * マイコンの確定現在モード (Source of Truth)
 */
export const MCUMode = Object.freeze({
    MANUAL: 'MANUAL',
    AUTO: 'AUTO',
    SAFE_STOP: 'SAFE_STOP',
    EMERGENCY_STOP: 'EMERGENCY_STOP'
});

/**
 * モード切替要求
 */
export const ModeRequest = Object.freeze({
    NONE: 'NONE',
    MANUAL: 'MANUAL',
    AUTO: 'AUTO'
});

/**
 * 停止要因 (stop_reason)
 */
export const StopReason = Object.freeze({
    NONE: 'NONE',
    OBSTACLE: 'OBSTACLE',
    TOR_TIMEOUT: 'TOR_TIMEOUT',
    EMERGENCY_BUTTON: 'EMERGENCY_BUTTON',
    COMM_TIMEOUT: 'COMM_TIMEOUT',
    SENSOR_ERROR: 'SENSOR_ERROR'
});

/**
 * 停止要因のUI表示テキスト
 */
export const StopReasonText = Object.freeze({
    [StopReason.NONE]: 'NONE',
    [StopReason.OBSTACLE]: 'OBSTACLE DETECTED',
    [StopReason.TOR_TIMEOUT]: 'TOR TIMEOUT',
    [StopReason.EMERGENCY_BUTTON]: 'EMERGENCY STOP',
    [StopReason.COMM_TIMEOUT]: 'COMM TIMEOUT',
    [StopReason.SENSOR_ERROR]: 'SENSOR ERROR'
});

/**
 * 要求拒否理由 (request_reject_reason)
 */
export const RejectReason = Object.freeze({
    NONE: 'NONE',
    SENSOR_NOT_READY: 'SENSOR_NOT_READY',
    OBSTACLE_NEAR: 'OBSTACLE_NEAR',
    IN_TOR: 'IN_TOR',
    IN_EMERGENCY: 'IN_EMERGENCY',
    MODE_MISMATCH: 'MODE_MISMATCH'
});

/**
 * 要求拒否理由のUI表示テキスト
 */
export const RejectReasonText = Object.freeze({
    [RejectReason.NONE]: 'NONE',
    [RejectReason.OBSTACLE_NEAR]: 'OBSTACLE NEAR',
    [RejectReason.SENSOR_NOT_READY]: 'SENSOR NOT READY',
    [RejectReason.IN_TOR]: 'IN TOR WARNING',
    [RejectReason.IN_EMERGENCY]: 'IN EMERGENCY STOP',
    [RejectReason.MODE_MISMATCH]: 'MODE MISMATCH'
});

// ==========================================
// 2. システム設定・閾値定数 (Config)
// ==========================================

export const Config = Object.freeze({
    // 通信パラメータ
    TRANSMIT_INTERVAL_MS: 100,      // WebSocket送信周期 (10Hz)
    WS_HEARTBEAT_TIMEOUT_MS: 1500,  // 通信途絶判定タイムアウト
    WS_RECONNECT_DELAY_MS: 1500,    // 再接続試行ディレイ
    MODE_SWITCH_TIMEOUT_MS: 1000,   // モード切替応答待ちタイムアウト

    // UIパラメータ
    ALERT_DISPLAY_DURATION_MS: 3000,// エラー通知バナー表示時間

    // カメラ設定
    DEFAULT_CAMERA_URL: '/video_feed',
    STORAGE_KEY_CAMERA_URL: 'mini4wd_camera_url',

    // 入力制御パラメータ
    TOUCH_MAX_DISTANCE: 60,         // ジョイスティック最大移動距離 (px)
    INPUT_DEADBAND: 0.05,           // タッチ/マウスの不感帯
    GAMEPAD_DEADBAND: 0.08          // ゲームパッドスティック不感帯
});
