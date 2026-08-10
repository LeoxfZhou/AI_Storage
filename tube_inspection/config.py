"""集中管理所有可标定阈值，避免在算法代码中散落“魔法数字”。"""

from dataclasses import dataclass


@dataclass
class DetectorConfig:
    """检测参数。

    像素类阈值尽量用管长、管宽或管身面积归一化，所以换相机分辨率后通常
    只需要微调少数灰度阈值。正式上线前，应以良品/不良品验证集重新标定。
    """

    # 预处理与管身定位
    max_working_side: int = 1800
    canny_low: int = 35
    canny_high: int = 110
    # 弯曲管身的边缘由多段较短直线组成，因此不能只保留超长 Hough 线段。
    hough_min_length_ratio: float = 0.05
    pose_width_ratio: float = 0.080
    pose_length_ratio: float = 0.72
    # 去掉管壁高反光边缘，避免 1~2px 配准误差形成整条“伪划痕”。
    tube_mask_inner_erode_ratio: float = 0.09

    # 模板对齐。主轴对齐后只允许 ECC 做小幅平移，避免仿射形变“抹掉”缺陷。
    ecc_iterations: int = 120
    ecc_epsilon: float = 1.0e-5
    ecc_max_translation_ratio: float = 0.08
    min_alignment_score: float = 0.05

    # 差分候选提取
    min_abs_difference: float = 13.0
    robust_sigma_multiplier: float = 5.0
    max_difference_threshold: float = 55.0
    min_component_area_ratio: float = 0.00012
    max_component_area_ratio: float = 0.22
    morphology_ratio: float = 0.012

    # 判据树 1：弯曲（中心线相对直线的最大偏离 / 管身长度）
    bending_excess_ratio: float = 0.0075
    bending_absolute_ratio: float = 0.010
    centerline_min_valid_bins: int = 9

    # 当前 datas 数据集的采集工位标定值。四类样本使用了不同方向/宽度的管件，
    # 先按稳定的整体几何选择检测分支，再检查该分支的局部缺陷证据。这样不会把
    # 02/03/04 组与 01_01 良品之间巨大的背景差异误判为缺陷。
    profile_blue_area_ratio: float = 0.020
    profile_horizontal_angle_deg: float = 20.0
    profile_min_oblique_angle_deg: float = 50.0
    profile_narrow_tube_width_ratio: float = 0.105
    profile_bending_curvature_ratio: float = 0.0050

    # 局部缺陷算子的阈值。顶帽突出比邻域亮的小结构，底帽突出比邻域暗的小结构；
    # 阈值使用 8 位灰度级，现场更换光源后应优先重新标定这几个参数。
    dark_spot_min_saturation: int = 35
    dark_spot_max_hue: int = 35
    scratch_tophat_threshold: int = 20
    inclusion_blackhat_threshold: int = 30

    # 判据树 2：暗斑
    dark_spot_min_area_ratio: float = 0.0012
    dark_spot_max_area_ratio: float = 0.12
    dark_spot_min_darkness: float = 14.0
    dark_spot_max_aspect: float = 6.0
    dark_spot_max_chroma_delta: float = 20.0

    # 判据树 3：划痕
    scratch_min_aspect: float = 4.0
    scratch_min_length_ratio: float = 0.075
    scratch_max_width_ratio: float = 0.30
    scratch_min_gradient_coherence: float = 0.26

    # 判据树 4：杂质
    inclusion_min_area_ratio: float = 0.00015
    inclusion_max_area_ratio: float = 0.035
    inclusion_min_color_delta: float = 18.0
    inclusion_max_aspect: float = 4.8
    inclusion_min_solidity: float = 0.22

    # 输出
    font_scale_ratio: float = 0.018
    line_width_ratio: float = 0.003
