#!/usr/bin/env python3
"""生产环境模型自动更新接口探活测试。

用法:
    python3 scripts/test_auto_update_probe.py --base-url https://freedotrans.gbim.vip [--token <MT_API_TOKEN>]

测试项:
    1. GET  /                      健康检查
    2. POST /models/auto-update    手动触发自动更新 (返回 202 表示受理)
    3. GET  /models                读取模型清单 (验证接口可用)

注: tsoa basePath="/", 路由无 /api 前缀, 实际路径为 /models/* 而非 /api/models/*。
"""
import argparse
import json
import ssl
import sys
import urllib.error
import urllib.request


def http(method, url, token=None, data=None, timeout=30, verify=True):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    ctx = None
    if not verify:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            raw = resp.read().decode("utf-8", "replace")
            try:
                payload = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                payload = raw
            return resp.status, payload
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            payload = raw
        return e.code, payload
    except Exception as e:  # noqa: BLE001
        return None, f"{type(e).__name__}: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True, help="生产环境根地址, 如 http://1.2.3.4:8989")
    ap.add_argument("--token", default=None, help="MT_API_TOKEN (若启用鉴权)")
    ap.add_argument("--no-verify", action="store_true",
                    help="跳过 TLS 证书校验 (自签/链不全时)")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")
    verify = not args.no_verify

    results = []

    # 1. 健康检查
    print("== 1. GET / (健康检查) ==")
    status, payload = http("GET", f"{base}/", timeout=15, verify=verify)
    ok = status == 200
    print(f"   status={status} payload={payload}")
    results.append(("health", ok))

    # 2. 手动触发自动更新
    print("\n== 2. POST /models/auto-update (手动触发) ==")
    status, payload = http("POST", f"{base}/models/auto-update", token=args.token, timeout=30, verify=verify)
    # 202 受理; 200 + triggered:false 为已运行/禁用/关闭 (非错误)
    if status in (202, 200) and isinstance(payload, dict):
        triggered = payload.get("triggered")
        reason = payload.get("reason")
        ok = status == 202 or (status == 200 and triggered is False)
        print(f"   status={status} triggered={triggered} reason={reason} message={payload.get('message')}")
    else:
        ok = False
        print(f"   status={status} payload={payload}")
    results.append(("auto_update_trigger", ok))

    # 3. 模型清单
    print("\n== 3. GET /models (模型清单) ==")
    status, payload = http("GET", f"{base}/models", token=args.token, timeout=30, verify=verify)
    ok = status == 200 and isinstance(payload, dict)
    if ok:
        langs = payload.get("languages") or payload.get("models")
        print(f"   status=200 languages/keys={list(payload.keys())[:8]}")
    else:
        print(f"   status={status} payload={payload}")
    results.append(("models_list", ok))

    print("\n== 汇总 ==")
    all_ok = True
    for name, ok in results:
        print(f"   [{'PASS' if ok else 'FAIL'}] {name}")
        all_ok = all_ok and ok
    print("RESULT:", "ALL PASS" if all_ok else "SOME FAILED")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
