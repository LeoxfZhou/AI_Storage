"""图像读写、仿射变换和几何辅助函数。"""

from pathlib import Path
from typing import Iterable, Tuple

import cv2
import numpy as np

from .models import TubePose


def imread_unicode(path: str) -> np.ndarray:
    """兼容中文和空格路径的 OpenCV 读取函数。"""
    file_path = Path(path).expanduser().resolve()
    if not file_path.is_file():
        raise FileNotFoundError(f"图像不存在：{file_path}")
    data = np.fromfile(str(file_path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"无法解码图像（请确认是有效 BMP/JPG/PNG）：{file_path}")
    return image


def imwrite_unicode(path: str, image: np.ndarray) -> str:
    """兼容中文路径的写图函数，并返回绝对路径。"""
    file_path = Path(path).expanduser().resolve()
    file_path.parent.mkdir(parents=True, exist_ok=True)
    suffix = file_path.suffix.lower() or ".jpg"
    ok, encoded = cv2.imencode(suffix, image)
    if not ok:
        raise OSError(f"图像编码失败：{file_path}")
    encoded.tofile(str(file_path))
    return str(file_path)


def polygon_mask(shape: Tuple[int, int], polygon: np.ndarray) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    cv2.fillConvexPoly(mask, np.round(polygon).astype(np.int32), 255)
    return mask


def transform_points(points: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
    return cv2.transform(pts, matrix).reshape(-1, 2)


def invert_affine(matrix: np.ndarray) -> np.ndarray:
    return cv2.invertAffineTransform(matrix.astype(np.float64)).astype(np.float32)


def compose_affine(after: np.ndarray, before: np.ndarray) -> np.ndarray:
    """返回 after(before(x)) 对应的 2x3 仿射矩阵。"""
    a = np.vstack([after, [0.0, 0.0, 1.0]])
    b = np.vstack([before, [0.0, 0.0, 1.0]])
    return (a @ b)[:2].astype(np.float32)


def pose_polygon(center: Tuple[float, float], angle: float, length: float, width: float) -> np.ndarray:
    """按主轴角度构建最小外接矩形四个顶点。"""
    rect = (tuple(center), (float(length), float(width)), float(np.degrees(angle)))
    return cv2.boxPoints(rect).astype(np.float32)


def pose_to_pose_affine(source: TubePose, target: TubePose) -> np.ndarray:
    """构造把 source 的中心、方向和长度映射到 target 的相似变换。"""
    scale = target.length / max(source.length, 1.0)
    delta = target.angle - source.angle
    c, s = np.cos(delta) * scale, np.sin(delta) * scale
    rotation = np.array([[c, -s], [s, c]], dtype=np.float32)
    src_center = np.asarray(source.center, dtype=np.float32)
    dst_center = np.asarray(target.center, dtype=np.float32)
    translation = dst_center - rotation @ src_center
    return np.column_stack([rotation, translation]).astype(np.float32)


def clipped_bbox(points: np.ndarray, image_shape: Tuple[int, int]) -> Tuple[int, int, int, int]:
    """由点集得到 [x,y,w,h]，并裁剪到图像范围。"""
    height, width = image_shape[:2]
    x, y, w, h = cv2.boundingRect(np.round(points).astype(np.int32))
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(width, x + w), min(height, y + h)
    return x1, y1, max(0, x2 - x1), max(0, y2 - y1)

