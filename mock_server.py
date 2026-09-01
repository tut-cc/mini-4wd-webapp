import asyncio, base64, hashlib, json, os, struct, sys, zlib

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MIME_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".ico": "image/x-icon"
}

class CameraStreamGenerator:
    def __init__(self, w=320, h=180):
        self.w, self.h, self.road_offset, self.lateral_offset = w, h, 0.0, 0.0

    def generate_frame(self, state: dict, throttle: float = 0.0, steering: float = 0.0) -> bytes:
        w, h = self.w, self.h
        mode = state.get("mode", "MANUAL")
        dist = state.get("front_distance_mm", 1200)
        speed = 0.8 if mode == "AUTO" else (throttle if mode == "MANUAL" else 0.0)
        steer = 0.0 if mode != "MANUAL" else steering

        self.road_offset = (self.road_offset + speed * 6.0) % 40.0
        self.lateral_offset += (steer * 20.0 - self.lateral_offset) * 0.15

        horizon_y, vanish_x = int(h * 0.48), int(w / 2 + self.lateral_offset)
        raw = bytearray((w + 1) * h)

        for y in range(h):
            row = y * (w + 1)
            raw[row] = 0
            if y < horizon_y:
                for x in range(w): raw[row + 1 + x] = 245
            elif y == horizon_y:
                for x in range(w): raw[row + 1 + x] = 190
            else:
                ratio = (y - horizon_y) / (h - horizon_y)
                track_w = int(24 + ratio * (int(w * 0.78) - 24))
                cur_vanish = int(vanish_x * (1.0 - ratio) + (w / 2) * ratio)
                left_x, right_x = cur_vanish - track_w // 2, cur_vanish + track_w // 2

                for x in range(w):
                    val = 210 if left_x <= x <= right_x else 230
                    if abs(x - left_x) <= 2 or abs(x - right_x) <= 2:
                        val = 40 if (((int(y + self.road_offset)) // 6) % 2 == 0) else 255
                    elif abs(x - cur_vanish) <= 1 and ((int(y + self.road_offset)) // 10) % 2 == 0:
                        val = 60
                    if (dist < 600 or state.get("stop_reason") == "OBSTACLE") and dist < 1500:
                        d_norm = max(0.05, min(1.0, dist / 1500.0))
                        obs_y = horizon_y + int((1.0 - d_norm) * (h * 0.40))
                        obs_w, obs_h = int(14 + (1.0 - d_norm) * 60), int(8 + (1.0 - d_norm) * 24)
                        if obs_y <= y <= obs_y + obs_h and abs(x - int(vanish_x * d_norm)) <= obs_w // 2:
                            val = 40
                    raw[row + 1 + x] = val

        def chunk(tag, data):
            return struct.pack("!I4s", len(data), tag) + data + struct.pack("!I", zlib.crc32(tag + data))

        ihdr = struct.pack("!IIBBBBB", w, h, 8, 0, 0, 0, 0)
        idat = zlib.compress(bytes(raw), 1)
        return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

class Mini4WDMockServer:
    def __init__(self, host="0.0.0.0", port=8765, scenarios_file="mock_scenarios.json"):
        self.host, self.port, self.scenarios_file = host, port, scenarios_file
        self.clients = set()
        self.state = {"mode": "MANUAL", "front_distance_mm": 1200, "tor_active": False, "tor_remaining_ms": 0, "stop_reason": "NONE", "request_reject_reason": "NONE", "heartbeat_seq": 0}
        self.throttle, self.steering = 0.0, 0.0
        self.camera = CameraStreamGenerator()
        self.load_scenarios()

    def load_scenarios(self):
        defaults = {
            "manual_ready": {"mode": "MANUAL", "front_distance_mm": 1200, "tor_active": False, "tor_remaining_ms": 0, "stop_reason": "NONE", "request_reject_reason": "NONE"},
            "auto_cruising": {"mode": "AUTO", "front_distance_mm": 850, "tor_active": False, "tor_remaining_ms": 0, "stop_reason": "NONE", "request_reject_reason": "NONE"},
            "tor_warning": {"mode": "AUTO", "front_distance_mm": 350, "tor_active": True, "tor_remaining_ms": 4500, "stop_reason": "NONE", "request_reject_reason": "NONE"},
            "obstacle_stop": {"mode": "SAFE_STOP", "front_distance_mm": 90, "tor_active": False, "tor_remaining_ms": 0, "stop_reason": "OBSTACLE", "request_reject_reason": "NONE"},
            "emergency_stop": {"mode": "EMERGENCY_STOP", "front_distance_mm": 1200, "tor_active": False, "tor_remaining_ms": 0, "stop_reason": "EMERGENCY_BUTTON", "request_reject_reason": "NONE"}
        }
        if os.path.exists(self.scenarios_file):
            try:
                with open(self.scenarios_file, "r", encoding="utf-8") as f: self.scenarios = json.load(f)
            except Exception: self.scenarios = defaults
        else:
            self.scenarios = defaults
            with open(self.scenarios_file, "w", encoding="utf-8") as f: json.dump(defaults, f, indent=2, ensure_ascii=False)

    def apply_scenario(self, name):
        if name in self.scenarios:
            self.state.update(self.scenarios[name])
            print(f"\n[Scenario] -> {name}: {self.state['mode']}")

    def create_ws_frame(self, msg: str) -> bytes:
        data = msg.encode("utf-8")
        n = len(data)
        h = bytes([0x81, n]) if n <= 125 else (struct.pack("!BBH", 0x81, 126, n) if n <= 65535 else struct.pack("!BBQ", 0x81, 127, n))
        return h + data

    def parse_ws_frame(self, data: bytes):
        if len(data) < 2: return None, 0
        opcode, masked, length, idx = data[0] & 0x0F, (data[1] & 0x80) != 0, data[1] & 0x7F, 2
        if length == 126:
            if len(data) < 4: return None, 0
            length, idx = struct.unpack("!H", data[2:4])[0], 4
        elif length == 127:
            if len(data) < 10: return None, 0
            length, idx = struct.unpack("!Q", data[2:10])[0], 10
        if masked:
            if len(data) < idx + 4 + length: return None, 0
            mask, raw = data[idx:idx+4], data[idx+4:idx+4+length]
            return (opcode, bytes(b ^ mask[i % 4] for i, b in enumerate(raw))), idx + 4 + length
        if len(data) < idx + length: return None, 0
        return (opcode, data[idx:idx+length]), idx + length

    async def handle_client(self, reader, writer):
        req = await reader.read(4096)
        if not req: return writer.close()

        lines = req.decode("utf-8", errors="ignore").split("\r\n")
        parts = lines[0].split(" ") if lines else []
        path = (parts[1] if len(parts) > 1 else "/").split("?")[0]
        headers = {k.strip().lower(): v.strip() for line in lines[1:] if ":" in line for k, v in [line.split(":", 1)]}

        ws_key = headers.get("sec-websocket-key")
        if ws_key and headers.get("upgrade", "").lower() == "websocket":
            accept = base64.b64encode(hashlib.sha1((ws_key + WS_GUID).encode()).digest()).decode()
            writer.write(f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n".encode())
            await writer.drain()
            self.clients.add(writer)
            buf = bytearray()
            try:
                while True:
                    data = await reader.read(4096)
                    if not data: break
                    buf.extend(data)
                    while True:
                        frame, consumed = self.parse_ws_frame(buf)
                        if not frame: break
                        buf = buf[consumed:]
                        op, payload = frame
                        if op == 0x8: return
                        if op == 0x9: writer.write(bytes([0x8A, 0x00])); await writer.drain()
                        if op == 0x1: self.process_command(payload.decode("utf-8", errors="ignore"))
            finally:
                self.clients.discard(writer)
                writer.close()
            return

        if path in ("/video_feed", "/stream"):
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\n\r\n")
            await writer.drain()
            try:
                while True:
                    frame = self.camera.generate_frame(self.state, self.throttle, self.steering)
                    writer.write(f"--frame\r\nContent-Type: image/png\r\nContent-Length: {len(frame)}\r\n\r\n".encode() + frame + b"\r\n")
                    await writer.drain()
                    await asyncio.sleep(0.04)
            except Exception: pass
            finally: writer.close()
            return

        rel_path = "index.html" if path in ("", "/") else path.lstrip("/")
        file_path = os.path.normpath(os.path.join(BASE_DIR, rel_path))
        if not file_path.startswith(BASE_DIR) or not os.path.isfile(file_path):
            writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\n404 Not Found")
        else:
            with open(file_path, "rb") as f: content = f.read()
            ext = os.path.splitext(file_path)[1].lower()
            ct = MIME_TYPES.get(ext, "application/octet-stream")
            writer.write(f"HTTP/1.1 200 OK\r\nContent-Type: {ct}\r\nContent-Length: {len(content)}\r\n\r\n".encode() + content)
        await writer.drain()
        writer.close()

    def process_command(self, msg_str):
        try: cmd = json.loads(msg_str)
        except Exception: return

        if cmd.get("emergency_stop_request"):
            self.state.update({"mode": "EMERGENCY_STOP", "stop_reason": "EMERGENCY_BUTTON", "tor_active": False, "tor_remaining_ms": 0})
            self.throttle = self.steering = 0.0
            return

        if cmd.get("reset_stop_request"):
            if self.state["front_distance_mm"] > 200:
                self.state.update({"mode": "MANUAL", "stop_reason": "NONE", "request_reject_reason": "NONE"})
            else:
                self.state["request_reject_reason"] = "OBSTACLE_NEAR"
            return

        req = cmd.get("mode_request", "NONE")
        if req == "AUTO":
            if self.state["mode"] == "MANUAL" and self.state["front_distance_mm"] > 300:
                self.state.update({"mode": "AUTO", "request_reject_reason": "NONE"})
            else:
                self.state["request_reject_reason"] = "OBSTACLE_NEAR" if self.state["front_distance_mm"] <= 300 else "MODE_MISMATCH"
        elif req == "MANUAL":
            self.state.update({"mode": "MANUAL", "tor_active": False, "tor_remaining_ms": 0, "request_reject_reason": "NONE"})

        if self.state["mode"] == "MANUAL":
            self.throttle = cmd.get("throttle", 0.0)
            self.steering = cmd.get("steering", 0.0)
        else:
            self.throttle = self.steering = 0.0

    async def heartbeat_loop(self):
        while True:
            self.state["heartbeat_seq"] = (self.state["heartbeat_seq"] + 1) % 65536
            if self.state["tor_active"] and self.state["tor_remaining_ms"] > 0:
                self.state["tor_remaining_ms"] -= 100
                if self.state["tor_remaining_ms"] <= 0:
                    self.state.update({"tor_active": False, "tor_remaining_ms": 0, "mode": "SAFE_STOP", "stop_reason": "TOR_TIMEOUT"})
                    self.throttle = self.steering = 0.0

            frame = self.create_ws_frame(json.dumps(self.state))
            dis = set()
            for c in self.clients:
                try: c.write(frame); await c.drain()
                except Exception: dis.add(c)
            for d in dis: self.clients.discard(d)
            await asyncio.sleep(0.1)

    async def terminal_input_loop(self):
        loop = asyncio.get_event_loop()
        print(f"\nMini 4WD Mock Server: http://localhost:{self.port} | Keys: [1]Manual [2]Auto [3]TOR [4]Obstacle [5]Stop [r]Reload\n")
        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line: break
            k = line.strip()
            keymap = {"1": "manual_ready", "2": "auto_cruising", "3": "tor_warning", "4": "obstacle_stop", "5": "emergency_stop"}
            if k in keymap: self.apply_scenario(keymap[k])
            elif k.lower() == "r": self.load_scenarios()

    async def main(self):
        server = await asyncio.start_server(self.handle_client, self.host, self.port)
        await asyncio.gather(server.serve_forever(), self.heartbeat_loop(), self.terminal_input_loop())

if __name__ == "__main__":
    try: asyncio.run(Mini4WDMockServer().main())
    except KeyboardInterrupt: pass
