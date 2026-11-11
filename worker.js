// px — 极简网页代理
// 用法: https://px.gorou-public.workers.dev/<KEY>/https://目标网址
// 代理前缀后面直接跟原始网址，不编码。无 KEY 一律 404，不做开放代理。
// 授权码不写在代码里：部署时由 Actions Secret PX_KEY 注入为 Worker Secret（env.PX_KEY）。
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function proxyUrl(abs, key) {
  return "/" + key + "/" + abs;
}

function rewriteHtml(html, turl, key) {
  const toProxy = (u) => {
    if (!u || /^(data:|javascript:|mailto:|tel:|#)/i.test(u)) return u;
    try { return proxyUrl(new URL(u, turl).toString(), key); } catch { return u; }
  };
  html = html.replace(/(href|src|action)\s*=\s*"([^"]*)"/gi, (m, a, u) => a + '="' + toProxy(u) + '"');
  html = html.replace(/(href|src|action)\s*=\s*'([^']*)'/gi, (m, a, u) => a + "='" + toProxy(u) + "'");
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
    const PREFIX = "/" + KEY + "/";
    const url = new URL(request.url);

    // 落地页：只有一个输入框，粘贴网址即走代理
    if (url.pathname === "/" + KEY || url.pathname === PREFIX) {
      const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>px</title>
<body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:0 16px">
<form id="f"><input id="u" type="text" placeholder="https://example.com" autocomplete="off"
 style="width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #bbb;border-radius:8px"></form>
<script>document.getElementById('f').addEventListener('submit',function(e){e.preventDefault();var v=document.getElementById('u').value.trim();if(!v)return;if(!/^https?:\\/\\//i.test(v))v='https://'+v;location.href='${PREFIX}'+v;});</script>`;
      return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (!url.pathname.startsWith(PREFIX)) {
      return new Response("not found", { status: 404 });
    }

    let target = url.pathname.slice(PREFIX.length) + url.search;
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    let turl;
    try { turl = new URL(target); } catch { return new Response("bad url", { status: 400 }); }

    // 浏览器式请求头（过率主要靠这一组 + 真实 cookie 回放）
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

    const loc = resp.headers.get("Location");
    if (loc) {
      try { out.set("Location", proxyUrl(new URL(loc, turl).toString(), KEY)); } catch {}
    }

    // Cookie 改写：Domain 去掉、Path 作用域收进本目标站点的前缀路径，避免不同站点互相污染
    const sitePath = PREFIX + turl.protocol + "//" + turl.host;
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
      const html = rewriteHtml(await resp.text(), turl, KEY);
      return new Response(html, { status: resp.status, headers: out });
    }
    return new Response(resp.body, { status: resp.status, headers: out });
  },
};
