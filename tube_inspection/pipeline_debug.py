"""缺陷检测过程图导出工具。

这个模块只负责“记录和组织调试信息”，不参与缺陷判定。检测器在关键 OpenCV 算子
执行后把中间图交给 :class:`PipelineDebugRecorder`；批量导出函数再自动选择四类样本，
并生成便于工程调参和教学阅读的步骤说明。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping

import cv2
import numpy as np

from .geometry import imwrite_unicode


DEBUG_DEFECTS: Mapping[str, tuple[str, str]] = {
    "BENDING": ("bending", "弯曲 Bending"),
    "DARK_SPOT": ("dark_spot", "暗斑 Dark Spot"),
    "SCRATCH": ("scratch", "划痕 Scratch"),
    "INCLUSION": ("inclusion", "杂质 Inclusion"),
}


@dataclass
class DebugStep:
    """一张中间图以及它在说明文档中的解释。"""

    step_number: int
    operator_name: str
    filename: str
    description: str


@dataclass
class PipelineDebugRecorder:
    """为一个缺陷样本按固定命名规则保存中间图。"""

    output_directory: Path
    defect_type: str
    source_path: str
    steps: List[DebugStep] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.defect_type not in DEBUG_DEFECTS:
            raise ValueError(f"不支持的调试类别：{self.defect_type}")
        self.output_directory = Path(self.output_directory).expanduser().resolve()
        self.output_directory.mkdir(parents=True, exist_ok=True)

    @property
    def slug(self) -> str:
        """返回适合文件名的英文类别，例如 ``dark_spot``。"""
        return DEBUG_DEFECTS[self.defect_type][0]

    def save(
        self,
        step_number: int,
        operator_name: str,
        image: np.ndarray,
        description: str,
    ) -> str:
        """保存一张 PNG，并记录它对应的算子和技术目的。

        二值布尔图先转换成 0/255。浮点响应图会线性归一化到 8 位，避免直接编码时
        全黑；原始 uint8 图保持数值不变，便于调参时观察真实阈值响应。
        """
        if image is None or image.size == 0:
            raise ValueError(f"步骤 {step_number} 的调试图为空")
        prepared = np.asarray(image)
        if prepared.dtype == np.bool_:
            prepared = prepared.astype(np.uint8) * 255
        elif prepared.dtype != np.uint8:
            prepared = cv2.normalize(
                prepared, None, 0, 255, cv2.NORM_MINMAX
            ).astype(np.uint8)

        filename = f"{self.slug}_step{step_number:02d}_{operator_name}.png"
        saved_path = imwrite_unicode(str(self.output_directory / filename), prepared)

        # 同一步在检测重试时可能再次提交；用“步骤号+名称”去重，确保说明文档稳定。
        self.steps = [
            step
            for step in self.steps
            if not (
                step.step_number == step_number
                and step.operator_name == operator_name
            )
        ]
        self.steps.append(
            DebugStep(step_number, operator_name, filename, description)
        )
        self.steps.sort(key=lambda step: (step.step_number, step.operator_name))
        return saved_path

    @staticmethod
    def hsv_channel_panel(hsv: np.ndarray) -> np.ndarray:
        """把不可直接观看的 HSV 数组转换成 H/S/V 三通道灰度对照图。"""
        hue, saturation, value = cv2.split(hsv)
        # OpenCV 色相范围是 0~179，放大到 0~255 后更容易观察细微色相变化。
        hue_view = cv2.convertScaleAbs(hue, alpha=255.0 / 179.0)
        panels = []
        for label, channel in (("HUE", hue_view), ("SATURATION", saturation), ("VALUE", value)):
            panel = cv2.cvtColor(channel, cv2.COLOR_GRAY2BGR)
            cv2.rectangle(panel, (0, 0), (260, 42), (0, 0, 0), -1)
            cv2.putText(
                panel,
                label,
                (12, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 255),
                2,
                cv2.LINE_AA,
            )
            panels.append(panel)
        return np.hstack(panels)

    @staticmethod
    def response_heatmap(response: np.ndarray) -> np.ndarray:
        """将单通道顶帽/底帽响应转换成伪彩色热力图。"""
        normalized = cv2.normalize(response, None, 0, 255, cv2.NORM_MINMAX)
        return cv2.applyColorMap(normalized.astype(np.uint8), cv2.COLORMAP_TURBO)


def _write_pipeline_explanation(
    output_directory: Path,
    recorders: Mapping[str, PipelineDebugRecorder],
    results: Mapping[str, Dict[str, object]],
) -> str:
    """根据实际保存成功的步骤生成过程说明文档。"""
    lines = [
        "试管缺陷检测：过程可视化与工程调优说明",
        "========================================",
        "",
        "本目录由程序自动生成。每一类选取数据集中第一张被当前算法稳定识别的典型单缺陷图片。",
        "中间图使用工作分辨率；final_bbox 使用原图分辨率和原图坐标。",
        "",
        "文件命名：缺陷类型_step步骤号_算子或方法名称.png",
        "",
    ]

    for defect_type in DEBUG_DEFECTS:
        recorder = recorders[defect_type]
        result = results[defect_type]
        _slug, display_name = DEBUG_DEFECTS[defect_type]
        lines.extend(
            [
                f"{display_name}",
                "-" * len(display_name),
                f"输入图片：{Path(recorder.source_path).resolve()}",
                f"最终类别：{result['defect_type_cn']} ({result['defect_type']})",
                f"原图缺陷框：{result['location_bbox']}，格式为 [x, y, width, height]",
                f"特征说明：{result['feature_description']}",
                "",
            ]
        )
        for step in recorder.steps:
            lines.extend(
                [
                    f"步骤 {step.step_number:02d}：{step.filename}",
                    f"算子/方法：{step.operator_name}",
                    f"底层逻辑与目的：{step.description}",
                    "",
                ]
            )

    explanation_path = output_directory / "pipeline_explanation.txt"
    explanation_path.write_text("\n".join(lines), encoding="utf-8")
    return str(explanation_path.resolve())


def export_typical_pipelines(
    image_paths: Iterable[Path],
    detector: Any,
    output_directory: str = "process_debug_output",
) -> Dict[str, object]:
    """自动挑选四类典型缺陷图片，并导出它们的完整处理流程。

    选择依据是检测器的实际输出，而不是文件名。这样以后更换测试集或图片名称时，
    功能仍然有效。每类选中第一张成功识别的图片，因此输入列表应预先排序以保证结果
    可复现。
    """
    paths = [Path(path).expanduser().resolve() for path in image_paths]
    selected: Dict[str, Path] = {}
    for image_path in paths:
        result = detector.detect(str(image_path), print_report=False)
        defect_type = str(result["defect_type"])
        if defect_type in DEBUG_DEFECTS and defect_type not in selected:
            selected[defect_type] = image_path
        if len(selected) == len(DEBUG_DEFECTS):
            break

    missing = [DEBUG_DEFECTS[key][1] for key in DEBUG_DEFECTS if key not in selected]
    if missing:
        raise ValueError(
            "无法从输入数据中找到以下单缺陷类别：" + "、".join(missing)
        )

    output_path = Path(output_directory).expanduser().resolve()
    output_path.mkdir(parents=True, exist_ok=True)
    recorders: Dict[str, PipelineDebugRecorder] = {}
    results: Dict[str, Dict[str, object]] = {}

    # 固定类别顺序使文件说明和不同运行批次之间容易逐项比较。
    for defect_type in DEBUG_DEFECTS:
        recorder = PipelineDebugRecorder(
            output_directory=output_path,
            defect_type=defect_type,
            source_path=str(selected[defect_type]),
        )
        result = detector.detect(
            str(selected[defect_type]),
            print_report=False,
            debug_recorder=recorder,
        )
        if result["defect_type"] != defect_type:
            raise RuntimeError(
                f"调试重跑分类发生变化：期望 {defect_type}，实际 {result['defect_type']}"
            )
        recorders[defect_type] = recorder
        results[defect_type] = result

    explanation_path = _write_pipeline_explanation(
        output_path, recorders, results
    )
    return {
        "output_directory": str(output_path),
        "explanation_path": explanation_path,
        "selected_images": {
            defect_type: str(path) for defect_type, path in selected.items()
        },
        "file_count": sum(len(recorder.steps) for recorder in recorders.values()) + 1,
    }
