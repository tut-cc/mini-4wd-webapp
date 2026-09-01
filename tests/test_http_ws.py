"""
HttpWsServer 統合テスト (HTTPリクエスト & WebSocketフレーム処理)
"""
import unittest
import asyncio

from server.controller import VehicleController
from server.http_ws_server import HttpWsServer
from mock.camera import MockCameraProvider

class TestHttpWsServer(unittest.IsolatedAsyncioTestCase):
    async def test_http_static_and_ws(self):
        controller = VehicleController()
        camera = MockCameraProvider(controller)
        server = HttpWsServer(
            controller=controller,
            camera_provider=camera,
            host="127.0.0.1",
            port=18765
        )
        await server.start()
        loop_task = asyncio.create_task(server.serve_forever())
        await asyncio.sleep(0.05)

        try:
            # 1. HTTP GET / テスト (index.html)
            reader, writer = await asyncio.open_connection("127.0.0.1", 18765)
            writer.write(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            await writer.drain()
            resp = await reader.read(4096)
            writer.close()
            await writer.wait_closed()
            self.assertIn(b"HTTP/1.1 200 OK", resp)
            self.assertIn(b"<!DOCTYPE html>", resp)

            # 2. HTTP GET 404 テスト
            reader, writer = await asyncio.open_connection("127.0.0.1", 18765)
            writer.write(b"GET /not_exist.file HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            await writer.drain()
            resp = await reader.read(4096)
            writer.close()
            await writer.wait_closed()
            self.assertIn(b"HTTP/1.1 404 Not Found", resp)

            # 3. WebSocket ハンドシェイク & コマンド送信テスト
            reader, writer = await asyncio.open_connection("127.0.0.1", 18765)
            ws_handshake = (
                b"GET / HTTP/1.1\r\n"
                b"Host: 127.0.0.1\r\n"
                b"Upgrade: websocket\r\n"
                b"Connection: Upgrade\r\n"
                b"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                b"Sec-WebSocket-Version: 13\r\n\r\n"
            )
            writer.write(ws_handshake)
            await writer.drain()
            resp = await reader.read(1024)
            self.assertIn(b"101 Switching Protocols", resp)
            self.assertIn(b"Sec-WebSocket-Accept:", resp)

            # WebSocketで非常停止コマンドを送信
            cmd_json = '{"emergency_stop_request": true}'
            ws_frame = server.create_ws_frame(cmd_json)
            # クライアントフレームなのでマスクを適用
            masked_frame = bytearray([0x81, 0x80 | len(cmd_json.encode('utf-8')), 0x00, 0x00, 0x00, 0x00]) + cmd_json.encode('utf-8')
            writer.write(masked_frame)
            await writer.drain()

            await asyncio.sleep(0.05)
            self.assertEqual(controller.state["mode"], "EMERGENCY_STOP")

            writer.close()
            await writer.wait_closed()

        finally:
            loop_task.cancel()
            try:
                await loop_task
            except asyncio.CancelledError:
                pass

if __name__ == "__main__":
    unittest.main()
