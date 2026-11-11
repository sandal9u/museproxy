# px — 极简网页代理

独立 Cloudflare Worker `px-nbfun`，部署在 nbfun 账户，自定义域名 px.nbfun.com（用户指定的子域名例外）。
一切变更只走本仓库的 GitHub Actions 部署，不手工操作 Worker。

## 用法

```
https://px.nbfun.com/https/example.com/路径
```

/https（或 /http）后跟不带协议符号的裸网址，不做任何编码。
全站无表单、无弹窗、无校验端点（刷新不弹重提交提示）：浏览器打开入口先见一个输码框，
把授权码输进去回车即可——不做对错校验、不设专门端点，输对了服务端种下 30 天 Cookie
并跳到去掉参数的干净地址直达目标，输错了还是同一个框（无从穷举）；根路径与无关路径仍是 nginx 伪装页。
链接、图片、表单、重定向、Cookie 都在代理内回转：经代理登录一次，Cookie 按目标站点分别保存在浏览器里（路径作用域隔离），之后再访问不再弹登录/授权。

控制台（curl / 脚本）用同一授权码，不依赖 Cookie，二选一：

```
curl -H "X-Px-Key: <授权码>" "https://px.nbfun.com/https/example.com/"
curl "https://px.nbfun.com/https/example.com/?pxk=<授权码>"
```

pxk 参数验完即摘除，不会转发给目标站。

## 伪装与禁爬

- 根路径与一切无关路径一律返回 nginx 默认欢迎页（200），不暴露代理存在；只有 /https、/http 入口路径会出授权码表单。
- robots.txt 全站 `Disallow: /`，所有响应带 `X-Robots-Tag: noindex, nofollow, noarchive`。

## 设计口径

- 无 KEY 的请求一律 404，不做开放代理（防盗用刷额度）。
- 授权码不写在代码里：由 Actions Secret `PX_KEY` 在部署时注入为 Worker Secret，仓库公开也无妨；换码只需改 Secret 后重新部署，旧链接立即失效。
- 出站请求带完整桌面浏览器头（UA / Accept / Accept-Language / Referer），Cookie 由浏览器回放。
- HTML 做属性级改写（href/src/action/srcset）；剥掉目标站的 CSP 与 X-Frame-Options，否则改写后的资源会被目标站自己的策略拦掉。
- 已知边界：重 JS 的单页应用（X、Instagram 一类）与带 JS 人机验证的站点仍可能过不去，属目标站对机房 IP 的硬防，逐站实测为准。

## 部署

push main 即由 GitHub Actions 跑 `deploy.py`（Cloudflare API 直传，不走 wrangler），
Secrets：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`（nbfun 账户）、`PX_KEY`。
部署脚本同时绑定自定义域名 px.nbfun.com（Workers Domains API）。

## 额度

Workers 免费版 10 万次请求/日是账户级共池（00:00 UTC 重置），本 Worker 与 nbfun.com
同账户共池；个人浏览量级（数百至数千次/日）不构成压力，如当日池子异常先查账户用量再说。
