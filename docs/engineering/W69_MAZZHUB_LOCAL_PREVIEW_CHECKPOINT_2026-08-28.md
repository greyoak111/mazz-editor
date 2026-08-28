# W69 MazzHub 本地预览施工检查点（2026-08-28）

## 范围

本检查点把 MazzHub 的公共平面先落成一个可在本机查看的静态预览，覆盖 W69 的产品骨架与 W94G 的公共 Publication / World / Charts 只读投影。当前不连接真实 Hub 数据，不执行发布、撤回、同步或 VPS 写入。

## 本地入口

```text
http://127.0.0.1:4173/
```

启动命令：

```text
npm run preview:hub
```

健康检查：

```text
http://127.0.0.1:4173/healthz
```

健康响应明确标记：`mode=local-fixture`、`publicEffect=disabled`。

## 已落地的页面面

- 发现：编辑精选、正在生长的 Worlds、透明 Charts、公共事件 Feed。
- 作品库：Publication 卡片、类型筛选、全局搜索、公共包络详情。
- Worlds：Root Canon / Authorized Branches / Community Derivatives，以及 Authority Map / Audience Map 说明。
- Charts：Attention value 与 Creation value 分开呈现，保留指标、窗口、公式提示，不生成 Overall Score。
- 创作者：Creator 身份聚合、关注入口。
- 收藏与历史：仅使用浏览器 localStorage 的本地收藏/关注状态，不回传 Hub。
- Creator Studio 预览：以提示方式保留入口，暂不启动写入流程。

## 安全边界

- `hub-web/fixture.json` 只包含公开安全字段：Publication、World、Creator、Chart 与事件投影。
- 页面不读取本地路径、密钥、草稿、私有上下文或服务器凭据。
- 本地预览服务器只绑定 `127.0.0.1`，只提供 `GET/HEAD`，没有发布 API。
- Public Effect 保持关闭；本波不操作 `167.160.161.115`、`www.mazz-hub.com` 或任何 VPS 数据。

## 已执行核验

1. `package.json` JSON 解析通过。
2. `node --check hub-web/app.js` 通过。
3. `node --check server/mazz-hub-preview.js` 通过。
4. `/healthz` 返回 `200` 与 `mazz.hub-preview-health/v1`。
5. 浏览器首屏截图核验通过：公共平面、预览边界、Publication、World、Charts、Feed 均可见。
6. 浏览器交互核验通过：作品库搜索、Charts 页面、收藏进入本地空间、Publication 公共包络、Worlds、创作者页面。

## 下一波（不在本检查点内）

- 将 fixture 替换为本地公共快照读取器，并保留同一套 envelope/schema 边界。
- 接入可验证的内容清单与 receipt 历史；继续保持 public write 默认关闭。
- 再讨论账号态关注、真实资源路由、P2P/HTTP/LAN/NAS 选择，不在本地预览波次越界实现。
