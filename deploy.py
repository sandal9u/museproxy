#!/usr/bin/env python3
"""px 部署：Cloudflare API 直传（multipart PUT），不走 wrangler。
需要环境变量 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / PX_KEY（GitHub Actions Secrets 注入）。
部署后开启 workers.dev 子域名入口、把 PX_KEY 写入 Worker Secret，并打印访问地址。"""
import io
import json
import os
import sys
import urllib.request
import uuid

ACCT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
SCRIPT = "px-nbfun"
API = "https://api.cloudflare.com/client/v4"


def call(method, path, body=None, ctype="application/json"):
    req = urllib.request.Request(API + path, method=method, data=body)
    req.add_header("Authorization", "Bearer " + TOKEN)
    if body is not None:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        print(e.read().decode("utf-8", "replace"), file=sys.stderr)
        raise


def main():
    src = io.open(os.path.join(os.path.dirname(__file__), "worker.js"), encoding="utf-8").read()
    boundary = "----px" + uuid.uuid4().hex
    meta = {"main_module": "worker.js", "compatibility_date": "2025-06-01"}
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n{json.dumps(meta)}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"worker.js\"; filename=\"worker.js\"\r\nContent-Type: application/javascript+module\r\n\r\n{src}\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    res = call("PUT", f"/accounts/{ACCT}/workers/scripts/{SCRIPT}", body, f"multipart/form-data; boundary={boundary}")
    assert res.get("success"), res
    print("uploaded:", res["result"]["id"], "modified:", res["result"]["modified_on"])

    sub = call("POST", f"/accounts/{ACCT}/workers/scripts/{SCRIPT}/subdomain",
               json.dumps({"enabled": True}).encode("utf-8"))
    print("workers.dev enabled:", sub.get("success"))

    secret = {"name": "PX_KEY", "type": "secret_text", "text": os.environ["PX_KEY"]}
    sres = call("PUT", f"/accounts/{ACCT}/workers/scripts/{SCRIPT}/secrets",
                json.dumps(secret).encode("utf-8"))
    print("secret PX_KEY set:", sres.get("success"))

    host = os.environ.get("PX_HOSTNAME")
    if host:
        dres = call("PUT", f"/accounts/{ACCT}/workers/domains",
                    json.dumps({"hostname": host, "service": SCRIPT,
                                "zone_name": os.environ.get("PX_ZONE", "")}).encode("utf-8"))
        print("custom domain:", host, dres.get("success"))

    info = call("GET", f"/accounts/{ACCT}/workers/subdomain")
    print("address: https://%s.%s.workers.dev/" % (SCRIPT, info["result"]["subdomain"]))


if __name__ == "__main__":
    main()
