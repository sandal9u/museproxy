# 给 Muse 的提示词：px 网页代理用法

- 入口：`https://px.nbfun.com/https/<目标裸网址>`（/https 后不带 `://`；http 站用 /http/）。例：`https://px.nbfun.com/https/example.com/`
- 授权码：读环境变量 `PX_KEY`（在本机 `~/.px.env`，用前 `set -a; . ~/.px.env; set +a`）。浏览器与控制台都读这一个变量。绝不把码写进代码、记忆或任何回复明文。
- 控制台：`curl -H "X-Px-Key: $PX_KEY" "https://px.nbfun.com/https/example.com/"`，或地址后拼 `?pxk=$PX_KEY`（目标自带 ? 参数时用 `&pxk=`）。
- 浏览器：首次打开任意入口页，在输码框里输入 $PX_KEY 回车即种 Cookie（30 天），之后免输；未授权时入口只回输码框、其他路径是 nginx 伪装页，属正常，不要误判为故障。
- 特性：页面内链接、Cookie、重定向自动在代理内回转；经代理登录目标站一次，登录态由代理侧 Cookie 保管，之后不再弹登录/授权。
- 已知边界：Google（.com/.co.jp）必被 /sorry 人机验证拦（Cloudflare 机房 IP 信誉问题，换头换 Cookie 无效），搜索改用 Bing 或 DuckDuckGo（实测可通）；Bloomberg、StackOverflow、BBC、Mercari、纽约时报等约一成站点有同类 IP 信誉墙；重 JS 的单页应用可能不完整。2026-11-11 实测 101 站约七成直通（原始数据 ~/workspace/px-test-100/results.csv）。
- 额度：与 nbfun.com 同账户共用 Workers 免费额度池（10 万次请求/日，09:00 JST 重置），个人量级使用没问题，禁止批量滥刷。
- 换码：以 Cloudflare 面板（nbfun 账户 → Workers → px-nbfun → 设置 → 变量和机密 → PX_KEY）为准，改完同步更新 ~/.px.env。
