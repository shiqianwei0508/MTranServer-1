#!/bin/bash
# OCR 模型下载脚本
# 用法：
#   ./get_ocr_models.sh            # 默认下载 v6-tiny
#   ./get_ocr_models.sh v6-tiny    # PP-OCRv6 tiny（默认，约 7MB）
#   ./get_ocr_models.sh v5-mobile  # PP-OCRv5 mobile（高精度备选，约 22MB）
#   ./get_ocr_models.sh v6-medium  # PP-OCRv6 medium（服务端高精度，离线放置首选）
#   ./get_ocr_models.sh all        # 下载全部
#
# 下载目标路径与代码加载路径严格对应（det / rec 子目录名不可改）
MIRROR="http://183.136.206.212:8787"
OCR_DIR="/data/mtranserver/models/ocr"

# 共享分类模型（v6/v5 共用，断点续传幂等）
CLS_URL="$MIRROR/ocr/shared/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx"

TARGET="${1:-v6-tiny}"

download_cls() {
  local dir="$1"
  mkdir -p "$dir/shared/cls"
  wget -c "$CLS_URL" -O "$dir/shared/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx"
}

download_v6_tiny() {
  local dir="$OCR_DIR/pp-ocrv6-tiny"
  mkdir -p "$dir/PP-OCRv6/det" "$dir/PP-OCRv6/rec"
  wget -c "$MIRROR/ocr/PP-OCRv6/det/PP-OCRv6_det_tiny.onnx" -O "$dir/PP-OCRv6/det/PP-OCRv6_det_tiny.onnx"
  wget -c "$MIRROR/ocr/PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx" -O "$dir/PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx"
  download_cls "$dir"
}

download_v5_mobile() {
  local dir="$OCR_DIR/pp-ocrv5-mobile"
  mkdir -p "$dir/PP-OCRv5/det" "$dir/PP-OCRv5/rec"
  wget -c "$MIRROR/ocr/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx" -O "$dir/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx"
  wget -c "$MIRROR/ocr/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx" -O "$dir/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx"
  download_cls "$dir"
}

# ---- pp-ocrv6-medium（服务端高精度，离线放置首选）----
# 若私有镜像站 $MIRROR/ocr/PP-OCRv6/... 未同步 medium 档，可从官方源获取后放入下方目录：
#   HuggingFace: https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_det_onnx
#               https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec_onnx
#   ModelScope : https://www.modelscope.cn/models/PaddlePaddle/PP-OCRv6_medium_det_onnx
#               https://www.modelscope.cn/models/PaddlePaddle/PP-OCRv6_medium_rec_onnx
# 官方 medium 仓库内文件名为 inference.onnx（det / rec 同名，分属不同子目录），
# 下载后统一按本仓库命名风格重命名为 PP-OCRv6_medium_det.onnx / PP-OCRv6_medium_rec.onnx
download_v6_medium() {
  local dir="$OCR_DIR/pp-ocrv6-medium"
  mkdir -p "$dir/PP-OCRv6/det" "$dir/PP-OCRv6/rec"
  wget -c "$MIRROR/ocr/PP-OCRv6/det/PP-OCRv6_medium_det.onnx" -O "$dir/PP-OCRv6/det/PP-OCRv6_medium_det.onnx"
  wget -c "$MIRROR/ocr/PP-OCRv6/rec/PP-OCRv6_medium_rec.onnx" -O "$dir/PP-OCRv6/rec/PP-OCRv6_medium_rec.onnx"
  download_cls "$dir"
}

case "$TARGET" in
  v6-tiny)
    download_v6_tiny
    ;;
  v5-mobile)
    download_v5_mobile
    ;;
  v6-medium)
    download_v6_medium
    ;;
  all)
    download_v6_tiny
    download_v5_mobile
    download_v6_medium
    ;;
  *)
    echo "未知模型: $TARGET"
    echo "可用: v6-tiny | v5-mobile | v6-medium | all"
    exit 1
    ;;
esac

echo "OCR 模型下载完成: $TARGET"
