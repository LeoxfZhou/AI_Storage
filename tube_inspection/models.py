"""检测过程使用的数据结构。"""

from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np


@dataclass
class TubePose:
    """试管的主轴姿态，角度是主轴相对 x 轴的弧度。"""

    center: Tuple[float, float]
    angle: float
    length: float
    width: float
    polygon: np.ndarray


@dataclass
class CandidateFeature:
    """一个差分连通域的形态、亮度和颜色特征。"""

    contour: np.ndarray
    polygon: np.ndarray
    bbox: Tuple[int, int, int, int]
    area_px: float
    area_ratio: float
    length_px: float
    width_px: float
    aspect: float
    solidity: float
    mean_difference: float
    max_difference: float
    mean_darkness: float
    color_delta: float
    chroma_delta: float
    gradient_coherence: float

    def public_values(self) -> Dict[str, float]:
        """转换为适合 JSON/报告输出的数值。"""
        return {
            "area_px": round(self.area_px, 2),
            "area_ratio": round(self.area_ratio, 6),
            "length_px": round(self.length_px, 2),
            "width_px": round(self.width_px, 2),
            "aspect": round(self.aspect, 3),
            "solidity": round(self.solidity, 3),
            "mean_difference": round(self.mean_difference, 2),
            "max_difference": round(self.max_difference, 2),
            "mean_darkness": round(self.mean_darkness, 2),
            "color_delta": round(self.color_delta, 2),
            "chroma_delta": round(self.chroma_delta, 2),
            "gradient_coherence": round(self.gradient_coherence, 3),
        }


@dataclass
class DiagnosticResult:
    """一次检测的结构化结果。

    英文缺陷代码便于程序判断，中文名称和位置描述则便于人直接阅读。二者都保留，
    可以避免调用方为了显示中文而再次维护一份容易不一致的映射表。
    """

    defect_type: str
    defect_type_cn: str
    location_bbox: List[int]
    location_description: str
    feature_description: str
    feature_values: Dict[str, float] = field(default_factory=dict)
    alignment_score: float = 0.0
    visualization_path: Optional[str] = None

    def to_dict(self) -> Dict[str, object]:
        result = asdict(self)
        result["alignment_score"] = round(float(self.alignment_score), 4)
        if self.visualization_path is None:
            result.pop("visualization_path")
        return result
