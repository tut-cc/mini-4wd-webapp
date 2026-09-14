"""
HTTP 統合非同期サーバー (標準ライブラリのみ)
REST API (/api/command, /api/telemetry) + MJPEGストリーミング + 静的アセット配信
HTTP/1.1 Keep-Alive (永続接続) による高頻度ポーリング対応
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
        heartbeat_interval: float = HEARTBEAT_INTERVAL_SEC,
        keepalive_timeout: float = 10.0,
    ):
        self.controller = controller
        self.camera_provider = camera_provider
        self.static_dir = static_dir or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.host = host
        self.port = port
        self.heartbeat_interval = heartbeat_interval
        self.keepalive_timeout = keepalive_timeout
        self._server = None

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """HTTPリクエスト受付 (API / MJPEG / 静的配信 / Keep-Alive対応)"""
        buffer = bytearray()
        try:
            while True:
                # 1. ヘッダー終端 (b"\r\n\r\n") まで受信
                while b"\r\n\r\n" not in buffer:
                    if len(buffer) > 65536:
                        return
                    try:
                        chunk = await asyncio.wait_for(reader.read(4096), timeout=self.keepalive_timeout)
                    except asyncio.TimeoutError:
                        return
                    if not chunk:
                        return
                    buffer.extend(chunk)

                header_part, _, rest = buffer.partition(b"\r\n\r\n")
                lines = header_part.decode("utf-8", errors="ignore").split("\r\n")
                parts = lines[0].split(" ") if lines else []
                method = parts[0].upper() if parts else "GET"
                path = (parts[1] if len(parts) > 1 else "/").split("?")[0]
                version = parts[2].upper() if len(parts) > 2 else "HTTP/1.1"

                headers = {}
                for line in lines[1:]:
                    if ":" in line:
                        k, v = line.split(":", 1)
                        headers[k.strip().lower()] = v.strip()

                # Keep-Alive 判定 (HTTP/1.1 はデフォルト Keep-Alive、HTTP/1.0 はデフォルト Close)
                conn_header = headers.get("connection", "").lower()
                if conn_header == "close":
                    keep_alive = False
                elif conn_header == "keep-alive":
                    keep_alive = True
                else:
                    keep_alive = (version != "HTTP/1.0")

                # Expect: 100-continue 対応
                if headers.get("expect", "").lower() == "100-continue":
                    writer.write(b"HTTP/1.1 100 Continue\r\n\r\n")
                    await writer.drain()

                # 2. ボディの読み込み (Content-Length に応じて)
                try:
                    content_length = max(0, int(headers.get("content-length", 0)))
                except (ValueError, TypeError):
                    content_length = 0

                if content_length > 10 * 1024 * 1024:
                    return

                while len(rest) < content_length:
                    try:
                        chunk = await asyncio.wait_for(
                            reader.read(min(65536, content_length - len(rest))),
                            timeout=self.keepalive_timeout
                        )
                    except asyncio.TimeoutError:
                        return
                    if not chunk:
                        return
                    rest.extend(chunk)

                body = bytes(rest[:content_length])
                buffer = bytearray(rest[content_length:])

                conn_header_str = "Connection: keep-alive\r\nKeep-Alive: timeout=10\r\n" if keep_alive else "Connection: close\r\n"

                # CORS プリフライト対応
                if method == "OPTIONS":
                    writer.write(
                        b"HTTP/1.1 204 No Content\r\n"
                        b"Access-Control-Allow-Origin: *\r\n"
                        b"Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                        b"Access-Control-Allow-Headers: Content-Type\r\n"
                        + conn_header_str.encode("utf-8")
                        + b"\r\n"
                    )
                    await writer.drain()
                    if not keep_alive:
                        return
                    continue

                # 1. 制御API: コマンド受信 & 最新テレメトリ返却 (/api/command)
                if path == "/api/command":
                    if method == "POST":
                        if body:
                            try:
                                cmd = json.loads(body.decode("utf-8", errors="ignore"))
                                self.controller.process_command(cmd)
                            except Exception:
                                self.controller.process_command({})
                        else:
                            self.controller.process_command({})

                    telemetry = self.controller.get_telemetry()
                    resp_bytes = json.dumps(telemetry).encode("utf-8")
                    header = (
                        "HTTP/1.1 200 OK\r\n"
                        "Content-Type: application/json; charset=utf-8\r\n"
                        "Access-Control-Allow-Origin: *\r\n"
                        "Cache-Control: no-cache, no-store, must-revalidate\r\n"
                        f"{conn_header_str}"
                        f"Content-Length: {len(resp_bytes)}\r\n\r\n"
                    ).encode("utf-8")
                    writer.write(header + resp_bytes)
                    await writer.drain()
                    if not keep_alive:
                        return
                    continue

                # 2. テレメトリ単体取得API (/api/telemetry)
                if path == "/api/telemetry":
                    telemetry = self.controller.get_telemetry()
                    resp_bytes = json.dumps(telemetry).encode("utf-8")
                    header = (
                        "HTTP/1.1 200 OK\r\n"
                        "Content-Type: application/json; charset=utf-8\r\n"
                        "Access-Control-Allow-Origin: *\r\n"
                        "Cache-Control: no-cache, no-store, must-revalidate\r\n"
                        f"{conn_header_str}"
                        f"Content-Length: {len(resp_bytes)}\r\n\r\n"
                    ).encode("utf-8")
                    writer.write(header + resp_bytes)
                    await writer.drain()
                    if not keep_alive:
                        return
                    continue

                # 3. カメラ MJPEG ストリーミング (/video_feed, /stream)
                if path in ("/video_feed", "/stream"):
                    await self._handle_mjpeg_stream(writer)
                    return

                # 4. 静的Webアセット配信 (index.html, JS, CSS)
                await self._handle_static_file(writer, path, conn_header_str)
                if not keep_alive:
                    return
                continue

        except Exception:
            pass
        finally:
            try:
                writer.close()
                await asyncio.wait_for(writer.wait_closed(), timeout=2.0)
            except Exception:
                pass

    async def _handle_mjpeg_stream(self, writer: asyncio.StreamWriter):
        """MJPEG カメラストリーム配信 (/video_feed)"""
        if not self.camera_provider:
            body = b"Camera not configured"
            header = (
                "HTTP/1.1 404 Not Found\r\n"
                "Content-Type: text/plain; charset=utf-8\r\n"
                "Connection: close\r\n"
                f"Content-Length: {len(body)}\r\n\r\n"
            ).encode("utf-8")
            writer.write(header + body)
            await writer.drain()
            return

        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
            b"Cache-Control: no-cache, no-store, must-revalidate\r\n"
            b"Pragma: no-cache\r\n"
            b"Connection: close\r\n"
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
                    f"Content-Length: {len(frame)}\r\n\r\n".encode("utf-8")
                    + frame
                    + b"\r\n"
                )
                await writer.drain()
            await asyncio.sleep(0.04)  # ~25 FPS

    async def _handle_static_file(self, writer: asyncio.StreamWriter, path: str, conn_header_str: str = "Connection: keep-alive\r\n"):
        """静的Webアセット配信"""
        rel_path = "index.html" if path in ("", "/") else path.lstrip("/")
        file_path = os.path.normpath(os.path.join(self.static_dir, rel_path))

        if not file_path.startswith(self.static_dir) or not os.path.isfile(file_path):
            body = b"404 Not Found"
            header = (
                "HTTP/1.1 404 Not Found\r\n"
                "Content-Type: text/plain; charset=utf-8\r\n"
                f"{conn_header_str}"
                f"Content-Length: {len(body)}\r\n\r\n"
            ).encode("utf-8")
            writer.write(header + body)
        else:
            with open(file_path, "rb") as f:
                content = f.read()
            ext = os.path.splitext(file_path)[1].lower()
            content_type = MIME_TYPES.get(ext, "application/octet-stream")
            header = (
                "HTTP/1.1 200 OK\r\n"
                f"Content-Type: {content_type}\r\n"
                "Access-Control-Allow-Origin: *\r\n"
                "Cache-Control: no-cache, must-revalidate\r\n"
                f"{conn_header_str}"
                f"Content-Length: {len(content)}\r\n\r\n"
            ).encode("utf-8")
            writer.write(header + content)
        await writer.drain()

    async def tick_loop(self):
        """定期周期更新 (TORカウントダウン・通信途絶監視・デッドマンタイマー / 100ms周期)"""
        interval_ms = int(self.heartbeat_interval * 1000)
        while True:
            self.controller.tick(interval_ms)
            await asyncio.sleep(self.heartbeat_interval)

    async def close(self):
        """サーバーの停止"""
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def serve_forever(self):
        """サーバーの起動と並行実行"""
        bind_host = None if self.host in ("0.0.0.0", "", None) else self.host
        try:
            self._server = await asyncio.start_server(self.handle_client, host=bind_host, port=self.port)
        except Exception:
            self._server = await asyncio.start_server(self.handle_client, host=self.host, port=self.port)

        display_host = "localhost" if self.host in ("0.0.0.0", "", None) else self.host
        print(f"Mini 4WD Server running at http://{display_host}:{self.port}")
        try:
            await asyncio.gather(self._server.serve_forever(), self.tick_loop())
        finally:
            await self.close()

# 既存コードとの互換性用エイリアス
HttpWsServer = HttpServer
