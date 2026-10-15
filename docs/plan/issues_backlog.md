# 常驻台账：问题与待裁决

**更新日期**：2026-10-15

本文件是**常驻台账**，条目行一律保留（不适用「完成即删」）。状态列反映进展，文末有结案记录。

---

## 一、已发现的缺陷与风险

| 编号 | 问题 | 证据等级 | 状态 |
| --- | --- | --- | --- |
| R-1 | `tool-renderer.tsx` 的 `optional()` 辅助函数回退失效 | 已核实 | 待处理 |
| R-2 | `packages/client` 既有测试失败 22 项 | 已核实（样本量 1） | 待排查 |
| R-3 | `packages/core` 既有测试失败 40 项 | 已核实（样本量 1） | 待排查 |
| R-4 | Plan 按钮切换时连带切换模型、按钮无激活态 | 已核实 | 已修，待验证 |
| R-5 | todo 端到端渲染 | 已核实可用 | 已修，待确认优化效果 |
| R-6 | 诊断代码需清理（3 处 `TEMPORARY diagnostic`） | 已核实 | 已清理 |

### R-1：`optional()` 辅助函数的 catch 回退根本不生效

**位置**：`packages/session-ui/src/tools/tool-renderer.tsx`

```ts
function optional(schema) {
  const field = Schema.optional(schema)
  return Schema.catchDecoding<typeof field>(() => Effect.succeed(Option.none()))(field)
}
```

**实测行为**（本地实测，session-ui 测试运行，bun 1.4.2）：传入畸形输入
（`{todos: "not a list"}`、`null`、缺字段、非法枚举值）**照样抛异常**；
只有 `undefined` 能返回 undefined。

**影响面**：所有使用 `toolInput(...)` 的渲染器在遇到畸形工具输入时存在同样风险。
正常路径不触发，所以长期未暴露。**这是本次 todo 渲染崩溃的同源问题。**

**未处理原因**：影响面大、超出当前需求。修复方向是改用 `Schema.decodeUnknownOption`，
但需评估所有调用点。

### R-2 / R-3：既有测试失败

**测量口径**：`bun 1.4.2`，本地全量运行，**单次采样，未做重复运行统计**。样本量为 1。

判定为「既有」的方法：用 `git stash` 移开自己的改动后对比失败名单集合，
**集合完全一致（新增 0、消失 0）**。（首次对比时误把含耗时的整行当作比较键，
导致结论无效；修正为剥离 `[NNNms]` 后缀后才得到有效结论。）

`packages/core` 的 40 项全部带环境特征：PowerShell 语法用例、Git/Vcs worktree、
`Npm.add` 的 git 包安装、**符号链接用例**（本机建链接需管理员权限）。

`packages/client` 的 22 项多为 5 秒超时型服务测试，另有 4 项疑似 codegen/边界问题：
`exposes every standard HTTP API group`、`public import boundaries`、
`session methods use the public HTTP contract`、`session methods retain decoded Effect inputs and outputs`。

**怀疑但未证实**：服务类失败可能与本机 HTTP 代理（7897）有关。**证据等级：推断。**

### R-4：Plan 按钮的两个缺陷（2026-10-15 诊断确认）

用户提供的诊断输出：切换前 `plan=Y vis=false cur=build opt=build|plan`，
切换后 `plan=Y vis=false cur=plan opt=build|plan`。

**结论：切换本身是生效的**，被诊断为两个独立缺陷：

| 缺陷 | 机制 | 修复 |
| --- | --- | --- |
| 按钮无激活态 | 只加了 `text-text-strong`，在 `ghost-faint` 上看不出差别 | 激活时改用 `variant="outline"` + `aria-pressed` |
| 切换连带切模型 | `agent.set()` 会应用该 agent 记住的模型（`selection.tsx:418` 的设计行为），用于模式切换时不合适 | `toggle()` 先记下当前模型，切完 agent 再 `model.set()` 还原 |

用户反馈：`Exo Free` → `Cat Jam Free`，即模型被换掉了。

### R-6：诊断代码已清理

`model.ts` 的 `view.debug`、`interaction.ts` 的 `debug` 类型、`editor.tsx` 的诊断行与
`console.log` 三处均已删除，零命中验证通过。

---

## 二、待用户裁决

| 编号 | 事项 | 不拍板的后果 |
| --- | --- | --- |
| Q-2 | ~~全局 bun 是否降到 1.4.2~~ → **已完成**（2026-10-15） | — |
| Q-3 | 是否排查 R-2 / R-3 共 62 项既有失败 | 不排查则无法区分「环境噪声」与「真实缺陷」，测试信号不可信 |
| Q-4 | ~~私有仓库：建立在哪、A/B 类改动是否拆分提交~~ → **已完成**（2026-10-15） | 详见下方「Q-4 执行结果」 |
| Q-5 | todo 是否补中文文案 | 不补则界面显示英文（Todo / Pending / In progress / Done） |
| Q-6 | GUI 扩展路线是否推进 | 不推进则所有功能改动都必须重建桌面端才能生效 |

### Q-4 的补充事实

改动分三类，性质不同：

- **A 类 · 上游缺陷修复** —— `packages/client/src/service-probe.ts` 的通配地址归一化；
- **B 类 · 定制功能** —— todo 工具与插件、Plan 模式按钮；
- **C 类 · 纯环境修复** —— 两个 `custom-elements.d.ts`（已 `skip-worktree`，**不进版本库**）。

