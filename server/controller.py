"""
車両状態管理・制御コア (VehicleController)
実機・モック共通の Source of Truth & 安全判定ロジック
"""
import time
from typing import Callable, Optional
from .constants import MCUMode, StopReason, RejectReason, DEADMAN_TIMEOUT_SEC, COMM_TIMEOUT_SEC

class VehicleController:
    def __init__(self, on_motor_update: Optional[Callable[[float, float], None]] = None):
        """
        :param on_motor_update: モーター・サーボ出力変更時のコールバック (throttle: float, steering: float)
                               実機のPWMドライバ等と直接バインド可能
        """
        self.on_motor_update = on_motor_update

        # 車両状態 (Source of Truth)
        self.state = {
            "mode": MCUMode.MANUAL,
            "front_distance_mm": 1200,
            "tor_active": False,
            "tor_remaining_ms": 0,
            "stop_reason": StopReason.NONE,
            "request_reject_reason": RejectReason.NONE
        }

        # 現在の出力指示値
        self.throttle = 0.0
        self.steering = 0.0

        # 通信・安全タイマー
        self.last_command_time = time.monotonic()

    def get_telemetry(self) -> dict:
        """WebAppにブロードキャストする最新状態の辞書を返す"""
        return dict(self.state)

    def get_motor_output(self) -> tuple[float, float]:
        """現在の実質的な出力値 (throttle, steering) を返す"""
        return self.throttle, self.steering

    def update_sensor(self, front_distance_mm: int):
        """
        センサーからの測距値を更新 (実機ToF/超音波センサーやモックから呼び出し可能)
        """
        self.state["front_distance_mm"] = front_distance_mm

        # AUTO走行中の障害物自動検知 (自律中断)
        if self.state["mode"] == MCUMode.AUTO and front_distance_mm < 100:
            self.trigger_auto_abort(StopReason.OBSTACLE)

    def trigger_manual_abort(self, reason: str = StopReason.MANUAL_ABORT_BUTTON):
        """最優先: 手動中断を発動"""
        self.state["mode"] = MCUMode.MANUAL_ABORT
        self.state["stop_reason"] = reason
        self.state["tor_active"] = False
        self.state["tor_remaining_ms"] = 0
        self.state["request_reject_reason"] = RejectReason.NONE
        self._apply_motor(0.0, 0.0)

    def trigger_auto_abort(self, reason: str = StopReason.OBSTACLE):
        """自律安全中断を発動"""
        self.state["mode"] = MCUMode.AUTO_ABORT
        self.state["stop_reason"] = reason
        self.state["tor_active"] = False
        self.state["tor_remaining_ms"] = 0
        self._apply_motor(0.0, 0.0)

    # 互換用エイリアス
    trigger_emergency_stop = trigger_manual_abort
    trigger_safe_stop = trigger_auto_abort

    def trigger_tor(self, duration_ms: int = 4500):
        """TOR (運転引き継ぎ警告) を発動"""
        if self.state["mode"] == MCUMode.AUTO:
            self.state["tor_active"] = True
            self.state["tor_remaining_ms"] = duration_ms

    def reset_abort(self) -> bool:
        """
        中断状態 (AUTO_ABORT / MANUAL_ABORT) からの復帰要求を処理
        """
        if self.state["mode"] not in (MCUMode.AUTO_ABORT, MCUMode.MANUAL_ABORT):
            return False

        if self.state["front_distance_mm"] > 200:
            self.state["mode"] = MCUMode.MANUAL
            self.state["stop_reason"] = StopReason.NONE
            self.state["request_reject_reason"] = RejectReason.NONE
            self.state["tor_active"] = False
            self.state["tor_remaining_ms"] = 0
            self._apply_motor(0.0, 0.0)
            return True
        else:
            self.state["request_reject_reason"] = RejectReason.OBSTACLE_NEAR
            return False

    # 互換用エイリアス
    reset_stop = reset_abort

    def request_mode(self, target_mode: str) -> bool:
        """
        モード切替要求を処理 (プロトコル安全判定マトリクス準拠)
        """
        current_mode = self.state["mode"]

        # 手動中断中の切替要求は拒否
        if current_mode == MCUMode.MANUAL_ABORT:
            self.state["request_reject_reason"] = RejectReason.IN_MANUAL_ABORT
            return False

        # 自動中断中の切替要求は拒否 (要リセット)
        if current_mode == MCUMode.AUTO_ABORT:
            self.state["request_reject_reason"] = RejectReason.MODE_MISMATCH
            return False

        if target_mode == MCUMode.AUTO:
            # TOR中のAUTO切替要求は拒否
            if self.state["tor_active"]:
                self.state["request_reject_reason"] = RejectReason.IN_TOR
                return False

            # MANUALからAUTOへの切り替え
            if current_mode == MCUMode.MANUAL:
                if self.state["front_distance_mm"] > 300:
                    self.state["mode"] = MCUMode.AUTO
                    self.state["request_reject_reason"] = RejectReason.NONE
                    self._apply_motor(0.0, 0.0)
                    return True
                else:
                    self.state["request_reject_reason"] = RejectReason.OBSTACLE_NEAR
                    return False
            else:
                self.state["request_reject_reason"] = RejectReason.MODE_MISMATCH
                return False

        elif target_mode == MCUMode.MANUAL:
            # AUTOやTOR等からMANUALへの手動介入 (即時受諾)
            self.state["mode"] = MCUMode.MANUAL
            self.state["tor_active"] = False
            self.state["tor_remaining_ms"] = 0
            self.state["request_reject_reason"] = RejectReason.NONE
            return True

        return False

    def process_command(self, cmd: dict):
        """
        WebAppから受信した操作コマンドの安全判定 & 適用
        """
        if not isinstance(cmd, dict):
            return

        self.last_command_time = time.monotonic()
        client_mode = cmd.get("client_mode")
        current_mode = self.state["mode"]

        # 1. 最優先: 手動中断 (MANUAL_ABORT / 旧 EMERGENCY_STOP)
        if cmd.get("manual_abort_request") or cmd.get("emergency_stop_request"):
            self.trigger_manual_abort(StopReason.MANUAL_ABORT_BUTTON)
            return

        # 2. リセット要求 (中断状態のみ受容)
        if cmd.get("reset_abort_request") or cmd.get("reset_stop_request"):
            self.reset_abort()
            return

        # 3. モード切替要求
        mode_req = cmd.get("mode_request", "NONE")
        if mode_req in (MCUMode.AUTO, MCUMode.MANUAL):
            self.request_mode(mode_req)

        # 4. 手動走行指示 (スロットル / ステアリング)
        if self.state["mode"] == MCUMode.MANUAL:
            # 状態不一致でクライアントがMANUAL以外と認識している場合は安全のため走行指示を破棄
            if client_mode and client_mode != MCUMode.MANUAL:
                th, st = 0.0, 0.0
            else:
                try:
                    th = float(cmd.get("throttle", 0.0))
                    st = float(cmd.get("steering", 0.0))
                except (ValueError, TypeError):
                    th, st = 0.0, 0.0
                # 安全のため [-1.0, 1.0] にクランプ
                th = max(-1.0, min(1.0, th))
                st = max(-1.0, min(1.0, st))
            self._apply_motor(th, st)
        else:
            self._apply_motor(0.0, 0.0)

    def tick(self, dt_ms: int):
        """
        定期周期更新 (TORカウントダウン、デッドマン監視、通信断監視など)
        :param dt_ms: 前回tickからの経過時間 (ミリ秒)
        """
        # TOR カウントダウン & 猶予切れ時の自動中断
        if self.state["tor_active"] and self.state["tor_remaining_ms"] > 0:
            self.state["tor_remaining_ms"] = max(0, self.state["tor_remaining_ms"] - dt_ms)
            if self.state["tor_remaining_ms"] == 0:
                self.trigger_auto_abort(StopReason.TOR_TIMEOUT)

        # 通信途絶監視 (1.5秒間コマンド未受信で AUTO_ABORT)
        if self.state["mode"] not in (MCUMode.AUTO_ABORT, MCUMode.MANUAL_ABORT):
            if time.monotonic() - self.last_command_time > COMM_TIMEOUT_SEC:
                self.trigger_auto_abort(StopReason.COMM_TIMEOUT)

        # デッドマンタイマー (MANUAL走行中、コマンド途絶で自動中立)
        if self.state["mode"] == MCUMode.MANUAL:
            if time.monotonic() - self.last_command_time > DEADMAN_TIMEOUT_SEC:
                if self.throttle != 0.0 or self.steering != 0.0:
                    self._apply_motor(0.0, 0.0)

    def _apply_motor(self, throttle: float, steering: float):
        self.throttle = throttle
        self.steering = steering
        if self.on_motor_update:
            try:
                self.on_motor_update(throttle, steering)
            except Exception:
                pass
