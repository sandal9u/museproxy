// px — 极简网页代理（Worker 名 px-nbfun，域名 px.nbfun.com，HTTP 网页代理）
// 对外伪装：根路径与一切无关路径一律返回 nginx 默认欢迎页；robots.txt 全站禁止爬虫。
// 真正入口：https://px.nbfun.com/https/example.com/路径 —— /https（或 /http）后跟不带协议符号的裸网址。
// 授权：未授权访问入口路径先见授权码表单，填对授权码种 30 天 Cookie 后直达；授权码存 Worker Secret（env.PX_KEY），不入代码。
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

function authed(request, key) {
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)px_auth=([^;]+)/);
  return !!(m && decodeURIComponent(m[1]) === key);
}

// 绝对地址 → 代理内路径： https://a.b/c → /https/a.b/c
function proxyPath(abs) {
  const i = abs.indexOf("://");
  if (i < 0) return abs;
  return "/" + abs.slice(0, i) + "/" + abs.slice(i + 3);
}

function unlockPage(next) {
  const esc = next.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorization</title>
<body style="font-family:system-ui;max-width:360px;margin:18vh auto;padding:0 16px">
<form method="POST" action="/auth">
<input type="hidden" name="next" value="${esc}">
<input type="password" name="code" placeholder="授权码" autocomplete="off" autofocus
 style="width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #bbb;border-radius:8px">
<button type="submit" style="width:100%;margin-top:10px;padding:12px;font-size:16px;border:0;border-radius:8px;background:#222;color:#fff">OK</button>
</form>`;
  return new Response(page, {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": ROBOTS_TAG },
  });
}

function inputPage() {
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>px</title>
<body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:0 16px">
<form id="f"><input id="u" type="text" placeholder="https://example.com" autocomplete="off"
 style="width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #bbb;border-radius:8px"></form>
<script>document.getElementById('f').addEventListener('submit',function(e){e.preventDefault();var v=document.getElementById('u').value.trim();if(!v)return;var m=v.match(/^(https?):\\/\\/(.+)$/i);if(m){location.href='/'+m[1].toLowerCase()+'/'+m[2];}else{location.href='/https/'+v;}});</script>`;
  return new Response(page, {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": ROBOTS_TAG },
  });
}

function rewriteHtml(html, turl) {
  const toProxy = (u) => {
    if (!u || /^(data:|javascript:|mailto:|tel:|#)/i.test(u)) return u;
    if (/^\/(https?)\//i.test(u)) return u;
    try { return proxyPath(new URL(u, turl).toString()); } catch { return u; }
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

    // 授权码提交端点：对码 → 种 Cookie → 跳回原目标；错码 → 回解锁页
    if (path === "/auth") {
      if (request.method !== "POST") return decoy();
      const form = new URLSearchParams(await request.text());
      const next = form.get("next") || "/https/";
      if (!/^\/(https?)(\/|$)/i.test(next)) return decoy();
      if (form.get("code") === KEY) {
        const resp = new Response(null, { status: 302, headers: { Location: next } });
        resp.headers.append("Set-Cookie", authCookie(KEY));
        return resp;
      }
      return unlockPage(next);
    }

    // 入口判定：/https/<裸网址> 或 /http/<裸网址>
    const entry = path.match(/^\/(https?)(\/(.*))?$/i);
    if (!entry) return decoy();
    const scheme = entry[1].toLowerCase();
    const rest = entry[3] || "";

    if (!authed(request, KEY)) return unlockPage(path + url.search);
    if (!rest) return inputPage();

    let turl;
    try { turl = new URL(scheme + "://" + rest + url.search); } catch { return decoy(); }

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
      try { out.set("Location", proxyPath(new URL(loc, turl).toString())); } catch {}
    }

    // 目标站 Cookie 改写：Path 作用域收进本目标站点前缀（/https/主机/…），避免不同站点互相污染
    const sitePath = "/" + scheme + "/" + turl.host;
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

    const ct = resp.headers.get("Content-Type") || "";
    if (ct.includes("text/html")) {
      out.delete("Content-Length");
      out.delete("Content-Encoding");
      const html = rewriteHtml(await resp.text(), turl);
      return new Response(html, { status: resp.status, headers: out });
    }
    return new Response(resp.body, { status: resp.status, headers: out });
  },
};
