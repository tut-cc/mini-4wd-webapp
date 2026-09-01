"""
カメラ映像プロバイダの基底クラス
実機 (OpenCV/Picamera2/V4L2等) およびモック (擬似描画) の共通インターフェース
"""
from abc import ABC, abstractmethod

class BaseCameraProvider(ABC):
    @abstractmethod
    def get_frame(self) -> bytes:
        """
        最新の画像フレーム (JPEG または PNG バイナリ) を返す。
        MJPEG ストリーミング (/video_feed) で利用される。
        フレームがない場合は b"" または None を返す。
        """
        pass
