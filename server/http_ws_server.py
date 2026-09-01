"""
HTTP & WebSocket & MJPEG Stream 統合非同期サーバー
実機マイコン (Raspberry Pi 等) でも外部ライブラリ (pip) 不要でそのまま動作
"""
import asyncio
import base64
import hashlib
import json
import os
import struct
from typing import Optional

from .constants import DEFAULT_HOST, DEFAULT_PORT, HEARTBEAT_INTERVAL_SEC
from .controller import VehicleController
from .camera_base import BaseCameraProvider

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
}

class HttpWsServer:
    def __init__(
        self,
        controller: VehicleController,
        camera_provider: Optional[BaseCameraProvider] = None,
        static_dir: Optional[str] = None,
        host: str = DEFAULT_HOST,
        port: int = DEFAULT_PORT,
        heartbeat_interval: float = HEARTBEAT_INTERVAL_SEC
    ):
        self.controller = controller
        self.camera_provider = camera_provider
        self.static_dir = static_dir or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.host = host
        self.port = port
        self.heartbeat_interval = heartbeat_interval
        self.clients = set()
        self._server = None

    def create_ws_frame(self, msg: str) -> bytes:
        data = msg.encode("utf-8")
        n = len(data)
        if n <= 125:
            h = bytes([0x81, n])
        elif n <= 65535:
            h = struct.pack("!BBH", 0x81, 126, n)
        else:
            h = struct.pack("!BBQ", 0x81, 127, n)
        return h + data

    def parse_ws_frame(self, data: bytes):
        if len(data) < 2:
            return None, 0
        opcode = data[0] & 0x0F
        masked = (data[1] & 0x80) != 0
        length = data[1] & 0x7F
        idx = 2
        if length == 126:
            if len(data) < 4:
                return None, 0
            length = struct.unpack("!H", data[2:4])[0]
            idx = 4
        elif length == 127:
            if len(data) < 10:
                return None, 0
            length = struct.unpack("!Q", data[2:10])[0]
            idx = 10

        if masked:
            if len(data) < idx + 4 + length:
                return None, 0
            mask = data[idx : idx + 4]
            raw = data[idx + 4 : idx + 4 + length]
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(raw))
            return (opcode, payload), idx + 4 + length

        if len(data) < idx + length:
            return None, 0
        return (opcode, data[idx : idx + length]), idx + length

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            req = await reader.read(4096)
            if not req:
                writer.close()
                return

            lines = req.decode("utf-8", errors="ignore").split("\r\n")
            parts = lines[0].split(" ") if lines else []
            path = (parts[1] if len(parts) > 1 else "/").split("?")[0]
            headers = {
                k.strip().lower(): v.strip()
                for line in lines[1:]
                if ":" in line
                for k, v in [line.split(":", 1)]
            }

            # 1. WebSocket ハンドシェイク & メッセージ処理
            ws_key = headers.get("sec-websocket-key")
            if ws_key and headers.get("upgrade", "").lower() == "websocket":
                accept = base64.b64encode(hashlib.sha1((ws_key + WS_GUID).encode()).digest()).decode()
                writer.write(
                    f"HTTP/1.1 101 Switching Protocols\r\n"
                    f"Upgrade: websocket\r\n"
                    f"Connection: Upgrade\r\n"
                    f"Sec-WebSocket-Accept: {accept}\r\n\r\n".encode()
                )
                await writer.drain()
                self.clients.add(writer)
                buf = bytearray()
                try:
                    while True:
                        data = await reader.read(4096)
                        if not data:
                            break
                        buf.extend(data)
                        while True:
                            frame, consumed = self.parse_ws_frame(buf)
                            if not frame:
                                break
                            buf = buf[consumed:]
                            op, payload = frame
                            if op == 0x8:  # Close frame
                                return
                            if op == 0x9:  # Ping frame -> Pong返答
                                writer.write(bytes([0x8A, 0x00]))
                                await writer.drain()
                            if op == 0x1:  # Text frame
                                try:
                                    cmd = json.loads(payload.decode("utf-8", errors="ignore"))
                                    self.controller.process_command(cmd)
                                except Exception:
                                    pass
                finally:
                    self.clients.discard(writer)
                    writer.close()
                return

            # 2. カメラ MJPEG ストリーム配信 (/video_feed または /stream)
            if path in ("/video_feed", "/stream"):
                if self.camera_provider is None:
                    writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\nCamera not configured")
                    await writer.drain()
                    writer.close()
                    return

                writer.write(
                    b"HTTP/1.1 200 OK\r\n"
                    b"Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
                    b"Cache-Control: no-cache\r\n"
                    b"Access-Control-Allow-Origin: *\r\n\r\n"
                )
                await writer.drain()
                try:
                    while True:
                        frame = self.camera_provider.get_frame()
                        if frame:
                            ct = "image/png" if frame.startswith(b"\x89PNG") else "image/jpeg"
                            writer.write(
                                f"--frame\r\n"
                                f"Content-Type: {ct}\r\n"
                                f"Content-Length: {len(frame)}\r\n\r\n".encode()
                                + frame
                                + b"\r\n"
                            )
                            await writer.drain()
                        await asyncio.sleep(0.04)  # 約25 FPS
                except Exception:
                    pass
                finally:
                    writer.close()
                return

            # 3. 静的ファイル配信 (HTTP GET)
            rel_path = "index.html" if path in ("", "/") else path.lstrip("/")
            file_path = os.path.normpath(os.path.join(self.static_dir, rel_path))
            if not file_path.startswith(self.static_dir) or not os.path.isfile(file_path):
                writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\n404 Not Found")
            else:
                with open(file_path, "rb") as f:
                    content = f.read()
                ext = os.path.splitext(file_path)[1].lower()
                ct = MIME_TYPES.get(ext, "application/octet-stream")
                writer.write(
                    f"HTTP/1.1 200 OK\r\n"
                    f"Content-Type: {ct}\r\n"
                    f"Content-Length: {len(content)}\r\n\r\n".encode()
                    + content
                )
            await writer.drain()
        except Exception:
            pass
        finally:
            writer.close()

    async def heartbeat_loop(self):
        """定期的にコントローラの状態更新 (tick) と全クライアントへのブロードキャストを実行"""
        interval_ms = int(self.heartbeat_interval * 1000)
        while True:
            self.controller.tick(interval_ms)
            telemetry = self.controller.get_telemetry()
            frame = self.create_ws_frame(json.dumps(telemetry))

            disconnected = set()
            for client in self.clients:
                try:
                    client.write(frame)
                    await client.drain()
                except Exception:
                    disconnected.add(client)
            for d in disconnected:
                self.clients.discard(d)

            await asyncio.sleep(self.heartbeat_interval)

    async def start(self):
        self._server = await asyncio.start_server(self.handle_client, self.host, self.port)
        print(f"Mini 4WD Server running at http://{self.host}:{self.port} (Static Dir: {self.static_dir})")

    async def serve_forever(self):
        if not self._server:
            await self.start()
        await asyncio.gather(self._server.serve_forever(), self.heartbeat_loop())
