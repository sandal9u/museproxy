# px — 极简网页代理

独立 Cloudflare Worker，部署在 Datumoj 账户（与 nbfun 生产站分开额度池）。

## 用法

```
https://px.gorou-public.workers.dev/<KEY>/https://目标网址
```

代理前缀后面直接跟原始网址，不做任何编码；也可以打开前缀根地址，粘贴网址回车即走。
链接、图片、表单、重定向、Cookie 都在代理内回转：经代理登录一次，Cookie 按目标站点分别保存在浏览器里（路径作用域隔离），之后再访问不再弹登录/授权。

## 设计口径

- 无 KEY 的请求一律 404，不做开放代理（防盗用刷额度）。
- 出站请求带完整桌面浏览器头（UA / Accept / Accept-Language / Referer），Cookie 由浏览器回放。
- HTML 做属性级改写（href/src/action/srcset）；剥掉目标站的 CSP 与 X-Frame-Options，否则改写后的资源会被目标站自己的策略拦掉。
- 已知边界：重 JS 的单页应用（X、Instagram 一类）与带 JS 人机验证的站点仍可能过不去，属目标站对机房 IP 的硬防，逐站实测为准。

## 部署

push main 即由 GitHub Actions 跑 `deploy.py`（Cloudflare API 直传，不走 wrangler），
Secrets：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`（Datumoj 账户）。

## 额度

Workers 免费版 10 万次请求/日是账户级共池（00:00 UTC 重置），本 Worker 与 datumoj.com
同账户；个人浏览量级（数百至数千次/日）不构成压力，如当日池子异常先查账户用量再说。
