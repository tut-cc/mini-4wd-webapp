import asyncio
import base64
import hashlib
import json
import os
import struct
import sys
import zlib

# RFC 6455 WebSocket GUID
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}

class CameraStreamGenerator:
    """
    車載広角カメラの映像をエミュレートするフレーム生成器
    マイコンの制御状態（スロットル、ステアリング、障害物距離）と同期した
    モノクロカメラ映像フレーム（PNG/JPEG）を高速生成してストリーミング出力します。
    """
    def __init__(self, width=320, height=180):
        self.width = width
        self.height = height
        self.frame_count = 0
        self.road_offset = 0.0
        self.lateral_offset = 0.0

    def generate_frame(self, state: dict, throttle: float = 0.0, steering: float = 0.0) -> bytes:
        w = self.width
        h = self.height
        self.frame_count += 1

        mode = state.get("mode", "MANUAL")
        dist = state.get("front_distance_mm", 1200)
        stop_reason = state.get("stop_reason", "NONE")

        if mode == "AUTO":
            speed = 0.8
            steer = 0.0
        elif mode == "MANUAL":
            speed = throttle
            steer = steering
        else: # SAFE_STOP, EMERGENCY_STOP
            speed = 0.0
            steer = 0.0

        self.road_offset = (self.road_offset + speed * 6.0) % 40.0
        self.lateral_offset += (steer * 20.0 - self.lateral_offset) * 0.15

        horizon_y = int(h * 0.48)
        track_top_w = 24
        track_bottom_w = int(w * 0.78)
        vanish_x = int(w / 2 + self.lateral_offset)

        raw = bytearray((w + 1) * h)

        for y in range(h):
            row_start = y * (w + 1)
            raw[row_start] = 0  # Filter type 0 (None)

            if y < horizon_y:
                # 明るい空 (ライトグレー〜白)
                sky_val = 245
                for x in range(w):
                    raw[row_start + 1 + x] = sky_val
            elif y == horizon_y:
                # 地平線
                for x in range(w):
                    raw[row_start + 1 + x] = 190
            else:
                dy = y - horizon_y
                ratio = dy / (h - horizon_y)
                current_track_w = int(track_top_w + ratio * (track_bottom_w - track_top_w))
                curr_vanish_x = int(vanish_x * (1.0 - ratio) + (w / 2) * ratio)

                left_x = curr_vanish_x - current_track_w // 2
                right_x = curr_vanish_x + current_track_w // 2
                center_x = curr_vanish_x

                for x in range(w):
                    # コース外 (明るい背景)
                    val = 230

                    if left_x <= x <= right_x:
                        # コース路面 (明るいアスファルトグレー)
                        val = 210

                    # コース境界の縁石・ライン
                    if abs(x - left_x) <= 2 or abs(x - right_x) <= 2:
                        # 縁石パターン (白黒交互)
                        curb_stripe = ((int(y + self.road_offset)) // 6) % 2 == 0
                        val = 40 if curb_stripe else 255
                    elif abs(x - center_x) <= 1 and ((int(y + self.road_offset)) // 10) % 2 == 0:
                        # 中央破線 (濃いグレー)
                        val = 60

                    # 障害物検知時のみ障害物を描画 (distが近い場合または障害物停止時)
                    if (dist < 600 or stop_reason == "OBSTACLE") and dist < 1500:
                        dist_norm = max(0.05, min(1.0, dist / 1500.0))
                        obs_y = horizon_y + int((1.0 - dist_norm) * (h * 0.40))
                        obs_w = int(14 + (1.0 - dist_norm) * 60)
                        obs_h = int(8 + (1.0 - dist_norm) * 24)
                        obs_center_x = int(vanish_x * (1.0 - (1.0 - dist_norm)))

                        if obs_y <= y <= obs_y + obs_h:
                            if abs(x - obs_center_x) <= obs_w // 2:
                                # 障害物ブロック (濃いグレー/黒)
                                val = 40

                    raw[row_start + 1 + x] = val

        sig = b'\x89PNG\r\n\x1a\n'
        ihdr_data = struct.pack('!IIBBBBB', w, h, 8, 0, 0, 0, 0)
        ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data)
        ihdr = struct.pack('!I4s', 13, b'IHDR') + ihdr_data + struct.pack('!I', ihdr_crc)

        compressed = zlib.compress(bytes(raw), 1)
        idat_crc = zlib.crc32(b'IDAT' + compressed)
        idat = struct.pack('!I4s', len(compressed), b'IDAT') + compressed + struct.pack('!I', idat_crc)

        iend_crc = zlib.crc32(b'IEND')
        iend = struct.pack('!I4s', 0, b'IEND') + struct.pack('!I', iend_crc)

        return sig + ihdr + idat + iend

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

        # Latest client control inputs
        self.client_throttle = 0.0
        self.client_steering = 0.0

        # Camera Stream Generator
        self.camera = CameraStreamGenerator(width=320, height=180)
        
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

        request = await reader.read(4096)
        if not request:
            writer.close()
            return

        lines = request.decode("utf-8", errors="ignore").split("\r\n")
        req_line = lines[0] if lines else ""
        parts = req_line.split(" ")
        method = parts[0] if len(parts) > 0 else "GET"
        raw_path = parts[1] if len(parts) > 1 else "/"
        path = raw_path.split("?")[0]

        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        ws_key = headers.get("sec-websocket-key")

        # 1. WebSocket Upgrade Request
        if ws_key and headers.get("upgrade", "").lower() == "websocket":
            print(f"\n[WS Connected] {addr}")
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
                print(f"[WS Error] {addr}: {e}")
            finally:
                self.clients.discard(writer)
                writer.close()
                print(f"\n[WS Disconnected] {addr}")
            return

        # 2. Camera Stream Request (/video_feed or /stream) - MJPEG Streaming
        if path in ("/video_feed", "/stream"):
            print(f"[Camera Stream Connected] {addr}")
            mjpeg_header = (
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
                "Cache-Control: no-cache, no-store, must-revalidate\r\n"
                "Pragma: no-cache\r\n"
                "Expires: 0\r\n"
                "Access-Control-Allow-Origin: *\r\n"
                "Connection: close\r\n\r\n"
            ).encode("utf-8")

            writer.write(mjpeg_header)
            await writer.drain()

            try:
                while True:
                    frame_data = self.camera.generate_frame(
                        self.state,
                        self.client_throttle,
                        self.client_steering
                    )
                    header_str = f"--frame\r\nContent-Type: image/png\r\nContent-Length: {len(frame_data)}\r\n\r\n"
                    writer.write(header_str.encode("utf-8") + frame_data + b"\r\n")
                    await writer.drain()
                    await asyncio.sleep(0.04) # 25 FPS
            except Exception:
                pass
            finally:
                writer.close()
                print(f"[Camera Stream Closed] {addr}")
            return

        # 3. Camera Snapshot (/snapshot)
        if path == "/snapshot":
            frame_data = self.camera.generate_frame(self.state, self.client_throttle, self.client_steering)
            res = (
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: image/png\r\n"
                f"Content-Length: {len(frame_data)}\r\n"
                "Cache-Control: no-cache\r\n"
                "Access-Control-Allow-Origin: *\r\n"
                "Connection: close\r\n\r\n"
            ).encode("utf-8") + frame_data
            writer.write(res)
            await writer.drain()
            writer.close()
            return

        # 4. HTTP Static File Request
        if path == "/" or path == "":
            rel_path = "index.html"
        else:
            rel_path = path.lstrip("/")

        file_path = os.path.normpath(os.path.join(BASE_DIR, rel_path))
        if not file_path.startswith(BASE_DIR) or not os.path.isfile(file_path):
            not_found_body = b"404 Not Found"
            res = (
                "HTTP/1.1 404 Not Found\r\n"
                "Content-Type: text/plain; charset=utf-8\r\n"
                f"Content-Length: {len(not_found_body)}\r\n"
                "Connection: close\r\n\r\n"
            ).encode("utf-8") + not_found_body
            writer.write(res)
            await writer.drain()
            writer.close()
            return

        try:
            with open(file_path, "rb") as f:
                content = f.read()

            _, ext = os.path.splitext(file_path)
            content_type = MIME_TYPES.get(ext.lower(), "application/octet-stream")

            res_header = (
                "HTTP/1.1 200 OK\r\n"
                f"Content-Type: {content_type}\r\n"
                f"Content-Length: {len(content)}\r\n"
                "Connection: close\r\n\r\n"
            ).encode("utf-8")

            writer.write(res_header + content)
            await writer.drain()
        except Exception as e:
            err_body = f"500 Internal Server Error: {e}".encode("utf-8")
            res = (
                "HTTP/1.1 500 Internal Server Error\r\n"
                "Content-Type: text/plain; charset=utf-8\r\n"
                f"Content-Length: {len(err_body)}\r\n"
                "Connection: close\r\n\r\n"
            ).encode("utf-8") + err_body
            writer.write(res)
            await writer.drain()
        finally:
            writer.close()

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
            self.client_throttle = 0.0
            self.client_steering = 0.0
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

        # 4. Driving Command updating
        throttle = cmd.get("throttle", 0.0)
        steering = cmd.get("steering", 0.0)
        if self.state["mode"] == "MANUAL":
            self.client_throttle = throttle
            self.client_steering = steering
        else:
            self.client_throttle = 0.0
            self.client_steering = 0.0

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
                    self.client_throttle = 0.0
                    self.client_steering = 0.0
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
        print(f" Mini 4WD Mock MCU Server running on http://localhost:{self.port}")
        print(f"   - WebApp URL:      http://localhost:{self.port}/")
        print(f"   - WebSocket URL:   ws://localhost:{self.port}/")
        print(f"   - Camera Stream:   http://localhost:{self.port}/video_feed")
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
        print(f"[Ready] Server started on {self.host}:{self.port}")
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

