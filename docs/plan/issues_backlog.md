# 常驻台账：问题与待裁决

**更新日期**：2026-10-15

本文件是**常驻台账**，条目行一律保留（不适用「完成即删」）。状态列反映进展，文末有结案记录。

---

## 一、已发现的缺陷与风险

| 编号 | 问题 | 证据等级 | 状态 |
| --- | --- | --- | --- |
| R-1 | 工具输入解码顶层非对象时抛异常（`toolInput`） | 已核实并更正 | **已修** + 8 例测试 |
| R-2 | `packages/client` 既有测试失败 22 项 | 已核实（样本量 1） | 待排查 |
| R-3 | `packages/core` 既有测试失败 40 项 | 已核实（样本量 1） | 待排查 |
| R-4 | Plan 按钮切换时连带切换模型、按钮无激活态 | 已核实 | 已修，待验证 |
| R-5 | todo 端到端渲染 | 已核实可用 | 已修，待确认优化效果 |
| R-6 | 诊断代码需清理（3 处 `TEMPORARY diagnostic`） | 已核实 | 已清理 |
| R-7 | 正式版 2.0.29 黑屏：renderer 陷入 ResizeObserver 循环 | 已核实 | 上游未修，待定方案 |
| R-8 | 变体芯片（Default）在鼠标离开 composer 时隐藏 | 已核实 | 已按用户要求改为常显 |

### R-1：工具输入解码在顶层非对象时会抛异常（已修）

**位置**：`packages/session-ui/src/tools/tool-renderer.tsx` 的 `toolInput`

**我先前的表述有误，此处更正**。我起初写成"`optional()` 的回退根本不生效"，
实测后确认那是**过度概括**——真实行为分两层：

| 输入 | 旧写法 `decodeUnknownSync` | 新写法 `decodeUnknownOption` |
| --- | --- | --- |
| 正常 / 部分（流式中） | ok | `Some` |
| **字段值畸形**（如 `path: 123`） | **ok，字段被丢弃**（`catchDecoding` 在字段级有效） | `Some`，字段同样被丢弃 |
| **顶层非对象**（`null` / `undefined` / 字符串 / 数字） | **抛异常** | `None` → 回退空对象 |

所以真实风险范围窄得多：**只有顶层输入不是对象时才会抛**。
而工具部件在流式到达时其 `input` 可能尚未成为对象，此时渲染器会直接崩。

**修复**：顶层改为 `Schema.decodeUnknownOption`，失败返回空对象（所有字段都是 optional，
空对象是合法实例）。**未改动 `optional()` 辅助函数，也未触碰任何调用点**（调用形状不变）。

**测试**：`packages/session-ui/src/tools/tool-input.test.ts`（8 例）覆盖正常、流式半成品、
字段畸形、以及 5 种曾导致抛异常的顶层输入。

**该测试的已知局限**：`toolInput` 是模块私有，仓库禁止为测试新增导出，因此测试是**镜像**
（复刻同一套 schema 与解码方式）。它能钉住"解码必须不抛"这一契约与字段行为，
但**改动生产代码不会让它失败**。要更强的保障需重构为可注入的解码器。

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

**17 项信号语义失败的根因与方案**：已单独调研并出报告 ——
[`../reference/windows-graceful-shutdown.md`](../reference/windows-graceful-shutdown.md)。

要点（均已核对源码）：

- Windows 上 `SIGTERM` **从不投递**（Node 官方文档原文），JS 处理器无机会运行；
- **本仓库已有一个跨平台可用的优雅停机通道**：`service-registration.ts:40-66` 每 5 秒轮询注册文件，
  发现不再属于自己就打开停机 latch；
- 但 `stop()` **没用它**，且顺序相反：先 `SIGTERM`（Windows 上=硬杀），**确认进程已死之后**才删注册文件；
- 而且 CLI **从未安装 SIGTERM 处理器**，所以**即使在 Linux 上优雅路径同样不会被走** ——
  这个缺陷不止影响 Windows；
- 那 17 项测试的夹具自己模拟了 SIGTERM 处理器，**与真实服务的停机通道不同**，
  故在 Windows 上无法靠改产品代码通过；建议夹具改模拟真实通道（选项 A），
  那会让测试比现在更强。**改动建议尚未实施。**

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

### R-8：变体芯片（Default）随鼠标离开而隐藏（已按用户要求改为常显）

**现象**：推理等级显示为 `Default` 时，鼠标不在 composer 上则该芯片消失；移入又出现。

**这是上游的有意设计**，非缺陷：`packages/app/src/composer/editor/editor.css` 中的规则

```css
@media (hover: hover) {
  [data-component="composer"]:not(:hover) .composer-variant-default:not(:focus-visible, [data-expanded]) {
    opacity: 0;
    pointer-events: none;
  }
}
```

