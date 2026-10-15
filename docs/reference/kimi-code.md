# 参考报告：MoonshotAI/kimi-code 调研与对比

**日期**：2026-10-15
**调研对象**：`github.com/MoonshotAI/kimi-code`（MIT，TypeScript/pnpm monorepo）
**本地快照**：`C:\Users\28974\kimi-code`，浅克隆 30 提交，4420 文件
**对比对象**：`sst/opencode` v2.0.28（本机测试版）

> **证据等级说明**：本报告的事实来自两条途径 ——
> ① **亲测复核**（我在本地克隆上直接读文件/跑命令验证）；
> ② **子代理报告**（由两个 explore 子代理产出，均带 `file:line` 引用，但**我未逐条亲测**）。
> 下文对②类标注「未亲测」。抽查复核了 6 条关键事实，**全部与子代理报告一致**。

---

## 一、核心问题

用户要求：详细调研 kimi-code 的实现技术细节与逻辑，与本项目测试版比对；并参考其 **web 端模式**。

动机（用户原话）：todo 功能的接口参照了 kimi-code 的 `packages/transcript/src/model/todo.ts`，但该文件只给了接口定义，
"逻辑和 UI 需要你自己找"。因此需要把 kimi-code 的**完整链路**摸清，判断我们的实现是否走偏、有哪些可直接借鉴。

---

## 二、关键结论

**结论 1：kimi-code 的 todo 是「跳出消息序列的文档」，不是「每次调用的快照」。**

每 agent 只有一个 todo 文档，`todoId` 硬编码为 `'todo'`（**亲测**：`packages/kap-server/src/services/transcript/coreEventMap.ts:1752`）。
全文只有这一处实体 id，不存在"每次调用一个快照"。

**我们的实现是每次调用一个快照**（`todoId` 取 sessionID），语义不同 —— 这是最重要的差异，见第四节。

**结论 2：数据来源与我们一致 —— 都是模型调用的工具，不是文本解析、不是 UI 动作。**

工具名 `TodoList`（kimi-code） vs `todowrite`（我们）。写入语义都是**整体替换**（**亲测**：`todoListTool.ts:61` 的 `await this.todo.replace(next)`）。

**结论 3：输入契约有一处实质差异 —— kimi-code 的 `todos` 是可选字段。**

```ts
// 亲测：packages/agent-core-v2/src/features/todo/tools/todo-list/todo-list.ts
export const TodoListInputSchema = z.object({
  todos: z.array(TodoItemSchema).optional().describe(
    'The updated todo list. Omit to read the current todo list without making changes. Pass an empty array to clear the list.',
  ),
})
```

**省略 = 读取当前清单，`[]` = 清空**。我们的实现里 `todos` 是必填，模型没有"只读"能力。

**结论 4：kimi-code 有一个我们没有的机制 —— 陈旧提醒（staleness reminder）。**

写完清单后经过 **5 步**若未更新，注入提醒；之后每 **5 步**再提醒一次
（**亲测**：`packages/agent-core-v2/src/features/todo/todoListReminder.ts:7-8` 的
`TODO_LIST_REMINDER_STEPS_SINCE_WRITE = 5` 与 `TODO_LIST_REMINDER_STEPS_BETWEEN_REMINDERS = 5`）。

我们的 hook **只在用户提到 todo list 时触发** —— 模型跑到一半就会忘记更新清单。

**结论 5：UI 形态不同 —— 常驻面板 vs 时间线内联。**

kimi-code 的 TUI 是**独立常驻面板**（Ctrl+T 展开），最多显示 **5** 条
（**亲测**：`apps/kimi-code/src/tui/components/chrome/todo-panel.ts:26` 的 `MAX_VISIBLE = 5`），
用 `●/✓/○` 标记状态、完成项加删除线、超出部分显示隐藏计数（未亲测：渲染细节由子代理报告）。
并且**全部完成时自动隐藏**（未亲测）。

我们是时间线内联 —— 长会话里清单会散落在各处，看不到"当前状态"。

**结论 6：kimi-code 的 web 模式是「同一个二进制同时是 TUI 和服务器」。**

`kimi web` 在**当前进程内**起 Fastify 服务器（默认 `127.0.0.1:58627`），
把已构建的 SPA（`apps/kimi-code/dist-web`）作为静态资产服务，token 放在 URL **fragment** 里打开浏览器
（未亲测：由子代理报告，含 `run.ts:378-406`、`webAssets.ts:14-112` 等引用）。

