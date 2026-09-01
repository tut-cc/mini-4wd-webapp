import asyncio
import base64
import hashlib
import json
import os
import struct
import sys

# RFC 6455 WebSocket GUID
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

class Mini4WDMockServer:
    def __init__(self, host="0.0.0.0", port=8765, scenarios_file="mock_scenarios.json"):
        self.host = host
        self.port = port
        self.scenarios_file = scenarios_file
        self.clients = set()
        
        # Current simulated state (Source of Truth)
        self.state = {
            "mode": "MANUAL",
            "front_distance_mm": 1200,
            "tor_active": False,
            "tor_remaining_ms": 0,
            "stop_reason": "NONE",
            "request_reject_reason": "NONE",
            "heartbeat_seq": 0
        }
        
        self.scenario = "manual_ready"
        self.load_scenarios()

    def load_scenarios(self):
        default_scenarios = {
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
                "tor_remaining_ms": 4500,
                "stop_reason": "NONE",
                "request_reject_reason": "NONE"
            },
            "obstacle_stop": {
                "mode": "SAFE_STOP",
                "front_distance_mm": 90,
                "tor_active": False,
                "tor_remaining_ms": 0,
                "stop_reason": "OBSTACLE",
                "request_reject_reason": "NONE"
            },
            "emergency_stop": {
                "mode": "EMERGENCY_STOP",
                "front_distance_mm": 1200,
                "tor_active": False,
                "tor_remaining_ms": 0,
                "stop_reason": "EMERGENCY_BUTTON",
                "request_reject_reason": "NONE"
            }
        }
        
        if os.path.exists(self.scenarios_file):
            try:
                with open(self.scenarios_file, "r", encoding="utf-8") as f:
                    self.scenarios = json.load(f)
            except Exception as e:
                print(f"[Warning] Failed to load {self.scenarios_file}: {e}. Using defaults.")
                self.scenarios = default_scenarios
        else:
            self.scenarios = default_scenarios
            with open(self.scenarios_file, "w", encoding="utf-8") as f:
                json.dump(default_scenarios, f, indent=2, ensure_ascii=False)
            print(f"[Info] Created default scenario file: {self.scenarios_file}")

    def apply_scenario(self, scenario_name):
        if scenario_name in self.scenarios:
            self.scenario = scenario_name
            preset = self.scenarios[scenario_name]
            for k, v in preset.items():
                self.state[k] = v
            print(f"\n[Scenario Changed] -> {scenario_name}: {self.state['mode']} (TOR={self.state['tor_active']}, Stop={self.state['stop_reason']})")
        else:
            print(f"\n[Error] Unknown scenario: {scenario_name}")

    def create_ws_frame(self, message: str) -> bytes:
        data = message.encode("utf-8")
        length = len(data)
        if length <= 125:
            header = bytes([0x81, length])
        elif length <= 65535:
            header = struct.pack("!BBH", 0x81, 126, length)
        else:
            header = struct.pack("!BBQ", 0x81, 127, length)
        return header + data

    def parse_ws_frame(self, data: bytes):
        if len(data) < 2:
            return None, 0
        byte1, byte2 = data[0], data[1]
        opcode = byte1 & 0x0F
        masked = (byte2 & 0x80) != 0
        payload_len = byte2 & 0x7F
        idx = 2

        if payload_len == 126:
            if len(data) < 4:
                return None, 0
            payload_len = struct.unpack("!H", data[2:4])[0]
            idx = 4
        elif payload_len == 127:
            if len(data) < 10:
                return None, 0
            payload_len = struct.unpack("!Q", data[2:10])[0]
            idx = 10

        mask_key = b""
        if masked:
            if len(data) < idx + 4:
                return None, 0
            mask_key = data[idx:idx+4]
            idx += 4

        if len(data) < idx + payload_len:
            return None, 0

        raw_payload = data[idx:idx+payload_len]
        consumed = idx + payload_len

        if masked:
            unmasked = bytearray(payload_len)
            for i in range(payload_len):
                unmasked[i] = raw_payload[i] ^ mask_key[i % 4]
            payload = bytes(unmasked)
        else:
            payload = raw_payload

        return (opcode, payload), consumed

    async def handle_client(self, reader, writer):
        addr = writer.get_extra_info("peername")
        print(f"\n[Client Connected] {addr}")

        # WebSocket Handshake
        request = await reader.read(4096)
        if not request:
            writer.close()
            return

        headers = {}
        for line in request.decode("utf-8", errors="ignore").split("\r\n")[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        ws_key = headers.get("sec-websocket-key")
        if not ws_key:
            writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            await writer.drain()
            writer.close()
            return

        accept_val = base64.b64encode(
            hashlib.sha1((ws_key + WS_GUID).encode("utf-8")).digest()
        ).decode("utf-8")

        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept_val}\r\n\r\n"
        )
        writer.write(response.encode("utf-8"))
        await writer.drain()

        self.clients.add(writer)
        recv_buf = bytearray()

        try:
            while True:
                data = await reader.read(4096)
                if not data:
                    break
                recv_buf.extend(data)

                while True:
                    frame, consumed = self.parse_ws_frame(recv_buf)
                    if frame is None:
                        break
                    recv_buf = recv_buf[consumed:]
                    opcode, payload = frame

                    if opcode == 0x8:  # Close
                        return
                    elif opcode == 0x9:  # Ping
                        pong_frame = bytes([0x8A, 0x00])
                        writer.write(pong_frame)
                        await writer.drain()
                    elif opcode == 0x1:  # Text JSON
                        self.process_command(payload.decode("utf-8", errors="ignore"))

        except Exception as e:
            print(f"[Client Error] {addr}: {e}")
        finally:
            self.clients.discard(writer)
            writer.close()
            print(f"\n[Client Disconnected] {addr}")

    def process_command(self, msg_str):
        try:
            cmd = json.loads(msg_str)
        except Exception:
            return

        # 1. EMERGENCY STOP (Top Priority)
        if cmd.get("emergency_stop_request"):
            self.state["mode"] = "EMERGENCY_STOP"
            self.state["stop_reason"] = "EMERGENCY_BUTTON"
            self.state["tor_active"] = False
            self.state["tor_remaining_ms"] = 0
            print("[MCU] -> EMERGENCY_STOP triggered by WebApp!")
            return

        # 2. Reset / Resume Stop
        if cmd.get("reset_stop_request"):
            if self.state["front_distance_mm"] > 200:
                self.state["mode"] = "MANUAL"
                self.state["stop_reason"] = "NONE"
                self.state["request_reject_reason"] = "NONE"
                print("[MCU] -> Resumed to MANUAL mode.")
            else:
                self.state["request_reject_reason"] = "OBSTACLE_NEAR"
                print("[MCU] -> Reset rejected: Obstacle still present.")
            return

        # 3. Mode Request
        mode_req = cmd.get("mode_request", "NONE")
        if mode_req == "AUTO":
            if self.state["mode"] == "MANUAL" and self.state["front_distance_mm"] > 300:
                self.state["mode"] = "AUTO"
                self.state["request_reject_reason"] = "NONE"
                print("[MCU] -> Mode changed: MANUAL -> AUTO")
            else:
                self.state["request_reject_reason"] = "OBSTACLE_NEAR" if self.state["front_distance_mm"] <= 300 else "MODE_MISMATCH"
                print(f"[MCU] -> AUTO switch rejected ({self.state['request_reject_reason']})")
        elif mode_req == "MANUAL":
            self.state["mode"] = "MANUAL"
            self.state["tor_active"] = False
            self.state["tor_remaining_ms"] = 0
            self.state["request_reject_reason"] = "NONE"
            print("[MCU] -> Mode changed: AUTO -> MANUAL (Manual takeover)")

        # 4. Driving Command logging
        throttle = cmd.get("throttle", 0.0)
        steering = cmd.get("steering", 0.0)
        if throttle != 0 or steering != 0:
            if self.state["mode"] == "MANUAL":
                pass # Driving accepted
            else:
                pass # Discarded (safe behavior)

    async def heartbeat_loop(self):
        while True:
            self.state["heartbeat_seq"] = (self.state["heartbeat_seq"] + 1) % 65536
            
            # TOR countdown simulation
            if self.state["tor_active"] and self.state["tor_remaining_ms"] > 0:
                self.state["tor_remaining_ms"] -= 100
                if self.state["tor_remaining_ms"] <= 0:
                    self.state["tor_active"] = False
                    self.state["tor_remaining_ms"] = 0
                    self.state["mode"] = "SAFE_STOP"
                    self.state["stop_reason"] = "TOR_TIMEOUT"
                    print("\n[MCU] -> TOR Timeout! Transitioned to SAFE_STOP.")

            payload = json.dumps(self.state)
            frame = self.create_ws_frame(payload)

            disconnected = set()
            for client in self.clients:
                try:
                    client.write(frame)
                    await client.drain()
                except Exception:
                    disconnected.add(client)

            for d in disconnected:
                self.clients.discard(d)

            await asyncio.sleep(0.1)  # 100ms interval

    async def terminal_input_loop(self):
        loop = asyncio.get_event_loop()
        print("\n" + "="*50)
        print(" Mini 4WD Mock MCU Server running on ws://localhost:8765")
        print(" Interactive Keys: ")
        print("   [1] Manual Ready      [2] Auto Cruising")
        print("   [3] Trigger TOR (5s)  [4] Obstacle Stop")
        print("   [5] Emergency Stop    [r] Reload JSON scenarios")
        print("="*50 + "\n")

        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                break
            key = line.strip()
            if key == "1":
                self.apply_scenario("manual_ready")
            elif key == "2":
                self.apply_scenario("auto_cruising")
            elif key == "3":
                self.apply_scenario("tor_warning")
            elif key == "4":
                self.apply_scenario("obstacle_stop")
            elif key == "5":
                self.apply_scenario("emergency_stop")
            elif key.lower() == "r":
                self.load_scenarios()
                print("[Info] Reloaded scenarios from mock_scenarios.json")

    async def main(self):
        server = await asyncio.start_server(self.handle_client, self.host, self.port)
        print(f"[Ready] WebSocket Server started on {self.host}:{self.port}")
        await asyncio.gather(
            server.serve_forever(),
            self.heartbeat_loop(),
            self.terminal_input_loop()
        )

if __name__ == "__main__":
    mock = Mini4WDMockServer(port=8765)
    try:
        asyncio.run(mock.main())
    except KeyboardInterrupt:
        print("\n[Shutdown] Server stopped.")
