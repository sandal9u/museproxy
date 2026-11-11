// px — 极简网页代理（Worker 名 px-nbfun，域名 px.nbfun.com，HTTP 网页代理）
// 对外伪装：根路径与一切无关路径一律返回 nginx 默认欢迎页；robots.txt 全站禁止爬虫。
// 真正入口：https://px.nbfun.com/https/example.com/路径 —— /https（或 /http）后跟不带协议符号的裸网址。
// 授权：全站无表单、无弹窗、无校验端点——浏览器在入口页的框里输码（拼进地址重开，对了种 Cookie 并跳到干净地址，错了还是同一个框，无从穷举）；控制台靠请求头/pxk。授权码存 Worker Secret（env.PX_KEY），不入代码。
// 出站 User-Agent 池：10 组常见 UA，按目标站点固定取一（同站恒定、异站分散；2026-11-11 用户定）
const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.103 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
];
const pickUA = (host) => {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  return UAS[h % UAS.length];
};
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

// 三种授权通道共用同一授权码：浏览器 Cookie（表单解锁后）/ 请求头 X-Px-Key / 查询参数 pxk（后两者给控制台用）
function authed(request, key, pxk) {
  if (pxk !== null && pxk === key) return true;
  if (request.headers.get("X-Px-Key") === key) return true;
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)px_auth=([^;]+)/);
  return !!(m && decodeURIComponent(m[1]) === key);
}

// 绝对地址 → 代理内路径： https://a.b/c → /https/a.b/c
function proxyPath(abs) {
  const i = abs.indexOf("://");
  if (i < 0) return abs;
  return "/" + abs.slice(0, i) + "/" + abs.slice(i + 3);
}

// 入口页上的输码框：不设校验端点、不回对错——输的内容只是拼进本页地址重新打开，
// 对了服务端种 Cookie 并 302 到去掉参数的干净地址，对错看到的都是这同一个框，无法当穷举神谕用。
function keyPage() {
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>px</title>
<body style="font-family:system-ui;max-width:360px;margin:18vh auto;padding:0 16px">
<input id="k" type="text" autocomplete="off" autofocus
 style="width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #bbb;border-radius:8px">
<script>var k=document.getElementById('k');k.addEventListener('keydown',function(e){if(e.key!=='Enter')return;var v=k.value.trim();if(!v)return;var q=location.search.replace(/([?&])pxk=[^&]*&?/,'$1').replace(/&$/,'');var sep=q?'&':'?';location.href=location.pathname+q+sep+'pxk='+encodeURIComponent(v);});</script>`;
  return new Response(page, {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": ROBOTS_TAG },
  });
}

function inputPage() {
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>px</title>
<body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:0 16px">
<textarea id="p" rows="5" readonly style="width:100%;box-sizing:border-box;padding:12px;font:13px/1.7 ui-monospace,Menlo,Consolas,monospace;border:1px solid #c9c2b2;border-radius:8px;background:#f7f3ea;resize:none;cursor:pointer">${PROMPT_TEXT.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</textarea>
<div id="done" style="color:#1a7f37;font-size:13px;height:18px;margin:4px 0 10px"></div>
<input id="u" type="text" placeholder="https://example.com" autocomplete="off"
 style="width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #bbb;border-radius:8px">
<script>var p=document.getElementById('p');p.addEventListener('click',function(){function ok(){var d=document.getElementById('done');d.textContent='已复制';setTimeout(function(){d.textContent='';},2000);}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(p.value).then(ok,function(){p.select();document.execCommand('copy');ok();});}else{p.select();document.execCommand('copy');ok();}});
var u=document.getElementById('u');u.focus();u.addEventListener('keydown',function(e){if(e.key!=='Enter')return;var v=u.value.trim();if(!v)return;var m=v.match(/^(https?):\\/\\/(.+)$/i);if(m){location.href='/'+m[1].toLowerCase()+'/'+m[2];}else{location.href='/https/'+v;}});</script>`;
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

const PROMPT_TEXT = [
  "浏览器：打开 https://px.nbfun.com/https/<目标网址> 经代理抓取。",
  "输 key：需要授权码时，拉起安全保险库里 px 的录入卡让用户输入，不要让用户在聊天里发明文。",
  "控制台：从安全保险库的 px 取 key，以请求头 X-Px-Key 调用，例如 curl -H \"X-Px-Key: <key>\" \"https://px.nbfun.com/https/example.com/\"。"
].join("\n");

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

    // 入口判定：/https/<裸网址> 或 /http/<裸网址>；全站无表单、无 POST 解锁，未授权只见伪装页
    const entry = path.match(/^\/(https?)(\/(.*))?$/i);
    if (!entry) return decoy();
    const scheme = entry[1].toLowerCase();
    const rest = entry[3] || "";

    // pxk 是我方授权参数：验完即从转发给目标站的查询串里摘掉，目标站看不见
    const params = new URLSearchParams(url.search);
    const pxk = params.get("pxk");
    if (pxk !== null) params.delete("pxk");
    const rest2 = params.toString();
    const fwdSearch = rest2 ? "?" + rest2 : "";
    const plantCookie = pxk !== null && pxk === KEY;
    const isBrowser = (request.headers.get("Accept") || "").includes("text/html");

    if (pxk !== null && isBrowser) {
      if (plantCookie) {
        const resp = new Response(null, {
          status: 302,
          headers: { Location: path + fwdSearch, "X-Robots-Tag": ROBOTS_TAG },
        });
        resp.headers.append("Set-Cookie", authCookie(KEY));
        return resp;
      }
      return keyPage();
    }
    if (!authed(request, KEY, pxk)) return isBrowser ? keyPage() : decoy();
    if (!rest) {
      const page = inputPage();
      if (plantCookie) page.headers.append("Set-Cookie", authCookie(KEY));
      return page;
    }

    let turl;
    try { turl = new URL(scheme + "://" + rest + fwdSearch); } catch { return decoy(); }

    // 浏览器式请求头（通过率主要靠这一组 + 真实 cookie 回放）
    const headers = new Headers();
    headers.set("User-Agent", pickUA(turl.hostname));
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
    if (plantCookie) out.append("Set-Cookie", authCookie(KEY));

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
