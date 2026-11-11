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
<div style="display:flex;gap:8px">
<input id="k" type="text" placeholder="请输入key" autocomplete="off" autofocus
 style="flex:1;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #bbb;border-radius:8px">
<button id="b" style="padding:12px 18px;font-size:16px;border:1px solid #bbb;border-radius:8px;background:#fff">确认</button>
</div>
<script>var k=document.getElementById('k');function go(){var v=k.value.trim();if(!v)return;var q=location.search.replace(/([?&])pxk=[^&]*&?/,'$1').replace(/[?&]$/,'');var sep=q?'&':'?';fetch(location.pathname+q+sep+'pxk='+encodeURIComponent(v),{headers:{'X-Px-Unlock':'1','Accept':'text/html'}}).then(function(){location.replace(location.pathname+q);},function(){location.replace(location.pathname+q);});}k.addEventListener('keydown',function(e){if(e.key==='Enter')go();});document.getElementById('b').addEventListener('click',go);</script>`;
  return new Response(page, {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": ROBOTS_TAG },
  });
}

function inputPage(host) {
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>px</title>
<body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:0 16px">
<p style="font-size:14px;margin:0 0 8px">点击框复制到个人代理</p>
<textarea id="p" rows="12" readonly style="width:100%;box-sizing:border-box;padding:12px;font:13px/1.7 ui-monospace,Menlo,Consolas,monospace;border:1px solid #c9c2b2;border-radius:8px;background:#f7f3ea;resize:none;overflow:hidden;cursor:pointer">${promptText(host).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</textarea>
<div id="done" style="color:#1a7f37;font-size:13px;height:18px;margin:4px 0 10px"></div>
<input id="u" type="text" placeholder="https://example.com" autocomplete="off"
 style="width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #bbb;border-radius:8px">
<script>var p=document.getElementById('p');function fit(){p.style.height='auto';p.style.height=p.scrollHeight+'px';}fit();window.addEventListener('resize',fit);p.addEventListener('click',function(){function ok(){var d=document.getElementById('done');d.textContent='已复制';setTimeout(function(){d.textContent='';},2000);}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(p.value).then(ok,function(){p.select();document.execCommand('copy');ok();});}else{p.select();document.execCommand('copy');ok();}});
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

// 提示词里的域名不写死：按来访请求的 host 现拼（谁部署的就显示谁的域名）
const promptText = (host) => [
  "如果需要抓取网页的时候请走以下方式",
  "浏览器：打开 https://" + host + "/https/<目标网址> 经代理抓取。",
  "输 key：需要授权码时，拉起安全保险库里 px 的录入卡让用户输入，不要让用户在聊天里发明文。",
  "控制台：从安全保险库的 px 取 key，以请求头 X-Px-Key 调用，例如 curl -H \"X-Px-Key: <key>\" \"https://" + host + "/https/example.com/\"。"
].join("\n");

// ===== /paste 临时中转站 =====
// R2 存储、单一目录列表式呈现；每个文件按自身上传时间起 30 分钟销毁（定时扫除＋读取时惰性过期）。
// 防滥用三层：复用 px 授权码把门；站内硬顶（件数／总量／单文件）截断洪水；清理只管正常周转。
const PASTE_TTL_MS = 30 * 60 * 1000;
const PASTE_MAX_FILES = 200;
const PASTE_MAX_TOTAL = 1024 * 1024 * 1024;
const PASTE_MAX_FILE = 100 * 1024 * 1024;

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const humanSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? (n / 1024).toFixed(1) + " KB" : n + " B");
const pasteAge = (o) => Date.now() - new Date(o.uploaded).getTime();
const pasteRemainMin = (o) => Math.max(0, Math.ceil((PASTE_TTL_MS - pasteAge(o)) / 60000));
const pasteExpired = (o) => pasteAge(o) > PASTE_TTL_MS;
const htmlResp = (html, status = 200) => new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": ROBOTS_TAG } });
const jsonResp = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "X-Robots-Tag": ROBOTS_TAG } });
const textResp = (s, status = 200) => new Response(s, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": ROBOTS_TAG } });

function sanitizeName(name) {
  const s = String(name || "").split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f?#%<>"|]/g, "_").trim().slice(0, 100);
  return s || "file";
}
// 命名一律用 Unix 时间戳（秒）：文件为 <ts>-<原名>，自动命名的文本为 text-<ts>.md；撞名时 ts 递增
async function tsFileName(env, orig) {
  let ts = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 1000; i++) {
    const cand = ts + "-" + orig;
    if (!(await env.PASTE.head(cand))) return cand;
    ts++;
  }
  return ts + "-" + orig;
}
async function tsTextName(env) {
  let ts = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 1000; i++) {
    const cand = "text-" + ts + ".md";
    if (!(await env.PASTE.head(cand))) return cand;
    ts++;
  }
  return "text-" + ts + ".md";
}
async function listAllPaste(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.PASTE.list({ limit: 1000, cursor, include: ["customMetadata"] });
    out.push(...r.objects);
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out;
}
function pastePage(objs) {
  const rows = objs.map((o) =>
    '<div class="row"><a class="nm" href="/paste/' + encodeURIComponent(o.key) + '">' + escHtml(o.key) +
    '</a><span class="meta">' + humanSize(o.size) + ' · 剩 ' + pasteRemainMin(o) +
    ' 分钟</span><button class="del" data-k="' + escHtml(o.key) + '">删除</button></div>'
  ).join("\n");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>paste · 临时中转站</title>
<body>
<div class="wrap">
<h1>临时中转站</h1>
<p class="sub">每个文件按上传时间起 30 分钟自动销毁 · 共 ${objs.length} / ${PASTE_MAX_FILES} 个</p>
<div class="card">
<textarea id="t" rows="4" placeholder="粘贴文本到这里"></textarea>
<div class="line"><input id="n" type="text" placeholder="文本文件名（可空）"><button id="bt" class="btn">存文本</button></div>
<div id="dz"><span id="fn">点这里选文件，或把文件拖进来</span></div>
<input id="f" type="file" hidden>
<div class="line" style="justify-content:flex-end"><button id="bf" class="btn">传文件</button></div>
<p id="msg"></p>
</div>
<div class="card">
${rows || '<p class="empty">目录是空的。</p>'}
</div>
</div>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f7f3ea;color:#26241f;margin:0}
.wrap{max-width:720px;margin:5vh auto;padding:0 16px 40px}
h1{font-size:22px;margin:0 0 4px}
.sub{color:#8a8378;font-size:13px;margin:0 0 18px}
.card{background:#fff;border:1px solid #e7e0cd;border-radius:14px;padding:16px;margin:0 0 16px;box-shadow:0 2px 10px rgba(90,80,50,.06)}
textarea{width:100%;padding:11px 12px;border:1px solid #ddd5c0;border-radius:10px;font-size:15px;background:#fffdf7;resize:vertical}
textarea:focus,.line input[type=text]:focus{outline:2px solid #b7a86b;border-color:transparent}
.line{display:flex;gap:8px;margin-top:10px}
.line input[type=text]{flex:1;padding:10px 12px;border:1px solid #ddd5c0;border-radius:10px;font-size:15px;background:#fffdf7;min-width:0}
.btn{background:#26241f;color:#fff;border:none;border-radius:10px;padding:10px 20px;font-size:15px;cursor:pointer;white-space:nowrap}
.btn:active{opacity:.75}
#dz{margin-top:14px;border:1.5px dashed #cfc5a6;border-radius:10px;padding:20px 12px;text-align:center;color:#8a8378;font-size:14px;background:#fffdf7;cursor:pointer}
#dz.over{border-color:#b7a86b;color:#26241f}
#msg{color:#b3261e;font-size:14px;min-height:20px;margin:10px 0 0}
.row{display:flex;gap:10px;align-items:center;padding:11px 2px;border-top:1px solid #f0ead8}
.row:first-child{border-top:none;padding-top:2px}
.nm{flex:1;word-break:break-all;color:#26241f;text-decoration:none;font-size:15px}
.nm:hover{text-decoration:underline}
.meta{color:#8a8378;font-size:13px;white-space:nowrap}
.del{background:none;border:1px solid #e0d9c4;color:#8a8378;border-radius:8px;padding:5px 10px;font-size:13px;cursor:pointer;white-space:nowrap}
.del:active{color:#b3261e;border-color:#b3261e}
.empty{color:#8a8378;margin:4px 0}
</style>
<script>
var msg = document.getElementById('msg');
function send(fd) { fetch('/paste', { method: 'POST', body: fd }).then(function (r) { return r.json(); }).then(function (j) { if (j.ok) { location.reload(); } else { msg.textContent = j.error || '上传失败'; } }).catch(function () { msg.textContent = '上传失败'; }); }
document.getElementById('bt').addEventListener('click', function () { var t = document.getElementById('t').value; if (!t) { msg.textContent = '文本是空的'; return; } var fd = new FormData(); fd.set('text', t); var n = document.getElementById('n').value.trim(); if (n) fd.set('name', n); send(fd); });
document.getElementById('bf').addEventListener('click', function () { var f = document.getElementById('f').files[0]; if (!f) { msg.textContent = '先选文件'; return; } var fd = new FormData(); fd.set('file', f); send(fd); });
var fi = document.getElementById('f'), dz = document.getElementById('dz'), fn = document.getElementById('fn');
function showName() { if (fi.files[0]) fn.textContent = fi.files[0].name; }
dz.addEventListener('click', function () { fi.click(); });
fi.addEventListener('change', showName);
dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files.length) { try { fi.files = e.dataTransfer.files; } catch (err) {} showName(); } });
document.querySelectorAll('.del').forEach(function (b) { b.addEventListener('click', function () { fetch('/paste/' + encodeURIComponent(b.getAttribute('data-k')), { method: 'DELETE' }).then(function () { location.reload(); }); }); });
</script>`;
}

