"""
モック用シナリオ管理 & ターミナル入力受付
"""
import asyncio
import json
import os
import sys
from server.controller import VehicleController

DEFAULT_SCENARIOS = {
    "manual_ready": {
        "mode": "MANUAL",
        "front_distance_mm": 1200,
        "tor_active": False,
        "tor_remaining_ms": 0,
        "stop_reason": "NONE",
        "request_reject_reason": "NONE"
    },
    "auto_cruising": {
        "mode": "AUTO",
        "front_distance_mm": 850,
        "tor_active": False,
        "tor_remaining_ms": 0,
        "stop_reason": "NONE",
        "request_reject_reason": "NONE"
    },
    "tor_warning": {
        "mode": "AUTO",
        "front_distance_mm": 350,
        "tor_active": True,
        "tor_remaining_ms": 3000,
        "stop_reason": "NONE",
        "request_reject_reason": "NONE"
    },
    "obstacle_stop": {
        "mode": "AUTO_ABORT",
        "front_distance_mm": 80,
        "tor_active": False,
        "tor_remaining_ms": 0,
        "stop_reason": "OBSTACLE",
        "request_reject_reason": "NONE"
    },
    "emergency_stop": {
        "mode": "MANUAL_ABORT",
        "front_distance_mm": 1200,
        "tor_active": False,
        "tor_remaining_ms": 0,
        "stop_reason": "MANUAL_ABORT_BUTTON",
        "request_reject_reason": "NONE"
    }
}

KEYMAP = {
    "1": "manual_ready",
    "2": "auto_cruising",
    "3": "tor_warning",
    "4": "obstacle_stop",
    "5": "emergency_stop"
}

DEFAULT_SCENARIOS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scenarios.json")

class ScenarioManager:
    def __init__(self, controller: VehicleController, scenarios_file: str = DEFAULT_SCENARIOS_FILE):
        self.controller = controller
        self.scenarios_file = scenarios_file
        self.scenarios = {}
        self.load_scenarios()

    def load_scenarios(self):
        if os.path.exists(self.scenarios_file):
            try:
                with open(self.scenarios_file, "r", encoding="utf-8") as f:
                    self.scenarios = json.load(f)
            except Exception:
                self.scenarios = DEFAULT_SCENARIOS
        else:
            self.scenarios = DEFAULT_SCENARIOS
            with open(self.scenarios_file, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_SCENARIOS, f, indent=2, ensure_ascii=False)

    def apply_scenario(self, name: str):
        if name in self.scenarios:
            scenario_data = self.scenarios[name]
            self.controller.state.update(scenario_data)
            print(f"\n[Scenario] -> {name} applied (Mode: {self.controller.state['mode']})")

    async def terminal_input_loop(self):
        loop = asyncio.get_running_loop()
        print(f"\n[Terminal Keys] [1]Manual [2]Auto [3]TOR [4]AutoAbort [5]ManualAbort [r]Reload Scenarios\n")
        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                break
            k = line.strip()
            if k in KEYMAP:
                self.apply_scenario(KEYMAP[k])
            elif k.lower() == "r":
                self.load_scenarios()
                print("\n[Scenario] Reloaded mock_scenarios.json")
