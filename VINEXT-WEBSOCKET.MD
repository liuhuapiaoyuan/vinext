# Vinext WebSocket 用法

Node dev / Node prod 同端口支持 WebSocket。Cloudflare Workers 暂不支持。

## 文件位置与导出名称

| 路由类型 | 文件位置 | 导出名称 |
| -------- | -------- | -------- |
| App Router | `app/**/route.ts`（或 `.tsx` / `.js`） | `WEBSOCKET`（大写） |
| Pages Router | `pages/api/**`（如 `pages/api/ws.ts`、`pages/api/ws/[room].ts`） | `websocket`（小写） |

路由路径由文件系统决定，与 HTTP route 相同。例如：

- `app/api/ws/route.ts` → `/api/ws`
- `app/api/ws/[room]/route.ts` → `/api/ws/:room`
- `pages/api/ws.ts` → `/api/ws`
- `pages/api/ws/[room].ts` → `/api/ws/:room`

## App Router 示例

文件：`app/api/ws/[room]/route.ts`

```ts
import type { VinextWebSocketHandler } from "vinext/server/websocket";

export const WEBSOCKET: VinextWebSocketHandler = ({ socket, params, url }) => {
  socket.addEventListener("message", (event) => {
    const data = typeof event.data === "string" ? event.data : event.data.toString("utf8");
    socket.send(`${params.room}:${data}`);
  });
};

export function GET() {
  return Response.json({ ok: true });
}
```

## Pages Router 示例

文件：`pages/api/ws/[room].ts`

```ts
import type { VinextWebSocketHandler } from "vinext/server/websocket";

export const websocket: VinextWebSocketHandler = ({ socket, params }) => {
  socket.addEventListener("message", (event) => {
    const data = typeof event.data === "string" ? event.data : event.data.toString("utf8");
    socket.send(`echo:${params.room}:${data}`);
  });
};

export default function handler(_req, res) {
  res.status(200).json({ ok: true });
}
```

## 客户端连接

与 HTTP 共用同一 host 和 port：

```ts
const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${protocol}//${location.host}/api/ws/room-name`);
```

## Handler 参数

```ts
({ socket, request, nodeRequest, params, url }) => { ... }
```

- `socket` — 发送/接收消息，`send()` / `close()` / `addEventListener("message", ...)`
- `params` — 动态路由参数（如 `[room]` → `params.room`）
- `url` — 完整请求 URL（含 query）

## Origin 配置（可选）

默认只允许同源浏览器升级。跨域需在 `vite.config.ts` 配置：

```ts
vinext({
  webSocket: {
    allowedOrigins: ["https://example.com"], // 或 true 表示允许任意 Origin
  },
});
```
