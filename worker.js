// px — 极简网页代理（Worker 名 px-nbfun，域名 px.nbfun.com，HTTP 网页代理）
// 对外伪装：根路径与一切未授权访问一律返回 nginx 默认欢迎页；robots.txt 全站禁止爬虫。
// 真正入口：https://px.nbfun.com/https://目标网址（需已授权 Cookie）
//          或 https://px.nbfun.com/<授权码>/https://目标网址（访问后种授权 Cookie，之后用 /https 直达）
// 授权码存 Worker Secret（env.PX_KEY），不入代码；无授权连真入口也只见伪装页。
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ROBOTS_TAG = "noindex, nofollow, noarchive";

const DECOY = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
    body {
        width: 35em;
        margin: 0 auto;
        font-family: Tahoma, Verdana, Arial, sans-serif;
    }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>`;

function decoy() {
  return new Response(DECOY, {
    status: 200,
    headers: { "Content-Type": "text/html", "Server": "nginx", "X-Robots-Tag": ROBOTS_TAG },
  });
}

function authCookie(key) {
  return "px_auth=" + encodeURIComponent(key) + "; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax";
}

function rewriteHtml(html, turl, base) {
  const toProxy = (u) => {
    if (!u || /^(data:|javascript:|mailto:|tel:|#)/i.test(u)) return u;
    if (base !== "/" && u.startsWith(base)) return u;
    if (base === "/" && /^\/https?:\/\//i.test(u)) return u;
    try { return base + new URL(u, turl).toString(); } catch { return u; }
  };
  html = html.replace(/(href|src|action)\s*=\s*"([^"]*)"/gi, (m, a, u) => a + '="' + toProxy(u) + '"');
  html = html.replace(/(href|src|action)\s*=\s*'([^']*)'/gi, (m, a, u) => a + "='" + toProxy(u) + "'");
  html = html.replace(/(href|src|action)\s*=\s*([^\s"'>]+)/gi, (m, a, u) => a + "=" + toProxy(u));
  html = html.replace(/srcset\s*=\s*"([^"]*)"/gi, (m, s) =>
    'srcset="' + s.split(",").map((p) => {
      const parts = p.trim().split(/\s+/);
      return toProxy(parts[0]) + (parts[1] ? " " + parts[1] : "");
    }).join(", ") + '"');
  return html;
}

export default {
  async fetch(request, env) {
    const KEY = env.PX_KEY;
    if (!KEY) return new Response("not configured", { status: 500 });
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { "Content-Type": "text/plain", "X-Robots-Tag": ROBOTS_TAG },
      });
    }

    // 入口判定：带码入口（种 Cookie）或已授权 Cookie 的 /https 直达入口
    const keyedPrefix = "/" + KEY + "/";
    let base = null, viaKey = false;
    if (path === "/" + KEY || path.startsWith(keyedPrefix)) {
      base = keyedPrefix; viaKey = true;
    } else if (/^\/https?:\/\//i.test(path)) {
      const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)px_auth=([^;]+)/);
      if (m && decodeURIComponent(m[1]) === KEY) base = "/";
    }
    if (base === null) return decoy();

    // 带码根 = 落地页：一个输入框，提交后走 /https 直达（Cookie 已种）
    if (path === "/" + KEY || path === keyedPrefix) {
      const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>px</title>
<body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:0 16px">
<form id="f"><input id="u" type="text" placeholder="https://example.com" autocomplete="off"
 style="width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #bbb;border-radius:8px"></form>
<script>document.getElementById('f').addEventListener('submit',function(e){e.preventDefault();var v=document.getElementById('u').value.trim();if(!v)return;if(!/^https?:\\/\\//i.test(v))v='https://'+v;location.href='/'+v;});</script>`;
      const resp = new Response(page, {
        headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": ROBOTS_TAG },
      });
      resp.headers.append("Set-Cookie", authCookie(KEY));
      return resp;
    }

    let target = path.slice(base.length) + url.search;
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    let turl;
    try { turl = new URL(target); } catch { return decoy(); }

    // 浏览器式请求头（通过率主要靠这一组 + 真实 cookie 回放）
    const headers = new Headers();
    headers.set("User-Agent", UA);
    headers.set("Accept", request.headers.get("Accept") || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8");
    headers.set("Accept-Language", request.headers.get("Accept-Language") || "ja,zh-CN;q=0.9,zh;q=0.8,en;q=0.7");
    headers.set("Referer", turl.origin + "/");
    const cookie = request.headers.get("Cookie");
    if (cookie) headers.set("Cookie", cookie);
    for (const h of ["Content-Type", "Range", "If-None-Match", "If-Modified-Since"]) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    const origin = request.headers.get("Origin");
    if (origin) headers.set("Origin", turl.origin);

    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;

    let resp;
    try { resp = await fetch(turl.toString(), init); }
    catch (e) { return new Response("upstream error: " + e.message, { status: 502 }); }

    const out = new Headers(resp.headers);
    out.delete("Content-Security-Policy");
    out.delete("Content-Security-Policy-Report-Only");
    out.delete("X-Frame-Options");
    out.delete("Strict-Transport-Security");
    out.set("X-Robots-Tag", ROBOTS_TAG);

    const loc = resp.headers.get("Location");
    if (loc) {
      try { out.set("Location", base + new URL(loc, turl).toString()); } catch {}
    }

    // 目标站 Cookie 改写：Domain 去掉、Path 作用域收进本目标站点前缀，避免不同站点互相污染
    const sitePath = base + turl.protocol + "//" + turl.host;
    const setCookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
    if (setCookies.length) out.delete("Set-Cookie");
    for (const c of setCookies) {
      let parts = c.split(";").map((s) => s.trim()).filter((p) => !/^domain=/i.test(p));
      let hasPath = false, hasSecure = false;
      parts = parts.map((p) => {
        if (/^path=/i.test(p)) { hasPath = true; const pv = p.slice(5); return "Path=" + sitePath + (pv.startsWith("/") ? pv : "/" + pv); }
        if (/^samesite=/i.test(p)) return "SameSite=None";
        if (/^secure$/i.test(p)) hasSecure = true;
        return p;
      });
      if (!hasPath) parts.push("Path=" + sitePath + "/");
      if (!hasSecure) parts.push("Secure");
      out.append("Set-Cookie", parts.join("; "));
    }
    if (viaKey) out.append("Set-Cookie", authCookie(KEY));

    const ct = resp.headers.get("Content-Type") || "";
    if (ct.includes("text/html")) {
      out.delete("Content-Length");
      out.delete("Content-Encoding");
      const html = rewriteHtml(await resp.text(), turl, base);
      return new Response(html, { status: resp.status, headers: out });
    }
    return new Response(resp.body, { status: resp.status, headers: out });
  },
};
