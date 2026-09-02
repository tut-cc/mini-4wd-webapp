#!/usr/bin/env python3
"""
【実機用実装テンプレート】
Raspberry Pi などの車載SBC/マイコンで WebApp サーバーを動作させる際のサンプルコード。

共通の `server/` パッケージを利用し、実機のモータードライバ (PWM) や
実機カメラ (Picamera2 / OpenCV 等)、実機センサー (ToF / 超音波) を接続します。
"""
import asyncio
import os

from server import (
    VehicleController,
    HttpWsServer,
    BaseCameraProvider,
)

# ----------------------------------------------------
# 1. 実機カメラプロバイダの実装例
# ----------------------------------------------------
class RealCameraProvider(BaseCameraProvider):
    def __init__(self):
        # 例: OpenCV や Picamera2 などを初期化
        # import cv2
        # self.cap = cv2.VideoCapture(0)
        self.latest_frame = b""

    def get_frame(self) -> bytes:
        # 例: カメラから最新フレームを取得して JPEG バイト列を返す
        # ret, frame = self.cap.read()
        # if ret:
        #     _, jpeg = cv2.imencode('.jpg', frame)
        #     return jpeg.tobytes()
        return self.latest_frame


# ----------------------------------------------------
# 2. 実機ハードウェア (モーター / サーボ / センサー) の接続例
# ----------------------------------------------------
def on_motor_update(throttle: float, steering: float):
    """
    WebAppからの操作や自律走行コアからの出力指示 (throttle, steering) を
    実機のGPIO (PWMドライバ IC や サーボ) に反映するコールバック。
    """
    # 例: PCA9685 や pigpio / RPi.GPIO 等でPWM出力
    # print(f"[Hardware PWM] Throttle: {throttle:.2f}, Steering: {steering:.2f}")
    pass


async def sensor_polling_loop(controller: VehicleController):
    """
    実機の前方測距センサー (ToF VL53L0X, HC-SR04超音波等) から
    定期的に距離を読み取り、controller に通知するタスク。
    """
    while True:
        # 例: sensor_distance = tof.read_distance_mm()
        # controller.update_sensor(sensor_distance)
        await asyncio.sleep(0.05)  # 20 Hz でセンシング


# ----------------------------------------------------
# 3. メインエントリポイント
# ----------------------------------------------------
async def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # コントローラ初期化 (モーター更新コールバックを登録)
    controller = VehicleController(on_motor_update=on_motor_update)

    # 実機カメラ初期化
    camera = RealCameraProvider()

    # サーバー初期化
    server = HttpWsServer(
        controller=controller,
        camera_provider=camera,
        static_dir=base_dir,
        host="0.0.0.0",
        port=8765
    )

    print("==================================================")
    print("  Mini 4WD Real Server (Hardware Mode) Started")
    print(f"  Web UI : http://localhost:8765")
    print("==================================================")

    # サーバーとセンサー監視ループを並行実行
    await asyncio.gather(
        server.serve_forever(),
        sensor_polling_loop(controller),
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nReal server stopped.")
