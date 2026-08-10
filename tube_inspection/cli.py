"""命令行入口：支持任意单张输入和目录批量检测。"""

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional

# 同一个文件既支持 ``python -m tube_inspection``，也支持用户在项目目录直接运行
# ``python3 cli.py``。后者没有包上下文，需要把父目录加入模块搜索路径。
try:
    from .detector import DEFECT_NAMES, TubeDefectDetector
except ImportError:  # pragma: no cover - 只有直接运行 cli.py 时进入这个分支。
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from tube_inspection.detector import DEFECT_NAMES, TubeDefectDetector


IMAGE_SUFFIXES = {".bmp", ".jpg", ".jpeg", ".png", ".tif", ".tiff"}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="基于标准模板的试管四类缺陷诊断")
    parser.add_argument("image", nargs="?", help="随机输入的单张 BMP/JPG/PNG 路径")
    parser.add_argument("--batch", metavar="DIRECTORY", help="批量检测目录中的全部图像")
    parser.add_argument(
        "--template",
        default="datas/01_01.bmp",
        help="无缺陷模板（默认 datas/01_01.bmp）",
    )
    parser.add_argument("--output", help="单张模式的带框结果图路径")
    parser.add_argument(
        "--output-dir",
        default="results",
        help="批量模式结果目录（默认 results）",
    )
    parser.add_argument("--show", action="store_true", help="弹出/Notebook 显示结果")
    parser.add_argument(
        "--json",
        dest="json_path",
        help="另存 JSON；批量模式省略时自动写到 results/summary.json",
    )
    parser.add_argument("--quiet", action="store_true", help="不打印格式化报告")
    return parser


def _write_json(path_value: str, payload: object) -> str:
    """统一处理中文 JSON 和父目录创建，返回最终绝对路径。"""
    path = Path(path_value).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path)


def _batch_images(directory_value: str) -> List[Path]:
    directory = Path(directory_value).expanduser().resolve()
    if not directory.is_dir():
        raise NotADirectoryError(f"批量输入目录不存在：{directory}")
    # 文件名排序使每次报告顺序稳定，便于把两次调参结果逐行比较。
    return sorted(
        path for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )


def _run_batch(args: argparse.Namespace, detector: TubeDefectDetector) -> int:
    images = _batch_images(args.batch)
    if not images:
        raise ValueError(f"目录中没有支持的图像：{Path(args.batch).resolve()}")

    output_dir = Path(args.output_dir).expanduser().resolve()
    results = []
    for image_path in images:
        output_path = output_dir / f"{image_path.stem}_result.jpg"
        try:
            result = detector.detect(
                str(image_path),
                save_visualization=str(output_path),
                show=args.show,
                print_report=False,
            )
            result["image_path"] = str(image_path)
            results.append(result)
            if not args.quiet:
                print(
                    f"{image_path.name:<18} -> {result['defect_type_cn']:<4} "
                    f"位置 {result['location_bbox']}"
                )
        except (FileNotFoundError, ValueError, OSError) as error:
            # 一张坏图不应中断整个批次；错误也写入汇总，方便事后定位数据问题。
            results.append({"image_path": str(image_path), "error": str(error)})
            print(f"{image_path.name:<18} -> 读取/检测失败：{error}", file=sys.stderr)

    json_path = args.json_path or str(output_dir / "summary.json")
    saved_json = _write_json(json_path, results)
    if not args.quiet:
        success_count = sum("error" not in item for item in results)
        print(f"\n完成 {success_count}/{len(results)} 张；标注图：{output_dir}")
        print(f"JSON 汇总：{saved_json}")
    return 0 if all("error" not in item for item in results) else 1


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if bool(args.image) == bool(args.batch):
        parser.error("请提供一张 image，或使用 --batch DIRECTORY；两者必须且只能选一个")
    if args.batch and args.output:
        parser.error("--output 只用于单张模式；批量模式请使用 --output-dir")

    try:
        # 检测器只初始化一次；批量模式不会为每张图重复读取和预处理良品模板。
        detector = TubeDefectDetector(args.template)
        if args.batch:
            return _run_batch(args, detector)

        result = detector.detect(
            args.image,
            save_visualization=args.output,
            show=args.show,
            print_report=not args.quiet,
        )
        if args.json_path:
            saved_json = _write_json(args.json_path, result)
            if not args.quiet:
                print(f"JSON 结果       : {saved_json}")
        return 0
    except (FileNotFoundError, NotADirectoryError, ValueError, OSError) as error:
        print(f"错误：{error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
