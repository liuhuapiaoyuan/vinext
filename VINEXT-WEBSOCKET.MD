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
import { createWebSocketHub, type VinextWebSocketHandler } from "vinext/server/websocket";

const hub = createWebSocketHub();

export const WEBSOCKET: VinextWebSocketHandler = ({ socket, params }) => {
  const connection = hub.register(socket);
  const room = `room:${params.room ?? "default"}`;
  connection.join(room);

  socket.addEventListener("message", (event) => {
    const data = typeof event.data === "string" ? event.data : event.data.toString("utf8");
    void hub.group(room).except(connection).sendJson({
      type: "broadcast",
      room: params.room,
      message: data,
    });
  });
};

export function GET() {
  return Response.json({ ok: true });
}
```

## Pages Router 示例

文件：`pages/api/ws/[room].ts`

```ts
import { createWebSocketHub, type VinextWebSocketHandler } from "vinext/server/websocket";

const hub = createWebSocketHub();

export const websocket: VinextWebSocketHandler = ({ socket, params }) => {
  const connection = hub.register(socket);
  const room = `room:${params.room ?? "default"}`;
  connection.join(room);

  connection.onMessage((event) => {
    const data = typeof event.data === "string" ? event.data : event.data.toString("utf8");
    void hub.group(room).except(connection).sendJson({
      type: "broadcast",
      room: params.room,
      message: data,
    });
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

- `socket` — 底层连接，支持 `send()` / `close()` / `ping()` / `addEventListener("message", ...)`
- `request` — Web 标准 `Request`，用于读取 headers、鉴权信息等
- `nodeRequest` — Node `IncomingMessage`，只在确实需要 Node 原始请求时使用
- `params` — 动态路由参数（如 `[room]` → `params.room`）
- `url` — 完整请求 URL（含 query）

## Hub：单播、多播、Group

推荐用 `createWebSocketHub()` 管理连接、用户、房间和广播，不要在业务代码里重复维护 `Map<string, Set<WebSocket>>`。

```ts
import { createWebSocketHub, type VinextWebSocketHandler } from "vinext/server/websocket";

type ClientMeta = {
  role: "user" | "admin";
};

const hub = createWebSocketHub<ClientMeta>();

export const WEBSOCKET: VinextWebSocketHandler = ({ socket, params, request }) => {
  const userId = request.headers.get("x-user-id") ?? crypto.randomUUID();
  const connection = hub.register(socket, {
    id: crypto.randomUUID(), // 可省略；默认自动生成
    userId,
    meta: { role: "user" },
  });

  const room = `room:${params.room ?? "default"}`;
  connection.join(room);

  void hub.user(userId).sendJson({ type: "connected", connectionId: connection.id });
  void hub.group(room).except(connection).sendJson({ type: "joined", userId });

  connection.onMessage((event) => {
    const message = typeof event.data === "string" ? event.data : event.data.toString("utf8");
    void hub.group(room).except(connection).sendJson({ type: "message", userId, message });
  });
};
```

常用发送方式：

```ts
await hub.connection("connection-id").send("单播到一个连接");
await hub.user("user-id").sendJson({ type: "notice" }); // 发给该用户的所有连接
await hub.group("room:123").sendJson({ type: "room-message" });
await hub.group("room:123").except(connection).sendJson({ type: "room-message" });
await hub.group("room:123").except("connection-id").sendJson({ type: "room-message" });
await hub.send(
  {
    connectionIds: ["connection-a"],
    userIds: ["user-b"],
    groups: ["room:123", "tenant:acme"],
  },
  "多目标发送会自动去重",
);
await hub.broadcastJson({ type: "global" });
```

`send()` / `sendJson()` 默认先投递本进程连接，再通过 adapter 发布给其他进程。只想投递当前进程时传 `localOnly: true`：

```ts
await hub.group("room:123").sendJson({ type: "local" }, { localOnly: true });
```

`send()` / `sendJson()` 返回当前进程的发送报告：

```ts
const report = await hub.group("room:123").sendJson({ type: "ping" });
// { attempted, sent, skipped, failed, failures, published }
```

`published` 表示本次发送是否成功发布到 adapter。跨进程收到 envelope 后的远端投递不计入当前进程的 `sent`。

连接与索引：

- `hub.register(socket, { id, userId, meta })` 注册连接；`id` 可省略，默认自动生成。
- `connection.id` 是单连接 ID；`userId` 可绑定同一用户的多个标签页或设备。
- `connection.join(group)` / `leave(group)` / `leaveAll()` 管理 Group。
- `connection.groups` 是当前连接加入的 Group 集合。
- 连接关闭时，Hub 会自动清理 connection、user、group 索引。
- `hub.close(code?, reason?)` 会取消 adapter 订阅、关闭本进程所有连接并清理索引。

## Adapter：跨进程广播

默认 Hub 是进程内内存实现。多 Node 进程、多副本部署时，必须配置 adapter，把发送 envelope 发布到 Redis、NATS 等 pub/sub 系统。

Adapter 协议只负责 pub/sub，不保存 socket：

```ts
import {
  createWebSocketHub,
  type VinextWebSocketHubAdapter,
} from "vinext/server/websocket";

const adapter: VinextWebSocketHubAdapter = {
  async publish(envelope) {
    await redis.publish("vinext:websocket", JSON.stringify(envelope));
  },
  async subscribe(listener) {
    const subscriber = redis.duplicate();
    await subscriber.connect();
    await subscriber.subscribe("vinext:websocket", (message) => {
      void listener(JSON.parse(message));
    });
    return async () => {
      await subscriber.unsubscribe("vinext:websocket");
      await subscriber.quit();
    };
  },
};

export const hub = createWebSocketHub({ adapter });
```

NATS 也使用同一协议：`publish(envelope)` 发送 JSON，`subscribe(listener)` 收到 JSON 后调用 `listener(envelope)`。Hub 会自动忽略本进程发出的 envelope，并在本进程连接索引中完成目标投递。

Envelope 结构：

```ts
type VinextWebSocketHubEnvelope = {
  id: string;
  sourceId: string;
  target: {
    all?: boolean;
    connectionIds?: readonly string[];
    userIds?: readonly string[];
    groups?: readonly string[];
  };
  data:
    | { type: "text"; data: string }
    | { type: "binary"; data: string }; // base64
  exceptConnectionIds?: readonly string[];
};
```

跨进程语义：

- `connectionIds`、`userIds`、`groups` 在所有进程上按本地连接索引匹配。
- 多目标发送按连接 ID 去重。
- 默认是 at-most-once 投递；adapter 不做持久化、ack 或重试。
- `except(connection)` / `except("connection-id")` 会随 envelope 传播，用于排除指定连接 ID。
- 本进程发送不会经过 envelope 序列化；只有跨进程 adapter 消息会把二进制数据编码成 base64。
- adapter 收到坏消息或投递出错时，Hub 会调用 `onAdapterError`；未配置时输出错误日志。

可配置 adapter 错误处理：

```ts
export const hub = createWebSocketHub({
  adapter,
  onAdapterError(error, envelope) {
    console.error("WebSocket adapter failed", { error, envelope });
  },
});
```

## Origin 配置（可选）

默认只允许同源浏览器升级。跨域需在 `vite.config.ts` 配置：

```ts
vinext({
  webSocket: {
    allowedOrigins: ["https://example.com"], // 或 true 表示允许任意 Origin
  },
});
```