**关键结构性事实（未亲测）**：该 SPA 的**源码不在本仓库** —— 构建产物被 force-add 进 git，
源码在另一个仓库 `code-app`，本仓库只保留 `scripts/sync:web` 同步脚本。所以仓库内没有 web 端渲染器可读。

---

## 三、技术原理

### 3.1 kimi-code 的 transcript 分层（未亲测，子代理报告）

`packages/transcript` 自我描述为四层：
「agent 粒度的 L1 store、幂等的 L2 操作、按粒度门控的 L3 订阅、无框架依赖的 L4 视图注册」。

与消息式 transcript 的差异：

| 维度 | kimi-code（未亲测） | 普通消息 transcript |
| --- | --- | --- |
| 建模单位 | **实体**：帧 4 种、条目 3 种，另有跳出流的实体映射（task/interaction/attachment/todo/prompt/meta） | 消息 |
| 更新语义 | **幂等操作**（`todo.upsert` 整体替换文档） | 追加 |
| 归属 | todo 是 **agent 级、会话级**，不与 turn 关联 | 通常挂在某条消息上 |

### 3.2 todo 的完整数据流（未亲测，子代理报告）

```
模型调用 TodoList
  → 引擎写入 durable 事件 tools.update_store（落 agent 的 wire.jsonl）
  → kap-server 投影器追加 todo.upsert op（coreEventMap.ts:990-996）
  → L2 apply：apply.ts:506-516 直接 map set
  → 按粒度推给 WS 客户端（transcript.ops / transcript.reset）
  → 冷读时重放 wire 记录、last-write-wins 折叠成单个 todo 文档（foldFacts.ts:414-423）
```

### 3.3 单二进制与 web 资产（未亲测，子代理报告）

- 构建走 Node SEA：bundle → SEA blob → inject(payload/sign) → codesign → verify，**仓库内没有 Electron**；
- web 资产以 `web/<target>/dist-web/<rel>` 键嵌进可执行文件，启动时按 version+manifest 哈希
  解到缓存并逐文件 SHA-256 校验；
- 实时通道是 WS：`client_hello → subscribe_v2`（带 cursor）→ `ack` / `resync_required`，
  含心跳、批处理、背压常量。

---

## 四、对本项目决策的影响

### 4.1 与我们测试版的逐项对比

| 维度 | kimi-code | 我们（v2.0.28 测试版） | 证据 |
| --- | --- | --- | --- |
| 工具名 | `TodoList` | `todowrite` | 亲测两侧 |
| 输入 | `todos?` 可选，省略=读、`[]`=清 | `todos` 必填，无读取模式 | 亲测两侧 |
| 写入语义 | 整体替换 | 整体替换 | 亲测两侧 |
| 文档身份 | 每 agent 一个，`todoId='todo'` | 每次调用一个快照，`todoId=sessionID` | 亲测 kimi 侧 |
| 持久化 | durable 引擎事件 + wire 重放折叠 | 消息历史里的工具调用 | kimi 侧未亲测 |
| 陈旧提醒 | 5 步阈值，每 5 步一次 | **无**；仅在用户提及时注入 | 亲测 kimi 侧 |
| UI 形态 | TUI 常驻面板，最多 5 条，全完成自动隐藏 | 时间线内联，每次调用一块 | 亲测上限常数 |
| 参与 compaction | 是 | **否** | kimi 侧未亲测 |
| 测试框架 | vitest | bun test + Effect 4 | 亲测两侧 |

### 4.2 建议采纳（按性价比排序）

1. **陈旧提醒**（改动最小、收益最直接）。我们的 hook 只在用户提及时触发，
   模型执行到第 3、4 步往往就不再更新清单了。kimi-code 用「5 步未写则提醒」解决了这个问题。
   落点：`packages/core/src/plugin/todo.ts`，复用现有的 `ctx.session.hook("context")`。
   **建议阈值先按 kimi-code 的 5 步**，因为它有实际使用验证（未亲测其效果数据）。

2. **`todos` 改为可选**（改动小）。让模型能读当前清单而不用重写，避免为了看一眼而覆盖。
   落点：`packages/core/src/tool/plugin/todo.ts` 的 `Input`，读取模式下从消息历史折出当前清单。

