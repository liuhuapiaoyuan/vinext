# release

本 fork（`@qzsy/vinext`）本地 maintainer 发布流程。按步骤执行；出错就修，修完继续发，直到发布成功。

## 原则

- **只做小版本 bump**：几乎永远不要升 major。当前为 prerelease（如 `1.0.0-beta.0.12`）时，只递增末段（→ `1.0.0-beta.0.13`）；稳定版则只升 patch（`x.y.z` → `x.y.(z+1)`），除非用户明确要求 minor。
- **唯一允许的发布命令**：`vp exec changeset publish`（或等价的 `node scripts/publish.mts`）。禁止 `npm publish` / `pnpm publish` / 手传 `dist/`。
- 发布前确认工作区可发布状态；发布失败先修根因，再重试同一命令，不要换发布入口。

## 流程

### 1. 确认当前版本

读取 `packages/vinext/package.json` 的 `name` / `version`（应为 `@qzsy/vinext`）。

### 2. 小版本 bump

编辑 `packages/vinext/package.json` 的 `version`：

| 当前形态         | 操作                                                   |
| ---------------- | ------------------------------------------------------ |
| `1.0.0-beta.0.N` | `N → N+1`（例：`1.0.0-beta.0.12` → `1.0.0-beta.0.13`） |
| `x.y.z`（稳定）  | 默认 `z → z+1`；仅当用户明确要求时才升 `y`             |
| major            | **默认不做**；用户未明确要求时拒绝并说明               |

不要改无关字段；不要手改其他包版本，除非本次发布范围明确包含它们。

### 3. 发布

```bash
vp exec changeset publish
```

若仓库存在 `.changeset/pre.json` 且上游脚本要求把 beta 发到 `latest`，也可：

```bash
node scripts/publish.mts
```

二者择一，优先与用户指令一致；用户说 `vp exec changeset publish` 就用该命令。

### 4. 出错则修复并继续

发布失败时：

1. 读完整报错（缺 build、未登录 npm、版本已存在、changeset 状态、权限、网络等）
2. **修根因**，例如：
   - 未构建 → `vp run vinext#build`（或仓库约定的 pack/build）后再发
   - npm 未登录 / OTP → 提示用户登录或提供 OTP，不要伪造凭据
   - 版本号已占用 → 再小幅递增 `version` 后重试
   - changeset / pre 状态异常 → 按报错修复，不要改用 `npm publish`
3. 修复后**再次**执行同一发布命令，直到成功
4. 不要中途放弃或换禁止的发布方式

### 5. 发布后（若成功）

- 确认 npm 上已出现新版本
- 若 publish 产生了 git tag / 版本相关变更，提示用户是否需要 commit / push（**不要擅自 push**，除非用户明确要求）

## 禁止

- 擅自 major bump
- `npm publish` / `pnpm publish` / 绕过 Changesets
- 发布失败后跳过修复硬换发布方式
- 未确认就 force push 或改 git config
