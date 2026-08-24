#!/bin/bash
# OCR 模型下载脚本：拉取 pp-ocrv6-tiny（默认）与可选 pp-ocrv5-mobile（高精度备选）
# 下载目标路径与代码加载路径严格对应（det / rec 子目录名不可改）
MIRROR="http://183.136.206.212:8787"
OCR_DIR="/data/mtranserver/models/ocr"

# ---- pp-ocrv6-tiny（默认，约 7MB）----
mkdir -p "$OCR_DIR/pp-ocrv6-tiny/PP-OCRv6/det" \
         "$OCR_DIR/pp-ocrv6-tiny/PP-OCRv6/rec" \
         "$OCR_DIR/pp-ocrv6-tiny/shared/cls"
wget -c "$MIRROR/ocr/PP-OCRv6/det/PP-OCRv6_det_tiny.onnx" -O "$OCR_DIR/pp-ocrv6-tiny/PP-OCRv6/det/PP-OCRv6_det_tiny.onnx"
wget -c "$MIRROR/ocr/PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx" -O "$OCR_DIR/pp-ocrv6-tiny/PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx"
wget -c "$MIRROR/ocr/shared/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx" -O "$OCR_DIR/pp-ocrv6-tiny/shared/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx"

# ---- pp-ocrv5-mobile（高精度备选，约 22MB，可选）----
# 若私有镜像站 $MIRROR/ocr/PP-OCRv5/... 未同步，可从官方源获取后放入下方目录：
#   HuggingFace: https://huggingface.co/PaddlePaddle/PP-OCRv5
#   ModelScope : https://www.modelscope.cn/models/PaddlePaddle 下搜索 PP-OCRv5
mkdir -p "$OCR_DIR/pp-ocrv5-mobile/PP-OCRv5/det" \
         "$OCR_DIR/pp-ocrv5-mobile/PP-OCRv5/rec" \
         "$OCR_DIR/pp-ocrv5-mobile/shared/cls"
wget -c "$MIRROR/ocr/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx" -O "$OCR_DIR/pp-ocrv5-mobile/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx"
wget -c "$MIRROR/ocr/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx" -O "$OCR_DIR/pp-ocrv5-mobile/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx"
wget -c "$MIRROR/ocr/shared/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx" -O "$OCR_DIR/pp-ocrv5-mobile/shared/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx"

echo "OCR 模型下载完成"
