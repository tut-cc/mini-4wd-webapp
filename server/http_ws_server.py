"""
互換性維持のためのエイリアスモジュール
（server.http_server への移行を推奨）
"""
from .http_server import HttpServer, HttpWsServer, CameraProvider, MIME_TYPES

__all__ = ["HttpServer", "HttpWsServer", "CameraProvider", "MIME_TYPES"]
