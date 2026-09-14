import asyncio
import http.client
import json
import unittest

from server.controller import VehicleController
from server.http_server import HttpServer


class TestHttpServerPolling(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.controller = VehicleController()
        self.server = HttpServer(self.controller, port=18765)
        self.srv_task = asyncio.create_task(self.server.serve_forever())
        await asyncio.sleep(0.05)

    async def asyncTearDown(self):
        self.srv_task.cancel()
        try:
            await self.srv_task
        except asyncio.CancelledError:
            pass
        await self.server.close()

    async def test_keep_alive_polling(self):
        def run_polling():
            conn = http.client.HTTPConnection("127.0.0.1", 18765, timeout=3)
            for i in range(10):
                payload = json.dumps({
                    "client_mode": "MANUAL",
                    "throttle": 0.5,
                    "steering": 0.2
                }).encode("utf-8")
                conn.request("POST", "/api/command", body=payload, headers={"Content-Type": "application/json"})
                res = conn.getresponse()
                self.assertEqual(res.status, 200)
                data = json.loads(res.read().decode("utf-8"))
                self.assertEqual(data["mode"], "MANUAL")
            conn.close()

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, run_polling)

    async def test_static_and_options(self):
        def run_static():
            conn = http.client.HTTPConnection("127.0.0.1", 18765, timeout=3)

            # GET index.html
            conn.request("GET", "/")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            body = res.read().decode("utf-8")
            self.assertIn("<!DOCTYPE html>", body)

            # OPTIONS preflight
            conn.request("OPTIONS", "/api/command")
            res = conn.getresponse()
            self.assertEqual(res.status, 204)
            res.read()

            # GET /api/telemetry
            conn.request("GET", "/api/telemetry")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertIn("mode", data)

            conn.close()

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, run_static)

    async def test_comm_timeout(self):
        # Initial state is MANUAL before any command received
        self.assertEqual(self.controller.state["mode"], "MANUAL")
        await asyncio.sleep(0.2)
        self.assertEqual(self.controller.state["mode"], "MANUAL")

        def send_first_cmd():
            conn = http.client.HTTPConnection("127.0.0.1", 18765, timeout=3)
            conn.request("POST", "/api/command", body=b"{}", headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            res.read()
            conn.close()

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, send_first_cmd)

        # After > 1.5s of silence, COMM_TIMEOUT should trigger AUTO_ABORT
        await asyncio.sleep(1.6)
        self.assertEqual(self.controller.state["mode"], "AUTO_ABORT")
        self.assertEqual(self.controller.state["stop_reason"], "COMM_TIMEOUT")

    async def test_command_mode_switch(self):
        def run_mode_switch():
            conn = http.client.HTTPConnection("127.0.0.1", 18765, timeout=3)
            # Switch to AUTO
            payload = json.dumps({
                "client_mode": "MANUAL",
                "mode_request": "AUTO",
                "throttle": 0.0,
                "steering": 0.0
            }).encode("utf-8")
            conn.request("POST", "/api/command", body=payload, headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertEqual(data["mode"], "AUTO")

            # Abort request
            abort_payload = json.dumps({
                "client_mode": "AUTO",
                "manual_abort_request": True
            }).encode("utf-8")
            conn.request("POST", "/api/command", body=abort_payload, headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertEqual(data["mode"], "MANUAL_ABORT")
            conn.close()

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, run_mode_switch)


if __name__ == "__main__":
    unittest.main()
