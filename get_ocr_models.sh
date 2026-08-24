#!/bin/bash
MIRROR="http://183.136.206.212:8787"
OCR_DIR="/data/mtranserver/models/ocr"
mkdir -p "$OCR_DIR/pp-ocrv6-tiny/PP-OCRv6/det" \
         "$OCR_DIR/pp-ocrv6-tiny/PP-OCRv6/rec" \
         "$OCR_DIR/pp-ocrv6-tiny/shared/cls"

wget -c "$MIRROR/ocr/PP-OCRv6/det/PP-OCRv6_det_tiny.onnx" -O "$OCR_DIR/pp-ocrv6-tiny/PP-OCRv6/det/PP-OCRv6_det_tiny.onnx"
wget -c "$MIRROR/ocr/PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx" -O "$OCR_DIR/pp-ocrv6-tiny/PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx"
wget -c "$MIRROR/ocr/shared/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx" -O "$OCR_DIR/pp-ocrv6-tiny/shared/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx"

echo "OCR 模型下载完成"