const gonePage = (m) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>paste</title><body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:0 16px;background:#f7f3ea;color:#222"><p>${escHtml(m)}</p><p><a href="/paste">返回目录</a></p>`;

function servePasteFile(obj, sub) {
  // 不强制下载：浏览器能解析的（图片/PDF/文本等）直接显示，解析不了的才下载；filename* 给浏览器作保存名（原名）
  const orig = (obj.customMetadata && obj.customMetadata.name) || sub.replace(/^\d+-/, "");
  const headers = new Headers({ "X-Robots-Tag": ROBOTS_TAG });
  obj.writeHttpMetadata(headers);
  if (!headers.get("Content-Type")) headers.set("Content-Type", "application/octet-stream");
  headers.set("Content-Disposition", "inline; filename*=UTF-8''" + encodeURIComponent(orig));
  return new Response(obj.body, { headers });
}

async function handlePaste(request, env, KEY, url, sub) {
  const isBrowser = (request.headers.get("Accept") || "").includes("text/html");
  const pxk = url.searchParams.get("pxk");
  if (pxk !== null && isBrowser) {
    if (request.headers.get("X-Px-Unlock") === "1") {
      const resp = new Response(null, { status: 200, headers: { "X-Robots-Tag": ROBOTS_TAG } });
      if (pxk === KEY) resp.headers.append("Set-Cookie", authCookie(KEY));
      return resp;
    }
    if (pxk === KEY) {
      const resp = new Response(null, { status: 302, headers: { Location: url.pathname, "X-Robots-Tag": ROBOTS_TAG } });
      resp.headers.append("Set-Cookie", authCookie(KEY));
      return resp;
    }
    return keyPage();
  }
  // 文件下载凭地址即可、不用 key（目录列表、上传、删除仍要 key 把门）
  if (sub && request.method === "GET") {
    const obj0 = await env.PASTE.get(sub);
    if (obj0 && !pasteExpired(obj0)) return servePasteFile(obj0, sub);
    if (obj0) await env.PASTE.delete(sub);
  }
  if (!authed(request, KEY, pxk)) return isBrowser ? keyPage() : decoy();

  if (!sub) {
    if (request.method === "GET") {
      const objs = (await listAllPaste(env)).sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
      return htmlResp(pastePage(objs));
    }
    if (request.method === "POST") {
      let fd;
      try { fd = await request.formData(); } catch { return jsonResp({ error: "需要 multipart 上传" }, 400); }
      const file = fd.get("file");
      const text = fd.get("text");
      let body, origName, kind, ctype, size, autoText = false;
      if (file && typeof file === "object" && file.name) {
        size = file.size;
        if (size > PASTE_MAX_FILE) return jsonResp({ error: "单个文件不能超过 100 MB" }, 413);
        body = file; origName = sanitizeName(file.name); kind = "file";
        ctype = file.type || "application/octet-stream";
      } else if (typeof text === "string" && text.length > 0) {
        size = new TextEncoder().encode(text).length;
        if (size > PASTE_MAX_FILE) return jsonResp({ error: "文本不能超过 100 MB" }, 413);
        let nm = sanitizeName(String(fd.get("name") || ""));
        if (fd.get("name") && !nm.includes(".")) nm += ".md";
        autoText = !fd.get("name");
        body = text; origName = nm; kind = "text"; ctype = "text/markdown; charset=utf-8";
      } else {
        return jsonResp({ error: "没有内容" }, 400);
      }
      const objs = await listAllPaste(env);
      if (objs.length >= PASTE_MAX_FILES) return jsonResp({ error: "站内文件已满（200 个），等过期后再传" }, 429);
      const total = objs.reduce((s, o) => s + o.size, 0);
      if (total + size > PASTE_MAX_TOTAL) return jsonResp({ error: "站内总量已满（1 GB）" }, 429);
      const stored = autoText ? await tsTextName(env) : await tsFileName(env, origName);
      if (autoText) origName = stored;
      await env.PASTE.put(stored, body, { httpMetadata: { contentType: ctype }, customMetadata: { kind, name: origName } });
      return jsonResp({ ok: true, name: stored });
    }
    return new Response("method not allowed", { status: 405 });
  }

  // curl 上传：PUT /paste/<文件名>，原始请求体即文件内容，回纯文本给出最终链接
  if (request.method === "PUT") {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > PASTE_MAX_FILE) return textResp("单个文件不能超过 100 MB\n", 413);
    const objs = await listAllPaste(env);
    if (objs.length >= PASTE_MAX_FILES) return textResp("站内文件已满（200 个），等过期后再传\n", 429);
    const total = objs.reduce((s, o) => s + o.size, 0);
    if (total + buf.byteLength > PASTE_MAX_TOTAL) return textResp("站内总量已满（1 GB）\n", 429);
    const orig = sanitizeName(sub);
    const stored = await tsFileName(env, orig);
    const ctype = request.headers.get("Content-Type") || "application/octet-stream";
    const kind = ctype.startsWith("text/plain") ? "text" : "file";
    await env.PASTE.put(stored, buf, { httpMetadata: { contentType: ctype }, customMetadata: { kind, name: orig } });
    return textResp("ok\n" + url.origin + "/paste/" + encodeURIComponent(stored) + "\n");
  }
  if (request.method === "DELETE") {
    await env.PASTE.delete(sub);
    return jsonResp({ ok: true });
  }
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  const obj = await env.PASTE.get(sub);
  if (!obj) return htmlResp(gonePage("文件不存在或已被清除"), 404);
  if (pasteExpired(obj)) {
    await env.PASTE.delete(sub);
    return htmlResp(gonePage("文件已过期，已清除"), 410);
  }
  return servePasteFile(obj, sub);
}

