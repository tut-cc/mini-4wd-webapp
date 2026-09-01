"""
Mini 4WD Server ユニットテスト & 結合テスト
"""
import unittest
import asyncio
import json
import time

from server.constants import MCUMode, StopReason, RejectReason
from server.controller import VehicleController
from mock.camera import MockCameraProvider
from mock.scenario import ScenarioManager

class TestVehicleController(unittest.TestCase):
    def setUp(self):
        self.motor_calls = []
        self.controller = VehicleController(on_motor_update=lambda th, st: self.motor_calls.append((th, st)))

    def test_initial_state(self):
        telemetry = self.controller.get_telemetry()
        self.assertEqual(telemetry["mode"], MCUMode.MANUAL)
        self.assertEqual(telemetry["stop_reason"], StopReason.NONE)
        self.assertEqual(telemetry["front_distance_mm"], 1200)

    def test_emergency_stop(self):
        self.controller.process_command({"emergency_stop_request": True})
        self.assertEqual(self.controller.state["mode"], MCUMode.EMERGENCY_STOP)
        self.assertEqual(self.controller.state["stop_reason"], StopReason.EMERGENCY_BUTTON)
        self.assertEqual(self.controller.throttle, 0.0)
        self.assertEqual(self.controller.steering, 0.0)

    def test_reset_stop(self):
        self.controller.trigger_emergency_stop()
        # 障害物が近い場合 (<=200mm) はリセット拒否
        self.controller.update_sensor(150)
        self.controller.process_command({"reset_stop_request": True})
        self.assertEqual(self.controller.state["mode"], MCUMode.EMERGENCY_STOP)
        self.assertEqual(self.controller.state["request_reject_reason"], RejectReason.OBSTACLE_NEAR)

        # 障害物が離れている場合 (>200mm) はリセット成功
        self.controller.update_sensor(500)
        self.controller.process_command({"reset_stop_request": True})
        self.assertEqual(self.controller.state["mode"], MCUMode.MANUAL)
        self.assertEqual(self.controller.state["stop_reason"], StopReason.NONE)

    def test_mode_switch_to_auto(self):
        # MANUALかつ障害物なし -> AUTO成功
        self.controller.update_sensor(500)
        self.controller.process_command({"mode_request": "AUTO"})
        self.assertEqual(self.controller.state["mode"], MCUMode.AUTO)

        # AUTO中にMANUAL要求 -> 即時MANUAL介入成功
        self.controller.process_command({"mode_request": "MANUAL"})
        self.assertEqual(self.controller.state["mode"], MCUMode.MANUAL)

    def test_tor_timeout_to_safe_stop(self):
        self.controller.state["mode"] = MCUMode.AUTO
        self.controller.trigger_tor(duration_ms=200)
        self.assertTrue(self.controller.state["tor_active"])

        # 100ms経過
        self.controller.tick(100)
        self.assertEqual(self.controller.state["tor_remaining_ms"], 100)
        self.assertEqual(self.controller.state["mode"], MCUMode.AUTO)

        # さらに100ms経過 -> 0ms到達で SAFE_STOP に遷移
        self.controller.tick(100)
        self.assertEqual(self.controller.state["tor_remaining_ms"], 0)
        self.assertEqual(self.controller.state["mode"], MCUMode.SAFE_STOP)
        self.assertEqual(self.controller.state["stop_reason"], StopReason.TOR_TIMEOUT)

    def test_manual_throttle_steering(self):
        self.controller.process_command({"throttle": 0.75, "steering": -0.5})
        th, st = self.controller.get_motor_output()
        self.assertAlmostEqual(th, 0.75)
        self.assertAlmostEqual(st, -0.5)

    def test_comm_timeout_to_safe_stop(self):
        # コマンド送信後、1.5秒以上経過すると COMM_TIMEOUT で SAFE_STOP に遷移
        self.controller.last_command_time = time.monotonic() - 1.6
        self.controller.tick(100)
        self.assertEqual(self.controller.state["mode"], MCUMode.SAFE_STOP)
        self.assertEqual(self.controller.state["stop_reason"], StopReason.COMM_TIMEOUT)

    def test_stop_rejects_manual_switch(self):
        # EMERGENCY_STOP 中は mode_request: MANUAL を拒否 (IN_EMERGENCY)
        self.controller.trigger_emergency_stop()
        self.controller.process_command({"mode_request": "MANUAL"})
        self.assertEqual(self.controller.state["mode"], MCUMode.EMERGENCY_STOP)
        self.assertEqual(self.controller.state["request_reject_reason"], RejectReason.IN_EMERGENCY)

        # SAFE_STOP 中も mode_request: MANUAL を拒否 (MODE_MISMATCH)
        self.controller.trigger_safe_stop()
        self.controller.process_command({"mode_request": "MANUAL"})
        self.assertEqual(self.controller.state["mode"], MCUMode.SAFE_STOP)
        self.assertEqual(self.controller.state["request_reject_reason"], RejectReason.MODE_MISMATCH)

    def test_running_reset_ignored(self):
        # AUTO走行中は reset_stop_request が無視される
        self.controller.update_sensor(500)
        self.controller.process_command({"mode_request": "AUTO"})
        self.assertEqual(self.controller.state["mode"], MCUMode.AUTO)

        self.controller.process_command({"reset_stop_request": True})
        self.assertEqual(self.controller.state["mode"], MCUMode.AUTO)

    def test_client_mode_mismatch_discard_throttle(self):
        # クライアントが SAFE_STOP 認識のままスロットルを送信した場合、破棄される
        self.controller.process_command({"client_mode": "SAFE_STOP", "throttle": 0.8, "steering": 0.5})
        th, st = self.controller.get_motor_output()
        self.assertEqual(th, 0.0)
        self.assertEqual(st, 0.0)

    def test_tor_rejects_auto_request(self):
        # TOR中に AUTO 要求が来たら IN_TOR で拒否
        self.controller.state["mode"] = MCUMode.AUTO
        self.controller.trigger_tor(duration_ms=4500)
        self.controller.process_command({"mode_request": "AUTO"})
        self.assertEqual(self.controller.state["request_reject_reason"], RejectReason.IN_TOR)

    def test_camera_generation(self):
        camera = MockCameraProvider(self.controller)
        frame = camera.get_frame()
        self.assertIsInstance(frame, bytes)
        self.assertTrue(frame.startswith(b"\x89PNG\r\n\x1a\n"))

if __name__ == "__main__":
    unittest.main()
