#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键抓取网页正文并调用 MTranServer 翻译为指定语言（默认中文）。

用法:
    python3 translate_webpage.py <URL> --token <API_TOKEN> [--to zh] [--from auto] [--base https://your.host] [--proxy socks5://127.0.0.1:1080]

说明:
    - 仅使用 Python 标准库，无需 pip install。
    - token 通过命令行参数传入，不会写入任何文件。
    - from=auto 时由 MTranServer 自动检测源语言（支持英文之外的任意语言）。
"""
import argparse
import json
import ssl
import sys
import urllib.request
import urllib.error
import urllib.parse
from html.parser import HTMLParser


DEFAULT_BASE = "https://freedotrans.gbim.vip"


class BodyTextExtractor(HTMLParser):
    """提取 <article>/<main> 内 <p> 与标题文本，过滤 script/style/nav/header/footer/aside。"""

    SKIP_TAGS = {"script", "style", "nav", "header", "footer", "aside", "noscript", "svg", "iframe"}
    PARAGRAPH_TAGS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_skip = 0
        self.in_content = 0  # 处于 article/main 内的深度
        self.buffer = []
        self.text_parts = []
        self.title = ""

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP_TAGS:
            self.in_skip += 1
        if tag in ("article", "main"):
            self.in_content += 1
        if tag == "title" and not self.title:
            self._capture_title = True
        else:
            self._capture_title = False
        if self.in_skip == 0:
            if tag in self.PARAGRAPH_TAGS:
                # 段落开始，先落一个换行标记
                self.buffer.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP_TAGS and self.in_skip > 0:
            self.in_skip -= 1
        if tag in ("article", "main") and self.in_content > 0:
            self.in_content -= 1

    def handle_data(self, data):
        if self.in_skip > 0:
            return
        if getattr(self, "_capture_title", False):
            self.title += data.strip()
            return
        # 优先捕获 article/main 内的文本；若无则退而求其次抓取全文 body 文本
        text = data.strip()
        if not text:
            return
        if self.in_content > 0:
            self.text_parts.append(text)
        else:
            # 兜底：把所有可见文本先收集，article 缺失时再用
            self.buffer.append(text)

    def get_text(self):
        parts = self.text_parts if self.text_parts else self.buffer
        raw = " ".join(p for p in parts if p)
        # 规范化空白
        lines = [ln.strip() for ln in raw.split("\n")]
        out = "\n".join(ln for ln in lines if ln)
        return out


def fetch_html(url, proxy=None, timeout=30, insecure=False):
    ctx = ssl._create_unverified_context() if insecure else None
    handlers = []
    if proxy:
        from urllib.request import ProxyHandler
        handlers.append(ProxyHandler({"http": proxy, "https": proxy}))
    opener = urllib.request.build_opener(*handlers) if handlers else urllib.request.urlopen
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            "Accept-Language": "uk,ru,en;q=0.8",
        },
    )
    if handlers:
        resp = opener.open(req, timeout=timeout)
    elif ctx is not None:
        resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
    else:
        resp = urllib.request.urlopen(req, timeout=timeout)
    charset = resp.headers.get_content_charset() or "utf-8"
    return resp.read().decode(charset, errors="replace")


def detect_lang(base, token, text, proxy=None, insecure=False):
    ctx = ssl._create_unverified_context() if insecure else None
    payload = json.dumps({"text": text[:2000]}).encode("utf-8")
    req = urllib.request.Request(
        base.rstrip("/") + "/detect",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-API-Token": token,
        },
        method="POST",
    )
    if proxy:
        from urllib.request import ProxyHandler, build_opener
        opener = build_opener(ProxyHandler({"http": proxy, "https": proxy}))
        resp = opener.open(req, timeout=30)
    elif ctx is not None:
        resp = urllib.request.urlopen(req, timeout=30, context=ctx)
    else:
        resp = urllib.request.urlopen(req, timeout=30)
    data = json.loads(resp.read().decode("utf-8"))
    # 兼容 {detectedLanguage} / {language} / {lang}
    return data.get("detectedLanguage") or data.get("language") or data.get("lang") or "unknown"


def translate(base, token, text, to, src, proxy=None, insecure=False):
    ctx = ssl._create_unverified_context() if insecure else None
    payload = json.dumps({"from": src, "to": to, "text": text}).encode("utf-8")
    req = urllib.request.Request(
        base.rstrip("/") + "/translate",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-API-Token": token,
        },
        method="POST",
    )
    if proxy:
        from urllib.request import ProxyHandler, build_opener
        opener = build_opener(ProxyHandler({"http": proxy, "https": proxy}))
        resp = opener.open(req, timeout=120)
    elif ctx is not None:
        resp = urllib.request.urlopen(req, timeout=120, context=ctx)
    else:
        resp = urllib.request.urlopen(req, timeout=120)
    data = json.loads(resp.read().decode("utf-8"))
    # 兼容 {result} / {translatedText} / {translation}
    return data.get("result") or data.get("translatedText") or data.get("translation") or str(data)


def main():
    # Windows 控制台默认 gbk，强制 UTF-8 输出避免乌克兰语/中文等字符编码失败
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="抓取网页正文并调用 MTranServer 翻译")
    ap.add_argument("url", help="目标网页 URL")
    ap.add_argument("--token", required=True, help="MTranServer API token")
    ap.add_argument("--base", default=DEFAULT_BASE, help="MTranServer base URL")
    ap.add_argument("--to", default="zh", help="目标语言 (默认 zh)")
    ap.add_argument("--from", dest="src", default="auto", help="源语言 (默认 auto 自动检测)")
    ap.add_argument("--proxy", default=None, help="可选 socks5/http 代理")
    ap.add_argument("--insecure", action="store_true", help="跳过 TLS 证书校验 (仅用于本地 CA 缺失的测试环境)")
    ap.add_argument("--max-chars", type=int, default=8000, help="最多翻译的正文字符数 (默认 8000)")
    args = ap.parse_args()

    print("==> 抓取页面:", args.url)
    html = fetch_html(args.url, proxy=args.proxy, insecure=args.insecure)
    ext = BodyTextExtractor()
    ext.feed(html)
    text = ext.get_text()
    if not text:
        print("[错误] 未能从页面提取到正文文本。", file=sys.stderr)
        sys.exit(1)
    if ext.title:
        print("==> 页面标题:", ext.title)
    print("==> 提取正文长度:", len(text), "字符")

    # 源语言检测（仅展示，auto 时交给服务端）
    if args.src == "auto":
        try:
            lang = detect_lang(args.base, args.token, text, proxy=args.proxy, insecure=args.insecure)
            print("==> 自动检测源语言:", lang)
        except Exception as e:
            print("[警告] 检测源语言失败 (将直接交给服务端 auto):", e, file=sys.stderr)

    chunk = text[: args.max_chars]
    print("\n----- 原文 (前 %d 字符) -----" % len(chunk))
    print(chunk[:500] + (" ..." if len(chunk) > 500 else ""))

    print("\n----- 译文 (%s) -----" % args.to)
    result = translate(args.base, args.token, chunk, args.to, args.src, proxy=args.proxy, insecure=args.insecure)
    print(result)


if __name__ == "__main__":
    main()