export default {
  async fetch(request, env) {
    const KEY = env.PX_KEY;
    if (!KEY) return new Response("not configured", { status: 500 });
    const url = new URL(request.url);
    const path = url.pathname;

    const pasteMatch = path.match(/^\/paste(?:\/(.*))?$/);
    if (pasteMatch) {
      if (!env.PASTE) return new Response("paste not configured", { status: 500 });
      let sub = "";
      try { sub = decodeURIComponent(pasteMatch[1] || ""); } catch { sub = ""; }
      return handlePaste(request, env, KEY, url, sub);
    }

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
      // 页内解锁（输码框 fetch 发起）：无论对错都回 200、不跳转，地址栏永远不出现 pxk；对了才种 Cookie
      if (request.headers.get("X-Px-Unlock") === "1") {
        const resp = new Response(null, { status: 200, headers: { "X-Robots-Tag": ROBOTS_TAG } });
        if (plantCookie) resp.headers.append("Set-Cookie", authCookie(KEY));
        return resp;
      }
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
      const page = inputPage(url.host);
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

  // 定时扫除（唯一的定时器）：每 10 分钟醒一次，只删上传已满 30 分钟的文件
  async scheduled(event, env, ctx) {
    if (!env.PASTE) return;
    const objs = await listAllPaste(env);
    const expired = objs.filter(pasteExpired).map((o) => o.key);
    for (let i = 0; i < expired.length; i += 1000) {
      await env.PASTE.delete(expired.slice(i, i + 1000));
    }
    if (expired.length) console.log("paste sweep: deleted " + expired.length);
  },
};
