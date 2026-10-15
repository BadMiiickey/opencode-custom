# 主计划 — sst/opencode 定制版（测试版）

**更新日期**：2026-10-15
**代码基线**：`sst/opencode` v2.0.28，commit `c5aabae`（仓库自带 `AGENTS.md`，改动前先读它）
**本机位置**：`C:\Users\28974\sst-opencode`
**桌面端快捷方式**：`C:\Users\28974\Desktop\OpenCode 测试版.lnk`

---

## 目标

在私有测试版里做三件事，并把经验固化：

1. 修掉阻挡开发的上游缺陷（dev 模式起不来）；
2. 加自用功能（todo list、Plan 模式切换）；
3. 把工具链与验证流程沉淀成可复现的环境。

**非目标**：不向开源上游提 PR（用户裁定：私用自有仓库，不需要开源）。

---

## 当前状态

| 组件 | 状态 | 简述 | 详情 |
| --- | --- | --- | --- |
| 环境与工具链 | ✅ 可用 | Go/Bun/Electron 装好，dev 桌面端可从源码启动 | [`environment_plan.md`](environment_plan.md) |
| 服务探测修复 | ✅ 已验证 | 上游缺陷：通配地址被代理拦截导致 dev 起不来 | [`service-probe_plan.md`](service-probe_plan.md) |
| todo 功能 | 🔶 待实机确认观感 | 工具 + `/todo` 命令 + 提醒注入 + 时间线渲染 + **常驻面板**均实现并有测试 | [`todo_plan.md`](todo_plan.md) |
| Plan 模式切换 | ✅ 已验证 | 用户实测：激活态明显，切模式后模型保持不变 | [`plan-mode_plan.md`](plan-mode_plan.md) |
| 服务优雅停机 | ✅ 已实施 | 撤回注册优先于信号；client 全量失败 13 → 0 条 | [`../reference/windows-graceful-shutdown.md`](../reference/windows-graceful-shutdown.md) |
| 测试套件健康度 | ✅ 大幅改善 | app / session-ui / client 全绿；core 剩 26 项环境类既有失败 | [`issues_backlog.md`](issues_backlog.md) |

图例：✅ 已验证 · 🔶 待验证/进行中 · ❌ 阻塞

---

## 已完成工作索引

| 日期 | 成果 | 证据 |
| --- | --- | --- |
| 2026-10-13 | Go 仓库（`opencode-ai/opencode`）构建通过 | `opencode.exe` 58.2 MB，`go vet` 干净 |
| 2026-10-13 | sst/opencode 依赖安装 + CLI 构建出 12 平台产物 | `packages/cli/dist/<target>/bin/opencode[.exe]`，200–226 MB |
| 2026-10-14 | 修好 dev 桌面端启动（通配地址归一化） | 服务就绪由「120s 后必然失败」变为 5s（本地实测） |
| 2026-10-14 | todo 工具 + 渲染链路重建 | `packages/core/src/tool/plugin/todo.ts` |
| 2026-10-15 | todo 渲染崩溃修复 | `decodeUnknownOption` 替换抛异常的 `optional()` |
| 2026-10-15 | 新增测试 30 例全绿 | core 16 · session-ui 7 · client 7 |
| 2026-10-15 | 环境修正脚本 `script/local-test.ps1` | core 既有失败 46 → 26 条（TEMP / SHELL_SCAN_PWSH / 超时三项修正） | 
| 2026-10-15 | 服务优雅停机：撤回注册优先于信号 | client 全量失败 13 → 4 → **0**（同命令全量对照，消除 11 条） |
| 2026-10-15 | 常驻 todo 面板（折叠 + 组件 + 接线 + 6 例测试） | app 全量 **752 pass / 0 fail** |
| 2026-10-15 | 契约断言修复 · R-1 解码器 · 变体芯片常显 | 权威校验 `bun run check` **36/36 exit 0** |

---

## 参考文档

- [`../reference/kimi-code.md`](../reference/kimi-code.md) — MoonshotAI/kimi-code 调研与逐项对比（含 todo 链路、web 端模式、4 条候选改进）

---

## 组件计划一览（一句话）

- **环境与工具链**：全局 bun 需从 1.4.3 降到仓库锁定的 1.4.2；符号链接工作区已用 `skip-worktree` 处理。
- **服务探测修复**：已完成，等决定是否随私有仓库固化。
- **todo 功能**：功能齐备，等用户端到端验证后收尾并清理诊断代码。
- **Plan 模式切换**：需先回收诊断输出，才能区分「按钮未渲染」与「切换无效」两种根因。
- **测试套件健康度**：先排查 62 项既有失败，再评估是否值得全绿。

---

## 待用户裁决

见 [`issues_backlog.md`](issues_backlog.md) 的「待裁决」小节。
