"""试管缺陷检测包的公共接口。"""

from .config import DetectorConfig
from .detector import TubeDefectDetector, detect_tube

__all__ = ["DetectorConfig", "TubeDefectDetector", "detect_tube"]

