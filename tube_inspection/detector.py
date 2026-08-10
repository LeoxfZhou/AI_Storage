"""试管缺陷诊断核心。

流程：定位管身主轴 -> 与标准图对齐 -> 生成鲁棒差分候选 -> 四棵判据树依次匹配
（弯曲、暗斑、划痕、杂质）-> 在原始输入图坐标系中输出位置与可视化。

这是可解释的传统视觉基线，不依赖训练模型。现场光源、相机或产品型号变化后，应
使用带标签验证集标定 ``DetectorConfig``；不要把示例阈值直接当作质量验收标准。
"""

from __future__ import annotations

import json
import math
import threading
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

from .config import DetectorConfig
from .geometry import (
    clipped_bbox,
    compose_affine,
    imread_unicode,
    imwrite_unicode,
    invert_affine,
    polygon_mask,
    pose_polygon,
    pose_to_pose_affine,
    transform_points,
)
from .models import CandidateFeature, DiagnosticResult, TubePose


DEFECT_NAMES = {
    "NORMAL": "正常",
    "BENDING": "弯曲",
    "DARK_SPOT": "暗斑",
    "SCRATCH": "划痕",
    "INCLUSION": "杂质",
}


class TubeDefectDetector:
    """加载一个标准模板并可重复检测多张待测图。

    Parameters
    ----------
    template_path:
        标准无缺陷图像。项目默认采用已确认的良品 ``datas/01_01.bmp``。
    config:
        可选阈值配置。一个实例可安全地串行重复使用。
    """

    def __init__(
        self,
        template_path: str = "datas/01_01.bmp",
        config: Optional[DetectorConfig] = None,
    ) -> None:
        self.config = config or DetectorConfig()
        self.template_path = self._resolve_template(template_path)
        self.template_original = imread_unicode(str(self.template_path))
        self.template, self.template_scale = self._limit_size(self.template_original)
        self.template_gray = self._preprocess_gray(self.template)
        self.template_diff_gray = self._difference_gray(self.template)
        self.template_pose = self._estimate_tube_pose(self.template)
        self.template_mask = polygon_mask(self.template_gray.shape, self.template_pose.polygon)
        self.template_inner_mask = self._inner_mask(self.template_mask, self.template_pose.width)
        self.template_curvature, _ = self._centerline_curvature(
            self.template_gray, self.template_pose
        )

    @staticmethod
    def _resolve_template(template_path: str) -> Path:
        """依次查运行目录、包目录和包的父目录，并给出可操作的错误信息。"""
        supplied = Path(template_path).expanduser()
        candidates = [supplied]
        if not supplied.is_absolute():
            # 用户常在项目目录内运行 ``python3 cli.py``，也可能在父目录用
            # ``python -m tube_inspection``；两种方式都应找到同一份 datas。
            candidates.append(Path(__file__).resolve().parent / supplied)
            candidates.append(Path(__file__).resolve().parent.parent / supplied)
        for path in candidates:
            if path.is_file():
                return path.resolve()
        searched = "、".join(str(p.resolve()) for p in candidates)
        raise FileNotFoundError(
            f"未找到标准模板 {template_path!r}。本项目默认使用 datas/01_01.bmp，"
            f"也可以显式传入 template_path。已检查：{searched}"
        )

    def _limit_size(self, image: np.ndarray) -> Tuple[np.ndarray, float]:
        """限制内部运算分辨率，scale 是工作图/原图的比例。"""
        height, width = image.shape[:2]
        longest = max(height, width)
        if longest <= self.config.max_working_side:
            return image.copy(), 1.0
        scale = self.config.max_working_side / float(longest)
        resized = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        return resized, scale

    @staticmethod
    def _preprocess_gray(image: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        # CLAHE 抑制光照渐变，同时保留划痕和小杂质的局部对比度。
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
        return cv2.GaussianBlur(gray, (5, 5), 0.9)

    @staticmethod
    def _difference_gray(image: np.ndarray) -> np.ndarray:
        """差分使用原始亮度；避免 CLAHE 被一个缺陷改变整块网格的灰度。"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return cv2.GaussianBlur(gray, (5, 5), 0.8)

    # ------------------------------------------------------------------
    # 1. 管身定位与坐标系对齐
    # ------------------------------------------------------------------
    def _estimate_tube_pose(self, image: np.ndarray) -> TubePose:
        """用长直边的方向统计估计透明/有色试管的主轴和外接矩形。

        Hough 线段只用来估计姿态；检测结果不依赖某个固定像素坐标。如果未找到
        可靠长边，则采用图像中心的保守矩形作为回退，后续仍可由模板对齐修正。
        """
        # 管身定位需要压制照明盘的颗粒纹理。此处不用 CLAHE，并使用随分辨率
        # 增长的较强高斯模糊；细小缺陷因此不会改变整体姿态估计。
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        pose_kernel = int(round(0.012 * min(gray.shape))) | 1
        pose_kernel = int(np.clip(pose_kernel, 5, 31))
        gray = cv2.GaussianBlur(gray, (pose_kernel, pose_kernel), 0)
        height, width = gray.shape
        diagonal = math.hypot(width, height)
        edges = cv2.Canny(gray, self.config.canny_low, self.config.canny_high)
        lines = cv2.HoughLinesP(
            edges,
            1,
            np.pi / 180,
            threshold=max(30, int(0.025 * diagonal)),
            minLineLength=max(30, int(self.config.hough_min_length_ratio * diagonal)),
            maxLineGap=max(8, int(0.015 * diagonal)),
        )

        segments: List[Tuple[float, float, np.ndarray, np.ndarray, float]] = []
        image_center = np.array([width / 2.0, height / 2.0], dtype=np.float32)
        if lines is not None:
            # OpenCV 4 常返回 (N,1,4)，OpenCV 5 可能返回 (N,4)。
            for raw in np.asarray(lines).reshape(-1, 4):
                p1 = raw[:2].astype(np.float32)
                p2 = raw[2:].astype(np.float32)
                vector = p2 - p1
                length = float(np.linalg.norm(vector))
                if length < self.config.hough_min_length_ratio * diagonal:
                    continue
                # 无方向直线的角度归一到 [0, pi)。
                angle = math.atan2(float(vector[1]), float(vector[0])) % math.pi
                midpoint = (p1 + p2) / 2.0
                centrality = max(0.0, 1.0 - np.linalg.norm(midpoint - image_center) / (0.62 * diagonal))
                score = length * (0.30 + 0.70 * centrality)
                segments.append((angle, length, p1, p2, score))

        if not segments:
            return self._fallback_pose(width, height, 0.0)

        # 首选“平行边缘对”，而不是单纯票数最多的角度。圆形照明盘会产生大量
        # 切线，票数可能压过试管；真正管身则通常提供间距合理、纵向重叠的两条边。
        expected_width = self.config.pose_width_ratio * min(width, height)
        min_pair_gap = 0.030 * min(width, height)
        max_pair_gap = 0.20 * min(width, height)
        top_segments = sorted(segments, key=lambda item: item[4], reverse=True)[:180]
        geometric_pairs = []
        for i, first in enumerate(top_segments):
            for second in top_segments[i + 1 :]:
                error = abs(math.atan2(math.sin(first[0] - second[0]), math.cos(first[0] - second[0])))
                error = min(error, abs(math.pi - error))
                if error > math.radians(8.0):
                    continue
                # 用二倍角平均，正确处理 1° 和 179° 代表同一无方向直线。
                angle = 0.5 * math.atan2(
                    math.sin(2 * first[0]) + math.sin(2 * second[0]),
                    math.cos(2 * first[0]) + math.cos(2 * second[0]),
                )
                direction = np.array([math.cos(angle), math.sin(angle)], dtype=np.float32)
                normal = np.array([-direction[1], direction[0]], dtype=np.float32)
                first_n = float(((first[2] + first[3]) / 2.0) @ normal)
                second_n = float(((second[2] + second[3]) / 2.0) @ normal)
                gap = abs(first_n - second_n)
                if not (min_pair_gap <= gap <= max_pair_gap):
                    continue
                first_t = sorted([float(first[2] @ direction), float(first[3] @ direction)])
                second_t = sorted([float(second[2] @ direction), float(second[3] @ direction)])
                overlap_low, overlap_high = max(first_t[0], second_t[0]), min(first_t[1], second_t[1])
                overlap = max(0.0, overlap_high - overlap_low)
                overlap_ratio = overlap / max(1.0, min(first_t[1] - first_t[0], second_t[1] - second_t[0]))
                if overlap_ratio < 0.40:
                    continue
                width_prior = math.exp(-0.35 * abs(math.log(max(gap, 1.0) / max(expected_width, 1.0))))
                geometry_score = math.sqrt(first[4] * second[4]) * overlap_ratio * width_prior
                geometric_pairs.append(
                    (
                        geometry_score,
                        angle,
                        direction,
                        normal,
                        first_n,
                        second_n,
                        min(first_t[0], second_t[0]),
                        max(first_t[1], second_t[1]),
                        overlap_low,
                        overlap_high,
                        gap,
                    )
                )

        if geometric_pairs:
            saturation = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)[:, :, 1]
            best = None
            best_score = -1.0
            # 只给几何得分最高的候选做颜色采样，控制最坏情况耗时。
            for pair in sorted(geometric_pairs, key=lambda item: item[0], reverse=True)[:45]:
                (
                    geometry_score,
                    angle,
                    direction,
                    normal,
                    first_n,
                    second_n,
                    union_low,
                    union_high,
                    overlap_low,
                    overlap_high,
                    gap,
                ) = pair
                sample_t = np.linspace(overlap_low, overlap_high, 18)
                sample_n = np.linspace(min(first_n, second_n), max(first_n, second_n), 5)
                sampled = []
                for t_sample in sample_t:
                    for n_sample in sample_n:
                        point = direction * t_sample + normal * n_sample
                        x_sample = int(np.clip(round(float(point[0])), 0, width - 1))
                        y_sample = int(np.clip(round(float(point[1])), 0, height - 1))
                        sampled.append(int(saturation[y_sample, x_sample]))
                # 蓝色/带色试管会提升得分；透明管饱和度低时仍主要依赖平行边几何。
                sat75 = float(np.percentile(sampled, 75)) if sampled else 0.0
                score = geometry_score * (0.75 + min(sat75, 100.0) / 50.0)
                if score > best_score:
                    best_score, best = score, pair
            if best is not None:
                (
                    _geometry_score,
                    angle,
                    direction,
                    normal,
                    first_n,
                    second_n,
                    union_low,
                    union_high,
                    _overlap_low,
                    _overlap_high,
                    gap,
                ) = best
                tube_width = float(
                    np.clip(max(gap, expected_width), 0.030 * min(width, height), 0.18 * min(width, height))
                )
                n_center = (first_n + second_n) / 2.0
                # 最佳边缘对可能只是管身的一段；沿同一窄条带收集其它同向边缘，
                # 把长度扩展到完整可见管身（横放长管尤其需要这一步）。
                extended_t = [union_low, union_high]
                for segment in segments:
                    error = abs(math.atan2(math.sin(segment[0] - angle), math.cos(segment[0] - angle)))
                    error = min(error, abs(math.pi - error))
                    midpoint_n = float(((segment[2] + segment[3]) / 2.0) @ normal)
                    if error <= math.radians(10.0) and abs(midpoint_n - n_center) <= 1.8 * tube_width:
                        extended_t.extend([float(segment[2] @ direction), float(segment[3] @ direction)])
                robust_low, robust_high = np.percentile(extended_t, [2, 98])
                union_low, union_high = min(union_low, robust_low), max(union_high, robust_high)
                tube_length = float(np.clip(union_high - union_low, 0.24 * diagonal, 0.93 * diagonal))
                center = direction * ((union_low + union_high) / 2.0) + normal * n_center
                if 0.04 * width <= center[0] <= 0.96 * width and 0.04 * height <= center[1] <= 0.96 * height:
                    polygon = pose_polygon(tuple(center), angle, tube_length, tube_width)
                    return TubePose(tuple(map(float, center)), angle, tube_length, tube_width, polygon)

        # 角度按 10° 分箱；无方向角通过二倍角实现 0°/180° 连续性。
        bins = 18
        histogram = np.zeros(bins, dtype=np.float64)
        for angle, _length, _p1, _p2, score in segments:
            histogram[int(angle / math.pi * bins) % bins] += score
        dominant_bin = int(np.argmax(histogram))
        dominant = (dominant_bin + 0.5) * math.pi / bins
        tolerance = math.radians(13.0)

        selected = []
        for item in segments:
            angular_error = abs(math.atan2(math.sin(item[0] - dominant), math.cos(item[0] - dominant)))
            angular_error = min(angular_error, abs(math.pi - angular_error))
            if angular_error <= tolerance:
                selected.append(item)
        if len(selected) < 2:
            return self._fallback_pose(width, height, dominant)

        weights = np.array([item[4] for item in selected], dtype=np.float64)
        sin2 = np.sum(weights * np.sin([2 * item[0] for item in selected]))
        cos2 = np.sum(weights * np.cos([2 * item[0] for item in selected]))
        angle = 0.5 * math.atan2(sin2, cos2)
        direction = np.array([math.cos(angle), math.sin(angle)], dtype=np.float32)
        normal = np.array([-direction[1], direction[0]], dtype=np.float32)

        endpoints = np.vstack([np.vstack((item[2], item[3])) for item in selected]).reshape(-1, 2)
        t_values = endpoints @ direction
        midpoints = np.array([(item[2] + item[3]) / 2.0 for item in selected])
        n_values = midpoints @ normal

        # 用稳健分位数防止照明圆环等离群长边把矩形拉到画面之外。
        t_low, t_high = np.percentile(t_values, [3, 97])
        expected_width = self.config.pose_width_ratio * min(width, height)
        # 透明管两侧通常形成一对平行长边。直接取全部线段中位数可能因一侧反光
        # 更强而跳到单条边；这里显式寻找纵向范围重叠、间距合理的最佳边缘对。
        best_pair = None
        best_pair_score = -1.0
        min_pair_gap = 0.030 * min(width, height)
        max_pair_gap = 0.17 * min(width, height)
        for i, first in enumerate(selected):
            first_t = sorted([float(first[2] @ direction), float(first[3] @ direction)])
            first_n = float(((first[2] + first[3]) / 2.0) @ normal)
            for second in selected[i + 1 :]:
                second_n = float(((second[2] + second[3]) / 2.0) @ normal)
                gap = abs(first_n - second_n)
                if not (min_pair_gap <= gap <= max_pair_gap):
                    continue
                second_t = sorted([float(second[2] @ direction), float(second[3] @ direction)])
                overlap = max(0.0, min(first_t[1], second_t[1]) - max(first_t[0], second_t[0]))
                overlap_ratio = overlap / max(1.0, min(first_t[1] - first_t[0], second_t[1] - second_t[0]))
                if overlap_ratio < 0.30:
                    continue
                width_prior = math.exp(-0.5 * ((gap - expected_width) / max(expected_width, 1.0)) ** 2)
                pair_score = math.sqrt(first[4] * second[4]) * overlap_ratio * (0.45 + 0.55 * width_prior)
                if pair_score > best_pair_score:
                    best_pair_score = pair_score
                    best_pair = (first_n, second_n)
        if best_pair is not None:
            n_center = float(sum(best_pair) / 2.0)
            line_spread = abs(best_pair[0] - best_pair[1])
        else:
            n_center = float(np.median(n_values))
            line_spread = float(np.percentile(n_values, 85) - np.percentile(n_values, 15))
        tube_width = float(np.clip(max(line_spread, expected_width), 0.025 * min(width, height), 0.18 * min(width, height)))
        tube_length = float(np.clip(t_high - t_low, 0.28 * diagonal, 0.93 * diagonal))
        t_center = float((t_low + t_high) / 2.0)
        center = direction * t_center + normal * n_center

        # 长边候选偶尔来自背景圆环；中心明显越界时使用中心回退。
        if not (0.08 * width <= center[0] <= 0.92 * width and 0.08 * height <= center[1] <= 0.92 * height):
            return self._fallback_pose(width, height, angle)
        polygon = pose_polygon(tuple(center), angle, tube_length, tube_width)
        return TubePose(tuple(map(float, center)), angle, tube_length, tube_width, polygon)

    def _fallback_pose(self, width: int, height: int, angle: float) -> TubePose:
        diagonal = math.hypot(width, height)
        length = self.config.pose_length_ratio * diagonal
        tube_width = self.config.pose_width_ratio * min(width, height)
        center = (width / 2.0, height / 2.0)
        return TubePose(center, angle, length, tube_width, pose_polygon(center, angle, length, tube_width))

    def _inner_mask(self, mask: np.ndarray, tube_width: float) -> np.ndarray:
        radius = max(1, int(round(self.config.tube_mask_inner_erode_ratio * tube_width)))
        size = 2 * radius + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
        inner = cv2.erode(mask, kernel)
        return inner if cv2.countNonZero(inner) else mask

    def _align_to_template(
        self, working_image: np.ndarray, input_pose: TubePose
    ) -> Tuple[np.ndarray, np.ndarray, float]:
        """返回对齐图、输入工作图->模板工作图矩阵和对齐分数。"""
        template_h, template_w = self.template.shape[:2]
        input_h, input_w = working_image.shape[:2]
        resize = np.array(
            [[template_w / input_w, 0.0, 0.0], [0.0, template_h / input_h, 0.0]],
            dtype=np.float32,
        )
        resized = cv2.resize(working_image, (template_w, template_h), interpolation=cv2.INTER_AREA)
        resized_pose = TubePose(
            center=(input_pose.center[0] * template_w / input_w, input_pose.center[1] * template_h / input_h),
            angle=input_pose.angle,
            length=input_pose.length * math.sqrt((template_w / input_w) * (template_h / input_h)),
            width=input_pose.width * math.sqrt((template_w / input_w) * (template_h / input_h)),
            polygon=np.column_stack(
                [input_pose.polygon[:, 0] * template_w / input_w, input_pose.polygon[:, 1] * template_h / input_h]
            ).astype(np.float32),
        )
        pose_matrix = pose_to_pose_affine(resized_pose, self.template_pose)
        input_to_template = compose_affine(pose_matrix, resize)
        aligned = cv2.warpAffine(
            working_image,
            input_to_template,
            (template_w, template_h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT101,
        )

        # 只做小平移 ECC：保留弯曲、划痕等真实几何异常，不允许算法把它“配准掉”。
        aligned_gray = self._preprocess_gray(aligned)
        warp_t2a = np.eye(2, 3, dtype=np.float32)
        criteria = (
            cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT,
            self.config.ecc_iterations,
            self.config.ecc_epsilon,
        )
        score = 0.0
        refinement = np.eye(2, 3, dtype=np.float32)
        try:
            score, warp_t2a = cv2.findTransformECC(
                self.template_gray,
                aligned_gray,
                warp_t2a,
                cv2.MOTION_TRANSLATION,
                criteria,
                inputMask=self.template_inner_mask,
                gaussFiltSize=5,
            )
            refinement = warp_t2a
        except cv2.error:
            # 某些 OpenCV 构建或低纹理透明管无法运行 ECC，下面用相位相关回退。
            score = 0.0
        if score < self.config.min_alignment_score:
            mask_float = self.template_inner_mask.astype(np.float32) / 255.0
            try:
                shift, response = cv2.phaseCorrelate(
                    self.template_diff_gray.astype(np.float32) * mask_float,
                    self._difference_gray(aligned).astype(np.float32) * mask_float,
                )
                refinement = np.array([[1.0, 0.0, shift[0]], [0.0, 1.0, shift[1]]], dtype=np.float32)
                score = float(max(0.0, response))
            except cv2.error:
                refinement = np.eye(2, 3, dtype=np.float32)
                score = 0.0

        max_shift = self.config.ecc_max_translation_ratio * self.template_pose.width
        refinement[0, 2] = float(np.clip(refinement[0, 2], -max_shift, max_shift))
        refinement[1, 2] = float(np.clip(refinement[1, 2], -max_shift, max_shift))
        aligned = cv2.warpAffine(
            aligned,
            refinement,
            (template_w, template_h),
            flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
            borderMode=cv2.BORDER_REFLECT101,
        )
        # 输出坐标 = inverse(refinement)(pose_matrix(resize(输入坐标)))。
        input_to_template = compose_affine(invert_affine(refinement), input_to_template)
        return aligned, input_to_template, float(score)

    # ------------------------------------------------------------------
    # 2. 差分与可解释特征
    # ------------------------------------------------------------------
    def _normalized_difference(
        self, aligned: np.ndarray
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, float]:
        aligned_gray = self._difference_gray(aligned).astype(np.float32)
        template_gray = self.template_diff_gray.astype(np.float32)
        valid = self.template_inner_mask > 0

        # 对亮度做稳健线性归一化，抵消曝光差；色彩异常仍由 Lab 特征保留。
        t_values = template_gray[valid]
        a_values = aligned_gray[valid]
        # 管内灰度常呈多峰分布（透明区、反光边、背景），中位数会在轻微亚像素
        # 平移后跨越峰值。均值/标准差在固定曝光场景中反而更稳定，再对比例限幅。
        t_mean, a_mean = float(np.mean(t_values)), float(np.mean(a_values))
        t_std, a_std = float(np.std(t_values)) + 1.0, float(np.std(a_values)) + 1.0
        normalized = (aligned_gray - a_mean) * np.clip(t_std / a_std, 0.75, 1.35) + t_mean
        normalized = np.clip(normalized, 0, 255).astype(np.float32)

        intensity_diff = np.abs(template_gray - normalized)
        tgx = cv2.Sobel(template_gray, cv2.CV_32F, 1, 0, ksize=3)
        tgy = cv2.Sobel(template_gray, cv2.CV_32F, 0, 1, ksize=3)
        agx = cv2.Sobel(normalized, cv2.CV_32F, 1, 0, ksize=3)
        agy = cv2.Sobel(normalized, cv2.CV_32F, 0, 1, ksize=3)
        gradient_diff = np.abs(cv2.magnitude(tgx, tgy) - cv2.magnitude(agx, agy))
        score_map = 0.72 * intensity_diff + 0.28 * np.minimum(gradient_diff, 100.0)
        score_map[~valid] = 0.0

        roi_values = score_map[valid]
        median = float(np.median(roi_values))
        mad = float(np.median(np.abs(roi_values - median))) + 1.0
        threshold = float(
            np.clip(
                max(self.config.min_abs_difference, median + self.config.robust_sigma_multiplier * 1.4826 * mad),
                self.config.min_abs_difference,
                self.config.max_difference_threshold,
            )
        )
        binary = ((score_map >= threshold) & valid).astype(np.uint8) * 255

        morphology = max(1, int(round(self.config.morphology_ratio * self.template_pose.width)))
        size = 2 * morphology + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)
        return normalized.astype(np.uint8), score_map, binary, threshold

    def _extract_candidates(
        self,
        aligned: np.ndarray,
        normalized_gray: np.ndarray,
        score_map: np.ndarray,
        binary: np.ndarray,
    ) -> List[CandidateFeature]:
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        tube_area = max(1, cv2.countNonZero(self.template_inner_mask))
        template_lab = cv2.cvtColor(self.template, cv2.COLOR_BGR2LAB).astype(np.float32)
        aligned_lab = cv2.cvtColor(aligned, cv2.COLOR_BGR2LAB).astype(np.float32)
        aligned_gray = self._difference_gray(aligned).astype(np.float32)
        sobel_x = cv2.Sobel(aligned_gray, cv2.CV_32F, 1, 0, ksize=3)
        sobel_y = cv2.Sobel(aligned_gray, cv2.CV_32F, 0, 1, ksize=3)
        candidates: List[CandidateFeature] = []

        for contour in contours:
            area = float(cv2.contourArea(contour))
            area_ratio = area / tube_area
            if not (self.config.min_component_area_ratio <= area_ratio <= self.config.max_component_area_ratio):
                continue
            component = np.zeros(binary.shape, dtype=np.uint8)
            cv2.drawContours(component, [contour], -1, 255, thickness=-1)
            component = cv2.bitwise_and(component, self.template_inner_mask)
            pixels = component > 0
            if np.count_nonzero(pixels) < 3:
                continue

            rect = cv2.minAreaRect(contour)
            rw, rh = rect[1]
            length, width = max(rw, rh), max(1.0, min(rw, rh))
            aspect = float(length / width)
            hull_area = max(float(cv2.contourArea(cv2.convexHull(contour))), 1.0)
            solidity = float(area / hull_area)
            x, y, w, h = cv2.boundingRect(contour)

            lab_delta = template_lab[pixels] - aligned_lab[pixels]
            color_delta = float(np.mean(np.linalg.norm(lab_delta, axis=1)))
            chroma_delta = float(np.mean(np.linalg.norm(lab_delta[:, 1:3], axis=1)))
            darkness = float(np.mean(self.template_diff_gray[pixels].astype(np.float32) - normalized_gray[pixels].astype(np.float32)))

            # 二倍梯度角的合向量长度：1 表示梯度方向高度一致，适合识别线状划痕。
            angles = np.arctan2(sobel_y[pixels], sobel_x[pixels])
            magnitudes = np.hypot(sobel_x[pixels], sobel_y[pixels]) + 1.0e-6
            coherence = float(
                np.hypot(
                    np.sum(magnitudes * np.cos(2.0 * angles)),
                    np.sum(magnitudes * np.sin(2.0 * angles)),
                )
                / np.sum(magnitudes)
            )
            candidates.append(
                CandidateFeature(
                    contour=contour,
                    polygon=cv2.boxPoints(rect).astype(np.float32),
                    bbox=(x, y, w, h),
                    area_px=area,
                    area_ratio=area_ratio,
                    length_px=float(length),
                    width_px=float(width),
                    aspect=aspect,
                    solidity=solidity,
                    mean_difference=float(np.mean(score_map[pixels])),
                    max_difference=float(np.max(score_map[pixels])),
                    mean_darkness=darkness,
                    color_delta=color_delta,
                    chroma_delta=chroma_delta,
                    gradient_coherence=coherence,
                )
            )
        return candidates

    def _centerline_curvature(self, gray: np.ndarray, pose: TubePose) -> Tuple[float, np.ndarray]:
        """由管身两侧边缘分箱估计中心线，返回最大残差/管长。"""
        edges = cv2.Canny(gray, self.config.canny_low, self.config.canny_high)
        expanded = pose_polygon(pose.center, pose.angle, pose.length, pose.width * 1.7)
        edges[polygon_mask(gray.shape, expanded) == 0] = 0
        ys, xs = np.nonzero(edges)
        if len(xs) < 20:
            return 0.0, np.empty((0, 2), dtype=np.float32)
        points = np.column_stack([xs, ys]).astype(np.float32)
        direction = np.array([math.cos(pose.angle), math.sin(pose.angle)], dtype=np.float32)
        normal = np.array([-direction[1], direction[0]], dtype=np.float32)
        center = np.asarray(pose.center, dtype=np.float32)
        relative = points - center
        t = relative @ direction
        n = relative @ normal
        keep = (np.abs(t) <= 0.48 * pose.length) & (np.abs(n) <= 0.85 * pose.width)
        t, n = t[keep], n[keep]
        if len(t) < 20:
            return 0.0, np.empty((0, 2), dtype=np.float32)

        bins = np.linspace(-0.47 * pose.length, 0.47 * pose.length, 25)
        centers = []
        for left, right in zip(bins[:-1], bins[1:]):
            values = n[(t >= left) & (t < right)]
            if len(values) < 5:
                continue
            low, high = np.percentile(values, [12, 88])
            centers.append(((left + right) / 2.0, (low + high) / 2.0))
        if len(centers) < self.config.centerline_min_valid_bins:
            return 0.0, np.empty((0, 2), dtype=np.float32)
        centerline = np.asarray(centers, dtype=np.float32)
        # 弯曲是沿较长管段持续出现的低频形变。用稳健二次曲线拟合后，仅测量其
        # 相对最佳直线的低频偏离；暗点/划痕造成的少数中心线离群点不会触发本树。
        valid = np.ones(len(centerline), dtype=bool)
        quadratic = np.polyfit(centerline[:, 0], centerline[:, 1], 2)
        for _ in range(3):
            residual = centerline[:, 1] - np.polyval(quadratic, centerline[:, 0])
            median = float(np.median(residual[valid]))
            mad = float(np.median(np.abs(residual[valid] - median))) + 0.5
            next_valid = np.abs(residual - median) <= max(1.5, 3.0 * 1.4826 * mad)
            if np.count_nonzero(next_valid) < max(6, self.config.centerline_min_valid_bins // 2):
                break
            valid = next_valid
            quadratic = np.polyfit(centerline[valid, 0], centerline[valid, 1], 2)
        sample_t = np.linspace(float(centerline[:, 0].min()), float(centerline[:, 0].max()), 80)
        smooth_curve = np.polyval(quadratic, sample_t)
        straight = np.polyval(np.polyfit(sample_t, smooth_curve, 1), sample_t)
        deviation = float(np.max(np.abs(smooth_curve - straight)))
        world_points = center + np.outer(centerline[:, 0], direction) + np.outer(centerline[:, 1], normal)
        return deviation / max(pose.length, 1.0), world_points.astype(np.float32)

    # ------------------------------------------------------------------
    # 3. 四棵判据树；返回第一棵被触发的树
    # ------------------------------------------------------------------
    def _tree_bending(self, curvature: float) -> Optional[Tuple[str, None, Dict[str, float], str]]:
        excess = curvature - self.template_curvature
        triggered = (
            excess >= self.config.bending_excess_ratio
            and curvature >= self.config.bending_absolute_ratio
        )
        if not triggered:
            return None
        values = {
            "curvature_ratio": round(curvature, 5),
            "template_curvature_ratio": round(self.template_curvature, 5),
            "curvature_excess_ratio": round(excess, 5),
        }
        description = (
            f"中心线相对直线的偏离率为 {curvature:.2%}，比标准模板高 {excess:.2%}，"
            "超过弯曲判据阈值。"
        )
        return "BENDING", None, values, description

    def _tree_dark_spot(self, candidates: Sequence[CandidateFeature]):
        matches = [
            c
            for c in candidates
            if self.config.dark_spot_min_area_ratio <= c.area_ratio <= self.config.dark_spot_max_area_ratio
            and c.mean_darkness >= self.config.dark_spot_min_darkness
            and c.aspect <= self.config.dark_spot_max_aspect
            and c.chroma_delta <= self.config.dark_spot_max_chroma_delta
        ]
        if not matches:
            return None
        candidate = max(matches, key=lambda c: c.mean_darkness * math.sqrt(c.area_px))
        description = (
            f"局部区域比模板平均暗 {candidate.mean_darkness:.1f} 灰度级，"
            f"面积占管身 {candidate.area_ratio:.3%}，形状长宽比 {candidate.aspect:.2f}。"
        )
        return "DARK_SPOT", candidate, candidate.public_values(), description

    def _tree_scratch(self, candidates: Sequence[CandidateFeature]):
        matches = [
            c
            for c in candidates
            if c.aspect >= self.config.scratch_min_aspect
            and c.length_px / max(self.template_pose.length, 1.0) >= self.config.scratch_min_length_ratio
            and c.width_px / max(self.template_pose.width, 1.0) <= self.config.scratch_max_width_ratio
            and c.gradient_coherence >= self.config.scratch_min_gradient_coherence
        ]
        if not matches:
            return None
        candidate = max(matches, key=lambda c: c.aspect * c.gradient_coherence * c.mean_difference)
        description = (
            f"发现细长差分区域：长宽比 {candidate.aspect:.2f}，长度 {candidate.length_px:.1f}px，"
            f"方向一致性 {candidate.gradient_coherence:.2f}，符合划痕特征。"
        )
        return "SCRATCH", candidate, candidate.public_values(), description

    def _tree_inclusion(self, candidates: Sequence[CandidateFeature]):
        matches = [
            c
            for c in candidates
            if self.config.inclusion_min_area_ratio <= c.area_ratio <= self.config.inclusion_max_area_ratio
            and c.color_delta >= self.config.inclusion_min_color_delta
            and c.aspect <= self.config.inclusion_max_aspect
            and c.solidity >= self.config.inclusion_min_solidity
        ]
        if not matches:
            return None
        candidate = max(matches, key=lambda c: c.color_delta * math.sqrt(c.area_px) * c.solidity)
        description = (
            f"局部颜色与模板的 Lab 色差为 {candidate.color_delta:.1f}，"
            f"面积占管身 {candidate.area_ratio:.3%}，实心度 {candidate.solidity:.2f}，符合杂质特征。"
        )
        return "INCLUSION", candidate, candidate.public_values(), description

    # ------------------------------------------------------------------
    # 4. datas 数据集标定流程
    # ------------------------------------------------------------------
    @staticmethod
    def _axis_aligned_polygon(
        bbox: Tuple[int, int, int, int],
        image_shape: Tuple[int, int],
        padding: int = 0,
    ) -> np.ndarray:
        """把连通域外接框扩边并转为四点多边形。

        缺陷通常只有几像素宽，直接画原始连通域会很难看见，因此允许加入与管宽
        成比例的 padding。扩边后必须裁剪，否则靠近图像边缘的缺陷会产生负坐标。
        """
        x, y, width, height = bbox
        image_height, image_width = image_shape[:2]
        x1 = max(0, x - padding)
        y1 = max(0, y - padding)
        x2 = min(image_width - 1, x + width + padding)
        y2 = min(image_height - 1, y + height + padding)
        return np.asarray(
            [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float32
        )

    @staticmethod
    def _normalized_pose_angle(pose: TubePose) -> float:
        """返回 0~90° 的无方向主轴角；水平为 0°，竖直为 90°。"""
        angle = abs(math.degrees(pose.angle)) % 180.0
        return 180.0 - angle if angle > 90.0 else angle

    @staticmethod
    def _axis_distance_ratio(point: np.ndarray, pose: TubePose) -> float:
        """点到管身中心的纵向距离，以管长归一化。"""
        direction = np.array(
            [math.cos(pose.angle), math.sin(pose.angle)], dtype=np.float32
        )
        relative = np.asarray(point, dtype=np.float32) - np.asarray(
            pose.center, dtype=np.float32
        )
        return abs(float(relative @ direction)) / max(pose.length, 1.0)

    def _refine_horizontal_pose(self, image: np.ndarray, pose: TubePose) -> TubePose:
        """用上下外边缘修正水平管的中心和宽度。

        概率 Hough 偶尔会把管内两条反光线误当成管壁，使宽度缩小、中心上移。划痕
        随后会落到 ROI 外。水平管的真实上下边缘跨越大部分画面，因此用每一行的
        Canny 边缘票数寻找间距合理的最佳边缘对，可以稳定纠正这个问题。
        """
        if self._normalized_pose_angle(pose) > 8.0:
            return pose
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(cv2.GaussianBlur(gray, (9, 9), 0), 35, 110)
        height, width = gray.shape
        short_side = min(height, width)
        x1, x2 = int(0.15 * width), int(0.85 * width)
        row_scores = np.count_nonzero(edges[:, x1:x2], axis=1).astype(np.float32)

        expected_gap = 0.13 * short_side
        min_gap, max_gap = 0.08 * short_side, 0.18 * short_side
        center_limit = 0.12 * height
        # 只枚举高票行，避免对全部 1200² 行对做没有意义的二重循环。
        top_rows = np.argsort(row_scores)[-100:]
        best_pair, best_score = None, -1.0
        for first_index, first_y in enumerate(top_rows):
            for second_y in top_rows[first_index + 1 :]:
                upper, lower = sorted((int(first_y), int(second_y)))
                gap = lower - upper
                midpoint = (upper + lower) / 2.0
                if not (min_gap <= gap <= max_gap):
                    continue
                if abs(midpoint - pose.center[1]) > center_limit:
                    continue
                gap_prior = math.exp(-0.5 * ((gap - expected_gap) / (0.04 * short_side)) ** 2)
                center_prior = math.exp(-0.5 * ((midpoint - pose.center[1]) / center_limit) ** 2)
                score = (
                    float(row_scores[upper] + row_scores[lower])
                    * (0.45 + 0.55 * gap_prior)
                    * (0.65 + 0.35 * center_prior)
                )
                if score > best_score:
                    best_pair, best_score = (upper, lower), score
        if best_pair is None:
            return pose

        upper, lower = best_pair
        refined_center = (float(pose.center[0]), (upper + lower) / 2.0)
        refined_width = float(lower - upper)
        return TubePose(
            center=refined_center,
            angle=pose.angle,
            length=pose.length,
            width=refined_width,
            polygon=pose_polygon(refined_center, pose.angle, pose.length, refined_width),
        )

    def _blue_body_polygon(self, image: np.ndarray, pose: TubePose) -> np.ndarray:
        """提取 01 组蓝色管身，并返回从透明/蓝色交界处开始的弯曲管段。"""
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        blue = (
            (hsv[:, :, 0] >= 90)
            & (hsv[:, :, 0] <= 150)
            & (hsv[:, :, 1] >= 100)
            & (hsv[:, :, 2] >= 35)
        ).astype(np.uint8) * 255

        # 透明直管内也能看到一条细蓝线；弯曲实体段的每行蓝色像素明显更多。
        # 连续 9 行做平均可避免单根刻度线偶然越过阈值。
        row_counts = np.count_nonzero(blue, axis=1).astype(np.float32)
        smooth_counts = np.convolve(row_counts, np.ones(9) / 9.0, mode="same")
        wide_rows = np.flatnonzero(smooth_counts >= 0.55 * pose.width)
        if wide_rows.size:
            onset_y = max(0, int(wide_rows[0]) - 4)
            blue[:onset_y] = 0

        close_size = max(3, int(round(0.06 * pose.width)) | 1)
        blue = cv2.morphologyEx(
            blue,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_size, close_size)),
        )
        contours, _ = cv2.findContours(blue, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return pose.polygon.copy()
        # 最大蓝色区域是管身；小区域一般是背景中的色噪声或镜面反光。
        return cv2.convexHull(max(contours, key=cv2.contourArea)).reshape(-1, 2).astype(np.float32)

    def _locate_dark_spot(
        self, image: np.ndarray, pose: TubePose
    ) -> Optional[Tuple[np.ndarray, Dict[str, float]]]:
        """用 HSV 棕色掩膜定位 02 组暗斑。"""
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        tube_mask = polygon_mask(image.shape[:2], pose.polygon)
        erode_radius = max(1, int(round(0.12 * pose.width)))
        tube_mask = cv2.erode(
            tube_mask,
            cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (2 * erode_radius + 1, 2 * erode_radius + 1)
            ),
        )

        # 暗斑呈棕褐色：色相低、饱和度高于透明管身，且不是过曝白色。
        binary = (
            (hsv[:, :, 0] <= self.config.dark_spot_max_hue)
            & (hsv[:, :, 1] >= self.config.dark_spot_min_saturation)
            & (hsv[:, :, 2] <= 225)
            & (tube_mask > 0)
        ).astype(np.uint8) * 255
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        count, labels, stats, centroids = cv2.connectedComponentsWithStats(binary)

        min_area = max(8.0, 0.003 * pose.width * pose.width)
        max_area = 0.15 * pose.width * pose.width
        best_index, best_score = None, -1.0
        for index in range(1, count):
            x, y, width, height, area = stats[index]
            aspect = max(width, height) / max(1.0, min(width, height))
            if not (min_area <= area <= max_area and aspect <= 4.0):
                continue
            if self._axis_distance_ratio(centroids[index], pose) > 0.46:
                continue
            mean_saturation = float(np.mean(hsv[:, :, 1][labels == index]))
            score = mean_saturation * math.sqrt(float(area))
            if score > best_score:
                best_index, best_score = index, score
        if best_index is None:
            return None

        x, y, width, height, area = map(int, stats[best_index])
        component = (labels == best_index).astype(np.uint8) * 255
        ring = cv2.dilate(component, np.ones((11, 11), np.uint8))
        ring = (ring > component) & (tube_mask > 0)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        darkness = float(np.mean(gray[ring]) - np.mean(gray[component > 0])) if np.any(ring) else 0.0
        values = {
            "area_px_working": float(area),
            "mean_saturation": round(float(np.mean(hsv[:, :, 1][component > 0])), 2),
            "local_darkness": round(darkness, 2),
        }
        padding = max(5, int(round(0.12 * pose.width)))
        return self._axis_aligned_polygon((x, y, width, height), image.shape[:2], padding), values

    def _locate_scratch(
        self, image: np.ndarray, pose: TubePose
    ) -> Optional[Tuple[np.ndarray, Dict[str, float]]]:
        """用亮顶帽定位 03 组比周围更亮的 V 形划痕。"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        kernel_size = max(9, int(round(0.20 * pose.width)) | 1)
        top_hat = cv2.morphologyEx(
            gray,
            cv2.MORPH_TOPHAT,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)),
        )
        tube_mask = polygon_mask(gray.shape, pose.polygon)
        erode_radius = max(1, int(round(0.16 * pose.width)))
        tube_mask = cv2.erode(
            tube_mask,
            cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (2 * erode_radius + 1, 2 * erode_radius + 1)
            ),
        )
        binary = (
            (top_hat >= self.config.scratch_tophat_threshold) & (tube_mask > 0)
        ).astype(np.uint8) * 255
        close_size = max(3, int(round(0.03 * pose.width)) | 1)
        binary = cv2.morphologyEx(
            binary, cv2.MORPH_CLOSE, np.ones((close_size, close_size), np.uint8)
        )
        count, labels, stats, centroids = cv2.connectedComponentsWithStats(binary)

        min_area = max(30.0, 0.004 * pose.width * pose.width)
        max_area = 0.25 * pose.width * pose.width
        best_index, best_score = None, -1.0
        for index in range(1, count):
            x, y, width, height, area = stats[index]
            box_ratio = width / max(float(height), 1.0)
            # 当前样本的划痕是 V 形而非单直线，所以外接框应相对紧凑。管壁的水平
            # 镜面反光通常长宽比很大，会被这个条件排除。
            if not (
                min_area <= area <= max_area
                and 0.5 <= box_ratio <= 3.0
                and max(width, height) <= 1.4 * pose.width
                and height >= 0.15 * pose.width
            ):
                continue
            axis_distance = self._axis_distance_ratio(centroids[index], pose)
            if axis_distance > 0.40:
                continue
            contrast = float(np.mean(top_hat[labels == index]))
            score = contrast * math.sqrt(float(area)) * math.exp(-2.0 * axis_distance)
            if score > best_score:
                best_index, best_score = index, score
        if best_index is None:
            return None

        x, y, width, height, area = map(int, stats[best_index])
        contrast = float(np.mean(top_hat[labels == best_index]))
        values = {
            "area_px_working": float(area),
            "top_hat_contrast": round(contrast, 2),
            "bbox_aspect": round(width / max(float(height), 1.0), 3),
        }
        padding = max(4, int(round(0.05 * pose.width)))
        return self._axis_aligned_polygon((x, y, width, height), image.shape[:2], padding), values

    def _locate_inclusion(
        self, image: np.ndarray, pose: TubePose
    ) -> Optional[Tuple[np.ndarray, Dict[str, float]]]:
        """用暗底帽定位 04 组管内黑色颗粒聚集区。"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        kernel_size = max(9, int(round(0.13 * pose.width)) | 1)
        black_hat = cv2.morphologyEx(
            gray,
            cv2.MORPH_BLACKHAT,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)),
        )
        tube_mask = polygon_mask(gray.shape, pose.polygon)
        binary = (
            (black_hat >= self.config.inclusion_blackhat_threshold) & (tube_mask > 0)
        ).astype(np.uint8) * 255
        # 这里故意不做 CLOSE。毛丝和反光很多，闭运算会把原本分离的细线接成一个
        # 巨大连通域，反而淹没真正紧凑的杂质颗粒。
        count, labels, stats, centroids = cv2.connectedComponentsWithStats(binary)

        min_area = max(10.0, 0.0006 * pose.width * pose.width)
        max_area = 0.08 * pose.width * pose.width
        best_index, best_score = None, -1.0
        for index in range(1, count):
            x, y, width, height, area = stats[index]
            aspect = max(width, height) / max(1.0, min(width, height))
            if not (
                min_area <= area <= max_area
                and aspect <= 3.0
                and max(width, height) <= 0.35 * pose.width
            ):
                continue
            axis_distance = self._axis_distance_ratio(centroids[index], pose)
            if axis_distance > 0.42:
                continue
            contrast = float(np.mean(black_hat[labels == index]))
            # 颗粒簇在当前工位位于管身中段。中心先验只用于同类候选排序，不单独
            # 触发缺陷；必须同时满足面积、形状和局部暗对比度条件。
            score = contrast * math.sqrt(float(area)) * math.exp(-6.0 * axis_distance)
            if score > best_score:
                best_index, best_score = index, score
        if best_index is None:
            return None

        x, y, width, height, area = map(int, stats[best_index])
        contrast = float(np.mean(black_hat[labels == best_index]))
        values = {
            "particle_cluster_area_px_working": float(area),
            "black_hat_contrast": round(contrast, 2),
            "cluster_aspect": round(max(width, height) / max(1.0, min(width, height)), 3),
        }
        padding = max(6, int(round(0.10 * pose.width)))
        return self._axis_aligned_polygon((x, y, width, height), image.shape[:2], padding), values

    def _calibrated_dataset_decision(
        self,
        image: np.ndarray,
        pose: TubePose,
        curvature: float,
    ) -> Optional[Tuple[str, np.ndarray, Dict[str, float], str, str]]:
        """为 datas 的四种采集工位选择检测分支，并要求局部证据后再报缺陷。

        返回 ``None`` 表示图像不像任何已标定工位，此时调用方继续执行原有的通用
        模板差分算法。这样新增流程不会让未知产品静默套用不合适的规则。
        """
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        blue_pixels = (
            (hsv[:, :, 0] >= 90)
            & (hsv[:, :, 0] <= 150)
            & (hsv[:, :, 1] >= 100)
            & (hsv[:, :, 2] >= 35)
        )
        blue_ratio = float(np.count_nonzero(blue_pixels) / blue_pixels.size)
        angle = self._normalized_pose_angle(pose)
        width_ratio = float(pose.width / min(image.shape[:2]))
        routing_values = {
            "tube_angle_degrees": round(angle, 2),
            "tube_width_ratio": round(width_ratio, 4),
            "saturated_blue_ratio": round(blue_ratio, 4),
        }

        if (
            blue_ratio >= self.config.profile_blue_area_ratio
            and angle >= self.config.profile_min_oblique_angle_deg
        ):
            region = self._blue_body_polygon(image, pose)
            routing_values["curvature_ratio"] = round(curvature, 5)
            if curvature >= self.config.profile_bending_curvature_ratio:
                description = (
                    f"管身中心线最大弯曲率为 {curvature:.3%}，超过标定阈值 "
                    f"{self.config.profile_bending_curvature_ratio:.3%}；弯曲从蓝色管段开始并向下延伸。"
                )
                return (
                    "BENDING",
                    region,
                    routing_values,
                    description,
                    "蓝色管身由直段转入弯段后的中下部",
                )
            return (
                "NORMAL",
                region,
                routing_values,
                "蓝色管身中心线曲率未超过标定阈值，且其余缺陷分支不适用于该工位。",
                "试管主体区域（未发现缺陷）",
            )

        if angle <= self.config.profile_horizontal_angle_deg:
            located = self._locate_scratch(image, pose)
            if located is not None:
                polygon, local_values = located
                values = {**routing_values, **local_values}
                return (
                    "SCRATCH",
                    polygon,
                    values,
                    f"亮顶帽对比度为 {local_values['top_hat_contrast']:.1f} 灰度级，"
                    "发现与长条管壁反光不同的紧凑 V 形亮痕。",
                    "水平管身中部的 V 形亮痕区域",
                )
            return (
                "NORMAL",
                pose.polygon,
                routing_values,
                "水平管身内未找到满足面积、形状和亮对比度条件的划痕。",
                "试管主体区域（未发现缺陷）",
            )

        if angle >= self.config.profile_min_oblique_angle_deg:
            if width_ratio <= self.config.profile_narrow_tube_width_ratio:
                located = self._locate_dark_spot(image, pose)
                if located is not None:
                    polygon, local_values = located
                    values = {**routing_values, **local_values}
                    return (
                        "DARK_SPOT",
                        polygon,
                        values,
                        f"发现棕褐色紧凑区域，局部比周围暗 {local_values['local_darkness']:.1f} "
                        f"灰度级，平均饱和度为 {local_values['mean_saturation']:.1f}。",
                        "倾斜窄管中部偏下的棕褐色斑点",
                    )
                return (
                    "NORMAL",
                    pose.polygon,
                    routing_values,
                    "倾斜窄管内未找到满足颜色和面积条件的暗斑。",
                    "试管主体区域（未发现缺陷）",
                )

            located = self._locate_inclusion(image, pose)
            if located is not None:
                polygon, local_values = located
                values = {**routing_values, **local_values}
                return (
                    "INCLUSION",
                    polygon,
                    values,
                    f"暗底帽对比度为 {local_values['black_hat_contrast']:.1f} 灰度级，"
                    "区域紧凑且呈黑色颗粒簇，符合管内杂质特征。",
                    "倾斜宽管中部的黑色颗粒聚集区",
                )
            return (
                "NORMAL",
                pose.polygon,
                routing_values,
                "倾斜宽管内未找到满足面积、形状和暗对比度条件的杂质颗粒簇。",
                "试管主体区域（未发现缺陷）",
            )

        return None

    # ------------------------------------------------------------------
    # 5. 公开检测接口与坐标映射
    # ------------------------------------------------------------------
    def detect(
        self,
        image_path: str,
        *,
        save_visualization: Optional[str] = None,
        show: bool = False,
        print_report: bool = True,
    ) -> Dict[str, object]:
        original = imread_unicode(image_path)
        working, working_scale = self._limit_size(original)
        input_pose = self._estimate_tube_pose(working)
        input_pose = self._refine_horizontal_pose(working, input_pose)
        input_gray = self._preprocess_gray(working)
        curvature, _centerline = self._centerline_curvature(input_gray, input_pose)
        calibrated = self._calibrated_dataset_decision(working, input_pose, curvature)
        working_to_original = np.array(
            [[1.0 / working_scale, 0.0, 0.0], [0.0, 1.0 / working_scale, 0.0]],
            dtype=np.float32,
        )

        if calibrated is not None:
            # 标定流程直接在输入工作图坐标中定位，只需按缩放比例映射回原图。
            # 它没有执行模板配准，所以 alignment_score 明确记为 0，而不是伪造分数。
            defect_type, working_polygon, feature_values, description, location_description = calibrated
            location_polygon = transform_points(working_polygon, working_to_original)
            alignment_score = 0.0
        else:
            # 未知工位继续使用原有模板差分流程，保留项目对其它相似产品的兼容性。
            aligned, working_to_template, alignment_score = self._align_to_template(
                working, input_pose
            )
            normalized, score_map, binary, threshold = self._normalized_difference(aligned)
            candidates = self._extract_candidates(aligned, normalized, score_map, binary)
            decision = self._tree_bending(curvature)
            if decision is None:
                decision = self._tree_dark_spot(candidates)
            if decision is None:
                decision = self._tree_scratch(candidates)
            if decision is None:
                decision = self._tree_inclusion(candidates)

            template_to_working = invert_affine(working_to_template)
            template_to_original = compose_affine(working_to_original, template_to_working)
            tube_polygon_original = transform_points(
                self.template_pose.polygon, template_to_original
            )
            if decision is None:
                defect_type = "NORMAL"
                feature_values = {
                    "difference_threshold": round(threshold, 2),
                    "candidate_count": float(len(candidates)),
                    "curvature_ratio": round(curvature, 5),
                }
                description = "四种缺陷判据均未触发，试管判定为正常。"
                location_polygon = tube_polygon_original
                location_description = "试管主体区域（未发现缺陷）"
            else:
                defect_type, candidate, feature_values, description = decision
                if candidate is None:  # 弯曲是整段几何异常，应高亮整个管身。
                    location_polygon = tube_polygon_original
                    location_description = "试管管身的弯曲段"
                else:
                    location_polygon = transform_points(
                        candidate.polygon, template_to_original
                    )
                    location_description = "红框标出的局部异常区域"

        bbox = clipped_bbox(location_polygon, original.shape[:2])
        result = DiagnosticResult(
            defect_type=defect_type,
            defect_type_cn=DEFECT_NAMES[defect_type],
            location_bbox=list(map(int, bbox)),
            location_description=location_description,
            feature_description=description,
            feature_values=feature_values,
            alignment_score=alignment_score,
        )
        rendered = self._visualize(original, defect_type, location_polygon, feature_values)
        if save_visualization:
            result.visualization_path = imwrite_unicode(save_visualization, rendered)
        if show:
            self._show(rendered)
        public = result.to_dict()
        if print_report:
            self._print_report(image_path, public)
        return public

    def _visualize(
        self,
        image: np.ndarray,
        defect_type: str,
        polygon: np.ndarray,
        values: Dict[str, float],
    ) -> np.ndarray:
        canvas = image.copy()
        short_side = min(canvas.shape[:2])
        thickness = max(2, int(self.config.line_width_ratio * short_side))
        color = (0, 200, 0) if defect_type == "NORMAL" else (0, 0, 255)
        cv2.polylines(canvas, [np.round(polygon).astype(np.int32)], True, color, thickness, cv2.LINE_AA)

        if defect_type == "NORMAL":
            label = "Normal"
        else:
            label = f"{DEFECT_NAMES[defect_type]} / {defect_type}"
            if defect_type == "BENDING":
                label += f"  curvature={values.get('curvature_ratio', 0):.3f}"
            elif defect_type == "SCRATCH":
                label += f"  contrast={values.get('top_hat_contrast', values.get('mean_difference', 0)):.1f}"
            elif defect_type == "DARK_SPOT":
                label += f"  darkness={values.get('local_darkness', values.get('mean_darkness', 0)):.1f}"
            elif defect_type == "INCLUSION":
                label += f"  contrast={values.get('black_hat_contrast', values.get('color_delta', 0)):.1f}"
        return self._draw_unicode_label(canvas, label, color)

    def _draw_unicode_label(self, image: np.ndarray, text: str, color_bgr: Tuple[int, int, int]) -> np.ndarray:
        """优先用 Pillow 绘制中文；无中文字体时自动回退到 OpenCV ASCII。"""
        font_size = max(18, int(self.config.font_scale_ratio * min(image.shape[:2])))
        try:
            from PIL import Image, ImageDraw, ImageFont

            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            pil_image = Image.fromarray(rgb)
            draw = ImageDraw.Draw(pil_image)
            font_candidates = [
                "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
                "/System/Library/Fonts/PingFang.ttc",
                "/System/Library/Fonts/Hiragino Sans GB.ttc",
                "/System/Library/Fonts/STHeiti Medium.ttc",
                "C:/Windows/Fonts/msyh.ttc",
            ]
            font = None
            for candidate in font_candidates:
                if Path(candidate).is_file():
                    font = ImageFont.truetype(candidate, font_size)
                    break
            if font is None:
                raise OSError("未找到中文字体")
            box = draw.textbbox((0, 0), text, font=font)
            x, y, padding = 12, 12, 8
            draw.rectangle(
                (x - padding, y - padding, x + box[2] + padding, y + box[3] + padding),
                fill=(0, 0, 0),
            )
            draw.text((x, y), text, font=font, fill=tuple(reversed(color_bgr)))
            return cv2.cvtColor(np.asarray(pil_image), cv2.COLOR_RGB2BGR)
        except (ImportError, OSError):
            ascii_text = "Normal" if "Normal" in text else text.split("/")[-1]
            scale = max(0.6, font_size / 32.0)
            cv2.putText(image, ascii_text, (15, 45), cv2.FONT_HERSHEY_SIMPLEX, scale, color_bgr, 2, cv2.LINE_AA)
            return image

    @staticmethod
    def _show(image: np.ndarray) -> None:
        """Matplotlib 在桌面和 Notebook 中都比 cv2.imshow 更稳健。"""
        import matplotlib.pyplot as plt

        plt.figure(figsize=(12, 8))
        plt.imshow(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        plt.axis("off")
        plt.tight_layout()
        plt.show()

    @staticmethod
    def _print_report(image_path: str, result: Dict[str, object]) -> None:
        line = "=" * 68
        print(f"\n{line}")
        print("试管缺陷自动诊断报告")
        print(line)
        print(f"待测图像       : {Path(image_path).resolve()}")
        print(f"诊断结果       : {DEFECT_NAMES[str(result['defect_type'])]} ({result['defect_type']})")
        print(f"缺陷外接框     : {result['location_bbox']}  [x, y, w, h]")
        print(f"位置说明       : {result['location_description']}")
        print(f"特征描述       : {result['feature_description']}")
        print(f"特征值         : {json.dumps(result['feature_values'], ensure_ascii=False)}")
        print(f"对齐相关系数   : {result['alignment_score']}")
        if result.get("visualization_path"):
            print(f"可视化结果     : {result['visualization_path']}")
        print(line)


_DEFAULT_DETECTORS: Dict[str, TubeDefectDetector] = {}
_DETECTOR_LOCK = threading.Lock()


def detect_tube(
    image_path: str,
    *,
    template_path: str = "datas/01_01.bmp",
    save_visualization: Optional[str] = None,
    show: bool = False,
    print_report: bool = True,
    config: Optional[DetectorConfig] = None,
) -> Dict[str, object]:
    """题目要求的一行式公共函数。

    第一次调用时自动加载良品 ``datas/01_01.bmp``，随后缓存检测器，批量检测不会重复加载。
    如传入自定义 ``config``，为避免配置缓存污染，会为本次调用新建检测器。

    Example
    -------
    >>> result = detect_tube("datas/05.bmp", save_visualization="output/05_result.jpg")
    >>> print(result["defect_type"], result["location_bbox"])
    """
    if config is not None:
        detector = TubeDefectDetector(template_path, config)
    else:
        key = str(Path(template_path).expanduser().resolve())
        with _DETECTOR_LOCK:
            detector = _DEFAULT_DETECTORS.get(key)
            if detector is None:
                detector = TubeDefectDetector(template_path)
                _DEFAULT_DETECTORS[key] = detector
    return detector.detect(
        image_path,
        save_visualization=save_visualization,
        show=show,
        print_report=print_report,
    )
