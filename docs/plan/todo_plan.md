# 计划：todo 功能

**更新日期**：2026-10-15
**上游状态**：v2 明确删除了 `todowrite`（`packages/core/src/database/v1-migration.bun.ts` 的 `REMOVED_TOOLS`），
但 session-ui 留了两处残骸把链路掐断。本功能是**整条链路重建**，不是补一个 UI。

---

## 设计取舍

**工具做成无状态的**：每次调用携带完整列表，时间线把每次调用渲染成一个快照。
不引入服务端 todo 状态，与参考实现（kimi-code 的 `TranscriptTodo` 快照模型）一致。
代价是进度连续性依赖模型保持 title 稳定 —— 这一点写进了工具 description。

---

## 实现清单

| 位置 | 角色 | 状态 |
| --- | --- | --- |
| `packages/core/src/tool/plugin/todo.ts` | 工具本体：Schema、校验、给模型读的进度文本 | ✅ |
| `packages/core/src/plugin/todo.ts` | `/todo` 命令 + 触发词提醒注入 | ✅ |
| `packages/core/src/plugin/internal.ts` | 注册上述两个插件 | ✅ |
| `packages/session-ui/src/tools/tool-renderer.tsx` | 清单渲染器；删除 `return null` 拦截 | ✅ |
| `packages/session-ui/src/timeline/projection.ts` | 删除 `renderable()` 里的 todowrite 过滤 | ✅ |
| `packages/ui/src/i18n/en.ts` | 英文文案（其他语言走 fallback） | ✅ |

### 工具契约

- 输入 `{ todos: { title, status }[] }`，`status ∈ pending | in_progress | done`
- 输出 `{ todoId, items, updatedAt }`（`todoId` 取 sessionID）
- **两条硬校验**：超过 100 项报错；同时多个 `in_progress` 报错（错误信息列出冲突项标题）

### 提醒注入的触发边界

正则刻意收窄，避免代码或正文里的孤立 `todo` 误触发：

```
/\btodo[ -]?list\b|待办(?:事项|列表)?|任务列表|做一?[个份]?计划清单/i
```

---

## 已知问题与修复记录

### 已修：点开详情即崩溃

**根因**：渲染器误用 `optional(Schema.Array(item))`。该辅助函数解的是**根值**（应为数组），
而 `props.input` 是 `{ todos: [...] }` 对象，导致**每次渲染都抛异常**。

**修复**：改用不抛异常的 `Schema.decodeUnknownOption`，并对结果做 `Array.isArray` 兜底。

**证据**：`packages/session-ui/src/tools/todo-renderer.test.ts` 断言返回值**永远是数组**（含流式半成品、缺字段、非法 status、非数组等 6 种畸形输入）。

### 未验证：端到端渲染

用户已于 2026-10-15 确认：**todo 正常显示**、`/todo` 命令与「提到 todo list」的触发均正常，
「只需优化即可」。清单可见 `3 of 8 done` 进度、完成项带删除线。

**仍待确认**：未完成项标记的优化效果。上一版借用了 `collapse` 图标，渲染成 `*` 符号，语义不清；
已改为 CSS 圆点（`text-text-faint` 表示未开始、`text-text-accent` 表示进行中），
惯例取自 `session-ui/src/components/timeline-separator.tsx:56`。

---

## 活跃计划

- [x] 用户端到端验证：模型调用 `todowrite` 后时间线渲染正常（2026-10-15 确认）
- [x] 验证 `/todo` 命令与「提到 todo list」触发（2026-10-15 确认正常）
- [ ] **优化未完成项标记**：改为 CSS 圆点后待确认视觉效果

## 参考 kimi-code 后的候选改进

来源：[`../reference/kimi-code.md`](../reference/kimi-code.md)。

### 已批准（2026-10-15 用户裁定）

- [x] **陈旧提醒**（2026-10-15 完成）：写完清单后 5 步未更新则注入提醒，之后每 5 步一次。
      实现方式：以「最后一次写入或最后一次提醒」为锚点，向后计 assistant 消息数，
      达到 5 即注入 —— **无需维护可变状态**，提醒本身进入历史后成为新锚点，下次自动再推 5 步。
      落点：`packages/core/src/plugin/todo.ts` 的 `reminderFor`。
      测试 6 例：1/4 步不提醒、5 步提醒、提醒后再过 5 步再提醒、从未写过不提醒、用户提出时优先用提问提醒。
- [x] **参与 compaction**（2026-10-15 完成）：压缩会把携带清单的工具调用摘要掉，模型会丢失计划。
      实现方式：`compaction` hook 里折叠出最后一次写入的清单，追加给摘要器并要求逐项保留。
      落点：`lastWrittenList()`（同一函数也是常驻面板的数据来源）+ `ctx.session.hook("compaction")`。
      测试 5 例：正常携带、取最新而非最旧、清单被清空时不介入、从未写过不介入、4 种畸形载荷忽略。

### 已评估但不实施

- **`todos` 改为可选（读取模式）** —— **建议不做**，理由如下。
  kimi-code 需要读取模式，是因为它的 todo 是**跳出消息流的独立文档**：不提供读接口，
  模型根本无法得知当前状态。
  **我们的清单就在消息流里**，模型能直接看到自己上次的调用，加读取模式需给工具引入会话服务依赖，
  收益却很低。而这项改进的主要用途（压缩后丢失）已由上面的 compaction 参与更彻底地解决。
  用户如仍坚持，可重新评估。

### 待实施

- [ ] **常驻面板**（数据来源已裁定为**路线 A · 折叠历史**）

      **已定位的实现位置**（2026-10-15 调查，可直接开工）：

      | 项 | 位置 |
      | --- | --- |
      | 渲染插入点 | `packages/app/src/session/composer/region.tsx:318`，紧邻既有的 `SessionQueuePanel`，两者同在 `<div class="relative">` 内、`Composer` 之上 |
      | 可效仿的既有模式 | `SessionQueuePanel`（`session/composer/queue-panel.tsx:18`）接收一个 view model prop，由 region 传入 |
      | 数据来源 | `session` model 已暴露 `messages()`（`session/model.ts:65`，内部为 `data.session.message.list(id)`）；`createActiveSessionRegion` 已接收 `session` 与 `timeline`（`session/screen.tsx:216`） |
      | 折叠逻辑 | 与 core 侧 `lastWrittenList()` 同构：倒序找最后一个 `todowrite` 工具调用，取其 `input.todos` |
      | 文案 | 复用已有的 `ui.tool.todo` / `.progress` / `.status.*` 键，无需新增 |

      **建议的最小版本**（降低返工成本）：仅在存在清单时显示；最多 5 行，超出显示「还有 N 项」；
      完成项删除线；全部完成时隐藏；不做交互与动画。

      **为什么没有直接动手**：这是纯视觉功能，我无法自行确认效果。Plan 按钮已因「按钮无激活态」
      返工过一轮，故先落方案再实施。用户确认设计后开工成本很低。

## 完成记录

| 日期 | 成果 |
| --- | --- |
| 2026-10-15 | 工具 + 插件 + 渲染器实现完毕；崩溃修复；新增测试 23 例（core 16 + session-ui 7）全绿 |
| 2026-10-15 | 陈旧提醒 + compaction 保留实现完毕，新增测试 11 例；`todos` 改可选经评估建议不做（见上） |