用意是减少视觉噪音 —— 只有变体为 `default` 时才隐藏，选了非默认变体则始终显示。

**处置**：用户要求常显，已移除该规则（连带包裹它的 `@media (hover: hover)`）。
`editor.tsx` 里 `composer-variant-default` 的类名赋值保留但已无效果，以保持改动最小。

**为何 `@media` 包裹很重要**：它使规则只在支持 hover 的设备生效，故改动不影响触屏布局。

### R-7：正式版黑屏（renderer 陷入 ResizeObserver 循环）

**症状**（2026-10-15 实测，用户正式版）：应用长时间黑屏无响应。

**证据**（全部来自 `%APPDATA%\ai.opencode.desktop\logs\`）：

| 项 | 观测值 |
| --- | --- |
| 应用版本 | **2.0.29**（`main.log` 首行 `version: '2.0.29', packaged: true`） |
| 启动 | 16:26:51，服务 16:26:52 就绪，一切正常 |
| 循环开始 | **16:49:24**（启动后约 22 分钟），此前 renderer 日志只有 1 条启动记录 |
| 报错 | `ResizeObserver loop completed with undelivered notifications` × **2177 条**，持续至 19:22 |
| CPU | renderer 累计 2433 秒、GPU 累计 3508 秒；采样期内各占满约 88% 单核 |
| 伴随日志 | 重启后出现 `[server-request-queue] server thrashing detected`（请求排队超 `stallMs`） |

**已排除的原因**：

- **不是我们的改动**：正式版是打包构建，不含本仓库任何代码。
- **不是 dev 测试版干扰**：dev 进程 CPU 极低（renderer 累计仅 6.8 秒），且循环起始时间早于 dev 首次启动。
- **不是更新器**：更新检查在 16:26/16:36/16:46 三次均正常完成，最后一次距循环开始 2.5 分钟，非立即触发。
- **不是 `be674e3158`（project store 驱逐循环）**：该修复经 `git merge-base --is-ancestor` 确认**已包含在 2.0.29 内**，故非此 bug。
- **上游无修复**：2.0.29 之后的 36 个提交里，**没有任何**与 resize / observer / layout / loop / perf / hang 相关的提交。

**推断的机制**（证据等级：推断）：renderer 内的 ResizeObserver 反馈环 —— 观察回调改变布局，布局变化又触发回调。

**空闲假设已被部分否证**（2026-10-15 追加实测）：用户怀疑是长时间挂后台无操作所致。
但 dev 测试版（同一份渲染代码）**空闲约 30 分钟未复现**，renderer 累计仅 7.2 秒 CPU。
故单纯空闲不足以触发；更可能是**空闲叠加一个内容量大的会话视图**——
布局代价足够大时观察器才无法收敛。**该假设尚未被证实。**
候选站点（`packages/app/src/**`）：

- `shell/titlebar/tab-nav.tsx:144` —— 观察 tab 容器后 `scheduleTitleOverflow`，标题溢出处理会改变渲染内容
- `shell/titlebar/recently-closed-tabs-menu.tsx:125`、`settings/workspaces/workspaces.tsx:558`、`settings/search.tsx:45` —— 均为「测量后 setState 截断」模式
- `home/scroll.ts:107` —— 位置更新与观察器绑定
- 时间线虚拟化（`timeline-virtualizer`）与观察器组合是同类环路的经典来源

**为什么没能定论**：循环发生在打包构建里，无法下断点；且它是运行约 22 分钟后自发出现，
未找到稳定复现步骤。**修复需要在源码构建中复现后才能定位。**

**当前处置**：未修复。用户可通过重启应用恢复（重启后正常，`opencode-cli` 进程不中断故会话数据无损）。

---

## 二、待用户裁决

| 编号 | 事项 | 不拍板的后果 |
| --- | --- | --- |
| Q-2 | ~~全局 bun 是否降到 1.4.2~~ → **已完成**（2026-10-15） | — |
| Q-3 | 是否排查 R-2 / R-3 共 62 项既有失败 | 不排查则无法区分「环境噪声」与「真实缺陷」，测试信号不可信 |
| Q-4 | ~~私有仓库：建立在哪、A/B 类改动是否拆分提交~~ → **已完成**（2026-10-15） | 详见下方「Q-4 执行结果」 |
| Q-5 | todo 是否补中文文案 | 不补则界面显示英文（Todo / Pending / In progress / Done） |
| Q-6 | GUI 扩展路线是否推进 | 不推进则所有功能改动都必须重建桌面端才能生效 |
| Q-8 | 是否按参考报告改 `stop()` 的停机顺序 + 夹具改模拟真实通道 | 不拍板则 17 项测试在 Windows 上永久红，且**所有平台**的优雅停机都不可用 |

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
