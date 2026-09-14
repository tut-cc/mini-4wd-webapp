"""
HTTP 統合非同期サーバー (標準ライブラリのみ)
REST API (/api/command, /api/telemetry) + MJPEGストリーミング + 静的アセット配信
"""
import asyncio
import json
import os
from typing import Optional, Protocol

from .constants import DEFAULT_HOST, DEFAULT_PORT, HEARTBEAT_INTERVAL_SEC
from .controller import VehicleController

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

class HttpServer:
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
        self._server = None

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """HTTPリクエスト受付 (API / MJPEG / 静的配信)"""
        try:
            req_data = await reader.read(4096)
            if not req_data:
                writer.close()
                return

            header_part, _, body_part = req_data.partition(b"\r\n\r\n")
            lines = header_part.decode("utf-8", errors="ignore").split("\r\n")
            parts = lines[0].split(" ") if lines else []
            method = parts[0].upper() if parts else "GET"
            path = (parts[1] if len(parts) > 1 else "/").split("?")[0]
            headers = {
                k.strip().lower(): v.strip()
                for line in lines[1:]
                if ":" in line
                for k, v in [line.split(":", 1)]
            }

            # CORS プリフライト対応
            if method == "OPTIONS":
                writer.write(
                    b"HTTP/1.1 204 No Content\r\n"
                    b"Access-Control-Allow-Origin: *\r\n"
                    b"Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                    b"Access-Control-Allow-Headers: Content-Type\r\n\r\n"
                )
                await writer.drain()
                return

            # 1. 制御API: コマンド受信 & 最新テレメトリ返却 (/api/command)
            if path == "/api/command":
                content_length = int(headers.get("content-length", 0))
                body = body_part
                if len(body) < content_length:
                    body += await reader.readexactly(content_length - len(body))

                if method == "POST" and body:
                    try:
                        cmd = json.loads(body.decode("utf-8", errors="ignore"))
                        self.controller.process_command(cmd)
                    except Exception:
                        pass

                # 最新テレメトリをレスポンスとして返却
                telemetry = self.controller.get_telemetry()
                resp_bytes = json.dumps(telemetry).encode("utf-8")
                header = (
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: application/json; charset=utf-8\r\n"
                    "Access-Control-Allow-Origin: *\r\n"
                    f"Content-Length: {len(resp_bytes)}\r\n\r\n"
                ).encode("utf-8")
                writer.write(header + resp_bytes)
                await writer.drain()
                return

            # 2. テレメトリ単体取得API (/api/telemetry)
            if path == "/api/telemetry":
                telemetry = self.controller.get_telemetry()
                resp_bytes = json.dumps(telemetry).encode("utf-8")
                header = (
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: application/json; charset=utf-8\r\n"
                    "Access-Control-Allow-Origin: *\r\n"
                    f"Content-Length: {len(resp_bytes)}\r\n\r\n"
                ).encode("utf-8")
                writer.write(header + resp_bytes)
                await writer.drain()
                return

            # 3. カメラ MJPEG ストリーミング (/video_feed, /stream)
            if path in ("/video_feed", "/stream"):
                await self._handle_mjpeg_stream(writer)
                return

            # 4. 静的Webアセット配信 (index.html, JS, CSS)
            await self._handle_static_file(writer, path)

        except Exception:
            pass
        finally:
            try:
                writer.close()
            except Exception:
                pass

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

    async def tick_loop(self):
        """定期周期更新 (TORカウントダウン・通信途絶監視・デッドマンタイマー / 100ms周期)"""
        interval_ms = int(self.heartbeat_interval * 1000)
        while True:
            self.controller.tick(interval_ms)
            await asyncio.sleep(self.heartbeat_interval)

    async def serve_forever(self):
        """サーバーの起動と並行実行"""
        self._server = await asyncio.start_server(self.handle_client, self.host, self.port)
        print(f"Mini 4WD Server running at http://{self.host}:{self.port}")
        await asyncio.gather(self._server.serve_forever(), self.tick_loop())

# 既存コードとの互換性用エイリアス
HttpWsServer = HttpServer
