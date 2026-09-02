"""
HTTP / WebSocket / MJPEG 統合非同期サーバー
外部ライブラリ (pip) 不要・標準ライブラリのみで軽量動作
"""
import asyncio
import base64
import hashlib
import json
import os
import struct
from typing import Optional, Protocol

from .constants import DEFAULT_HOST, DEFAULT_PORT, HEARTBEAT_INTERVAL_SEC
from .controller import VehicleController

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

class CameraProvider(Protocol):
    def get_frame(self) -> bytes: ...

def encode_ws_frame(msg: str) -> bytes:
    """テキストメッセージを WebSocket 送信フレーム (Opcode 0x1) に変換"""
    data = msg.encode("utf-8")
    length = len(data)
    if length <= 125:
        header = bytes([0x81, length])
    elif length <= 65535:
        header = struct.pack("!BBH", 0x81, 126, length)
    else:
        header = struct.pack("!BBQ", 0x81, 127, length)
    return header + data

def decode_ws_frame(data: bytes):
    """
    受信バイナリから WebSocket フレームを解析
    :return: ((opcode, payload), consumed_bytes) または (None, 0)
    """
    if len(data) < 2:
        return None, 0
    opcode = data[0] & 0x0F
    masked = bool(data[1] & 0x80)
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

class HttpWsServer:
    def __init__(
        self,
        controller: VehicleController,
        camera_provider: Optional[CameraProvider] = None,
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

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """HTTPリクエスト受付およびプロトコル分岐 (WebSocket / MJPEG / 静的配信)"""
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

            # 1. WebSocket 制御通信
            if headers.get("upgrade", "").lower() == "websocket" and "sec-websocket-key" in headers:
                await self._handle_websocket(reader, writer, headers["sec-websocket-key"])
                return

            # 2. カメラ MJPEG ストリーミング
            if path in ("/video_feed", "/stream"):
                await self._handle_mjpeg_stream(writer)
                return

            # 3. 静的ファイル配信 (index.html, JS, CSS)
            await self._handle_static_file(writer, path)

        except Exception:
            pass
        finally:
            writer.close()

    async def _handle_websocket(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, ws_key: str):
        """WebSocket ハンドシェイクおよびメッセージ受信ループ"""
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
                chunk = await reader.read(4096)
                if not chunk:
                    break
                buf.extend(chunk)

                while True:
                    frame, consumed = decode_ws_frame(buf)
                    if not frame:
                        break
                    buf = buf[consumed:]
                    opcode, payload = frame

                    if opcode == 0x8:  # Close
                        return
                    elif opcode == 0x9:  # Ping -> Pong
                        writer.write(bytes([0x8A, 0x00]))
                        await writer.drain()
                    elif opcode == 0x1:  # Text
                        try:
                            cmd = json.loads(payload.decode("utf-8", errors="ignore"))
                            self.controller.process_command(cmd)
                        except Exception:
                            pass
        finally:
            self.clients.discard(writer)

    async def _handle_mjpeg_stream(self, writer: asyncio.StreamWriter):
        """MJPEG カメラストリーム配信 (/video_feed)"""
        if not self.camera_provider:
            writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\nCamera not configured")
            await writer.drain()
            return

        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
            b"Cache-Control: no-cache\r\n"
            b"Access-Control-Allow-Origin: *\r\n\r\n"
        )
        await writer.drain()

        while True:
            frame = self.camera_provider.get_frame()
            if frame:
                content_type = "image/png" if frame.startswith(b"\x89PNG") else "image/jpeg"
                writer.write(
                    f"--frame\r\n"
                    f"Content-Type: {content_type}\r\n"
                    f"Content-Length: {len(frame)}\r\n\r\n".encode()
                    + frame
                    + b"\r\n"
                )
                await writer.drain()
            await asyncio.sleep(0.04)  # ~25 FPS

    async def _handle_static_file(self, writer: asyncio.StreamWriter, path: str):
        """静的Webアセット配信"""
        rel_path = "index.html" if path in ("", "/") else path.lstrip("/")
        file_path = os.path.normpath(os.path.join(self.static_dir, rel_path))

        if not file_path.startswith(self.static_dir) or not os.path.isfile(file_path):
            writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\n404 Not Found")
        else:
            with open(file_path, "rb") as f:
                content = f.read()
            ext = os.path.splitext(file_path)[1].lower()
            content_type = MIME_TYPES.get(ext, "application/octet-stream")
            writer.write(
                f"HTTP/1.1 200 OK\r\n"
                f"Content-Type: {content_type}\r\n"
                f"Content-Length: {len(content)}\r\n\r\n".encode()
                + content
            )
        await writer.drain()

    async def heartbeat_loop(self):
        """定期周期更新 & 全WebSocketクライアントへの最新テレメトリ一括送信 (100ms周期)"""
        interval_ms = int(self.heartbeat_interval * 1000)
        while True:
            self.controller.tick(interval_ms)
            telemetry = self.controller.get_telemetry()
            frame = encode_ws_frame(json.dumps(telemetry))

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

    async def serve_forever(self):
        """サーバーの起動と並行実行"""
        self._server = await asyncio.start_server(self.handle_client, self.host, self.port)
        print(f"Mini 4WD Server running at http://{self.host}:{self.port}")
        await asyncio.gather(self._server.serve_forever(), self.heartbeat_loop())