上游仓库规矩（其 `AGENTS.md`）：base 分支 `dev`、PR 目标 `dev`、分支名最多三词无斜杠。
但本仓库当前停在 `main` 的 v2.0.28 快照上。

### Q-4 执行结果（2026-10-15）

| 项 | 值 |
| --- | --- |
| 仓库 | `github.com/BadMiiickey/opencode-custom`（**private**） |
| 分支 | `dev`（保留上游命名，便于日后与 `upstream` 比对） |
| remote | `origin` = 我们的仓库；`upstream` = `sst/opencode` |
| 提交 | `47a53ce` A 类修复 · `7ec4268` todo · `1a613f9` Plan 按钮 · `1ec0f84` 文档 |
| 克隆深度 | **浅克隆**（54 提交）。如需完整历史，可在仓库内跑 `git fetch --unshallow` |

**拆分依据**：A 类是上游缺陷修复、B 类是定制功能，性质不同，故分开提交；
B 类内部再按功能（todo / Plan 按钮）拆分，便于单独回退。
`packages/ui/src/i18n/en.ts` 同时含两组文案，通过分阶段编辑分别归入对应提交。

---

## 三、决策记录（按时间倒序，只追加不改）

| 日期 | 事项 | 裁定 | 影响 |
| --- | --- | --- | --- |
| 2026-10-15 | Q-2 全局 bun 降级 | **执行**（已验证） | 全局 bun 由 1.4.3 降为 1.4.2；`packages/app` 单测恢复可执行 |
| 2026-10-15 | Q-7 todo 常驻面板数据来源 | **路线 A · 折叠历史**（从消息历史折出最后一次 `todowrite` 调用；不完整存储） | 面板可开工，不新增状态存储 |
| 2026-10-15 | 参考 kimi-code 的改进 1/2/3 | **批准**，待实施 | 陈旧提醒 / `todos` 改可选 / 参与 compaction 进入 [`todo_plan.md`](todo_plan.md) |
| 2026-10-15 | 改进 4（常驻面板） | **批准形态，数据来源已定** | 见 Q-7 裁定 |
| 2026-10-14 | Tab 键位方案 | **放弃**，改为按钮 | 见 [`plan-mode_plan.md`](plan-mode_plan.md) |
| 2026-10-14 | 是否向开源上游提 PR | **不提**，私用自有仓库 | 见 Q-4 |
| 2026-10-14 | todo 中文文案 | **暂缓**，先调通功能 | 见 Q-5 |
| 2026-10-14 | GUI 扩展路线 | **暂缓** | 见 Q-6 |

### Q-7 已裁定方案（路线 A）的说明

**要解决的问题**：现在每次 `todowrite` 调用在时间线里追加一块清单，长任务调用多次后，
看"当前还剩什么"需要往上翻找最后一次。常驻面板要在固定位置显示**当前**清单、原地更新。

**裁定理由（用户原话意）**：todo 的本意是提醒用户和模型总体计划，没必要完整存储。

**路线 A 的做法**：从消息历史里折出**最后一次** `todowrite` 调用作为「当前状态」，
不新建独立的 todo 文档实体。**代价**：与 compaction 的交互需验证。

**已否决的路线 B**：照搬 kimi-code 的「每 agent 一个 todo 文档（`todoId='todo'`）独立持久化」——
它依赖 kimi-code 的**实体化 transcript** 模型（todo 是跳出消息序列的文档），
而我们的 v2 是消息-部件模型，硬套要新建一套存储与一致性面。

---

## 四、待用户提供的信息（阻塞推进）

| 编号 | 需要什么 | 状态 |
| --- | --- | --- |
| I-1 | Plan 按钮诊断输出 | ✅ 已提供（2026-10-15），催生 R-4 的修复 |
| I-2 | todo 端到端验证 | ✅ 已提供（2026-10-15）：显示正常、命令与提示词均正常，待优化 |

---

## 五、已结案

| 编号 | 事项 | 结案说明 |
| --- | --- | --- |
| C-1 | 桌面端 dev 模式无法启动 | 根因是 HTTP 代理拦截通配地址探测；已修并验证。详见 [`service-probe_plan.md`](service-probe_plan.md) |
| C-2 | 展开 todo 详情即崩溃 | 渲染器误用 `optional()` 解错形状导致每次抛异常；已改用 `decodeUnknownOption` |
| C-3 | 键位切换 Plan 模式无效 | 根因是 `agentsVisible` 为 false 导致命令被禁用，非键位问题；方案改为按钮 |
| C-4 | `packages/app` 单测全部失败 | bun 1.4.3 回归；改用仓库锁定的 1.4.2 |
| C-5 | `spawn bun ENOENT` | npm 的 bun 只有 shim 无 `.exe`；已把真实二进制目录加入 PATH |
| C-6 | 符号链接导致 typecheck 报 TS1128 | 57 个链接被检出成文本文件；已对 2 个关键文件用真实内容覆盖 + `skip-worktree` |
| C-7 | 新增工具打破 core 的 golden 工具清单断言 | `location-layer.test.ts` 两处精确工具名清单已同步 |
| C-8 | todo 未完成项的标记显示为 `*` | 曾把 `collapse` 图标当作状态标记；`status`/`status-active` 实为分栏布局图标，**均不可用**。已改为按 `timeline-separator.tsx:56` 的既有惯例用 CSS 画点（`rounded-full bg-current` + `text-text-faint/accent`） |
| C-9 | 台账文档被我连续编辑改乱 | 决策表混入 Q-7 行、要点被合并；已整份重写并做结构核查 |
