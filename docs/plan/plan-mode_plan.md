# 计划：Plan 模式切换

**更新日期**：2026-10-15

---

## 问题陈述

用户报告桌面端按 `Shift+Tab` / `Ctrl+.` 都无法切换到 Plan 模式。键位方案已被裁定放弃，
改为在 composer 放一个切换按钮。

## 已查明的根因（比键位更深）

`plan` agent 由 core 插件创建（`packages/core/src/plugin/plan.ts`），其 `native` 属性为真。
而桌面端的 agent 选择器可见性判据是：

```ts
// packages/app/src/providers/models/selection.tsx
const agentsVisible = createMemo(() => settings.visibility.customAgents() || hasCustomAgent(list()))
// packages/app/src/providers/models/agent.ts
export function hasCustomAgent(items: Array<{ native?: boolean }>) {
  return items.some((item) => item.native === false)
}
```

即**只有用户自定义 agent 存在时才显示**。于是：

1. `view.agent` 为 `undefined` → composer 里看不到 agent 选择器；
2. `agent.cycle` 命令声明了 `disabled: !local.agent.visible()` → **命令被整个禁用**；
3. 因此键位配成什么都不会触发 —— 这解释了为什么改键位无效。

**关键事实**：`agent.set(name)` **本身不检查** `agentsVisible`，所以按钮可以直接调用绕过限制。

## 方案与实现

**位置**：`packages/app/src/composer/editor/editor.tsx` 的控件行，推理等级（`High`）之后。

| 文件 | 改动 |
| --- | --- |
| `packages/app/src/composer/model.ts` | 新增 `view.plan`：仅当 `agents.options` 含 `plan` 时存在；`active()` 判当前是否 plan；`toggle()` 在 `plan` ↔ `build` 间切 |
| `packages/app/src/composer/editor/interaction.ts` | `ComposerEditorView` 加 `plan?: { active, toggle }` 类型 |
| `packages/app/src/composer/editor/editor.tsx` | 渲染按钮；激活时 `variant="outline"` + `aria-pressed` |
| `packages/ui/src/i18n/en.ts` | `ui.promptInput.planMode` / `.planModeEnter` / `.planModeExit` |

## 诊断结果与两个缺陷（2026-10-15）

用户提供诊断输出：切换前 `plan=Y vis=false cur=build opt=build|plan`，
切换后 `plan=Y vis=false cur=plan opt=build|plan`。

**切换本身是生效的**（`cur` 由 `build` 变为 `plan`），但暴露两个独立缺陷，均已修：

| 缺陷 | 机制 | 修复 |
| --- | --- | --- |
| 按钮无激活态 | 只加了 `text-text-strong`，在 `ghost-faint` 底色上看不出差别 | 激活时改用 `variant="outline"`；加 `aria-pressed` |
| 切换连带切模型 | `agent.set()` 会应用该 agent 记住的模型（`selection.tsx:418` 的设计行为），对模式切换不合适 | `toggle()` 先记下当前模型，切完 agent 再 `model.set()` 还原 |

用户观测到的现象是 `Exo Free` → `Cat Jam Free`，即模型被换掉。

**诊断代码已清理**（三处 `TEMPORARY diagnostic`），零命中验证通过。

## 活跃计划

- [ ] **验证修复效果**：按钮激活时是否有明显外观变化；切换 Plan 后模型是否保持不变
- [ ] 补一个守护测试：按钮在 `agentsVisible` 为 false 时仍可用

## 未验证

修复后的外观与模型保持行为**尚未经用户确认**。上一轮的问题是切换生效但副作用错误，
本轮修复方向明确，但同样需要实机确认。

## 完成记录

| 日期 | 成果 |
| --- | --- |
| 2026-10-15 | 定位 `agentsVisible` 是键位失效真因；按钮实现完毕 |
| 2026-10-15 | 诊断确认切换生效；修复「连带切模型」与「无激活态」两个缺陷；清理诊断代码 |