3. **常驻面板**（改动中等）。内联快照在长会话里会散落。但我们与 kimi-code 的 transcript 模型不同，
   要做得先决定数据从哪来 —— 这是本报告**最需要用户拍板**的一项，见 4.3。

4. **参与 compaction**（改动中等）。长会话压缩后清单可能丢失，需要把当前清单并入摘要。

### 4.3 不建议直接照搬的部分

- **「每 agent 一个 `todoId='todo'`」** 依赖 kimi-code 那套实体化 transcript。
  我们的 v2 是消息-部件模型，硬套会引入一个新的状态存储与一致性面。
  若要"当前状态"视图，更自然的做法是**从消息历史里折叠出最后一个 todowrite 调用**，而不是新建文档实体。
- **web 端照搬**：kimi-code 把 SPA 打包进单二进制。我们的桌面端已经是「Electron 壳 + 独立 CLI 服务端（3084）+ 可构建的 web UI（`packages/app`）」，
  理论上可走"浏览器直连本地 3084"的轻量路线，**不必**复制单二进制 SEA 那一套。
  但这需要先确认 `packages/app` 作为独立 web 端能否脱离 Electron 运行 —— **未验证**。

### 4.4 对既有计划条目的影响

- [`todo_plan.md`](../plan/todo_plan.md)：新增三条候选（陈旧提醒 / 可选读取 / 常驻面板）；
  原「端到端渲染验证」优先级不变，因为它是所有后续改动的前提。
- [`issues_backlog.md`](../plan/issues_backlog.md)：新增 Q-7（常驻面板的数据来源方案选型）。

---

## 五、来源

### 亲测复核的事实（我本人在本地克隆上验证）

| 事实 | 位置 |
| --- | --- |
| todo 模型全文（14 行） | `packages/transcript/src/model/todo.ts` |
| `TODO_ENTITY_ID = 'todo'` | `packages/kap-server/src/services/transcript/coreEventMap.ts:1752` |
| 陈旧提醒阈值 5 / 5 | `packages/agent-core-v2/src/features/todo/todoListReminder.ts:7-8` |
| TUI 面板上限 5 | `apps/kimi-code/src/tui/components/chrome/todo-panel.ts:26` |
| `todos` 可选（省略=读、`[]`=清） | `packages/agent-core-v2/src/features/todo/tools/todo-list/todo-list.ts` |
| 整体替换 `todo.replace(next)` | `packages/agent-core-v2/src/features/todo/tools/todo-list/todoListTool.ts:61` |

### 子代理报告（未亲测，带其 citation）

- 进程模型与命令：`apps/kimi-code/src/cli/commands.ts:123-134`、`src/main.ts:9`
- web 模式实现：`apps/kimi-code/src/cli/sub/web/run.ts:378-406`、`:115-124`
- 资产服务与 CSP：`packages/kap-server/src/routes/webAssets.ts:14-112`、`middleware/securityHeaders.ts:8-9`
- WS 协议：`packages/kap-server/src/transport/ws/v1/protocol.ts:1-73`、`wsConnectionV1.ts:158-178`
- transcript 分层与 op：`packages/transcript/src/ops/apply.ts:506-516`、`store/agentTranscript.ts:39-59`
- 冷读折叠：`packages/transcript/src/history/foldFacts.ts:414-423`
- 单二进制构建：`apps/kimi-code/scripts/native/build.mjs:36-55`、`src/native/web-assets.ts:121-183`
- 风险提示：该仓库对 `agent-core-v2` / `kap-server` / `transcript` 三个包**强制无注释**
  （`AGENTS.md:50` 的 `check-no-comments` 脚本），因此这些区域缺少文档，理解成本更高。

### 未验证 / 存疑

- kimi-code 的 todo 面板实际观感与交互细节（仅读到代码，未运行其 TUI）；
- `IAgentTodoService.clear()` 在仓库内**无调用者**（子代理报告），清空只经 `TodoList` 传 `[]`；
- 是否存在仓库外客户端（code-app 的桌面端/web 端）修改 todo —— 子代理明确标注无法从本仓库确认；
- 陈旧提醒的**实际效果**（是否真的减少了漏更新）—— 无公开数据，属设计意图而非已证结论。
