# update

自动合并 `upstream/main` 到本 fork，用于完成升级。

## 流程

1. `git fetch upstream main`（必要时同时 fetch origin）
2. 对比 `main` 与 `upstream/main` 的 ahead/behind 与 merge-base
3. 若工作区有未提交改动：先 stash（或提示用户），再继续
4. 从最新 `main` 创建分支：`chore/merge-upstream-YYYY-MM-DD`
5. `git merge upstream/main`，提交信息风格：`chore(upstream): merge upstream main`
6. 保留 fork 侧已知差异（如 `@qzsy/vinext` 包名、发布流程、fork 专属修复），同时吸收 upstream 功能与修复
7. 合并后跑相关检查 / 测试；需要发布时再走 Changesets，不要手改版本硬发

## 冲突处理原则

- **可自动决策**：纯上游 bugfix/feat、与 fork 包名/CI/发布无关的文件 → 倾向取 upstream，或按上次 merge 惯例保留 fork packaging
- **无法决策时必须停下询问**：业务语义冲突、同一逻辑两边都改过且意图不明、删除 vs 保留、版本/changeset/发布相关冲突、不确定会破坏 fork 行为的改动
- 不要强行猜；询问时说明冲突文件、双方意图、可选方案
