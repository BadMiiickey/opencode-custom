import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { SessionTodoItem } from "./todo"

// A long plan must not push the composer off screen, so the panel shows a window of rows and the header
// carries the running count.
const visibleRows = 5

/**
 * The plan the session is working from, docked above the composer.
 *
 * The list is read-only here. The model owns it, and the timeline row for each call is where the history
 * lives; this panel only answers "what is left", which is the question a long turn keeps raising.
 */
export function SessionTodoPanel(props: { items: readonly SessionTodoItem[] }) {
  const language = useLanguage()
  const outstanding = createMemo(() => props.items.filter((item) => item.status !== "done"))
  const done = createMemo(() => props.items.length - outstanding().length)
  // Start at the first unfinished task: finished ones are already recorded in the timeline.
  const shown = createMemo(() => {
    const first = props.items.findIndex((item) => item.status !== "done")
    const start = Math.max(first, 0)

    return props.items.slice(start, start + visibleRows)
  })

  return (
    <Show when={outstanding().length > 0}>
      <div
        data-component="session-todo-panel"
        class="relative z-0 mb-1.5 rounded-xl bg-v2-background-bg-base px-3 py-2 shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
      >
        <div class="flex items-baseline gap-2 text-[11px] font-[530] uppercase leading-[var(--line-height-tight)] tracking-[0.05px] text-v2-text-text-muted [font-variant-numeric:tabular-nums]">
          <span>{language.t("ui.tool.todo")}</span>
          <span>{language.plural("ui.tool.todo.progress", done(), { total: props.items.length })}</span>
        </div>
        <ul class="mt-1 flex flex-col gap-0.5">
          <For each={shown()}>
            {(item) => (
              <li
                data-component="session-todo-row"
                data-status={item.status}
                dir="auto"
                class="truncate text-[13px] leading-[var(--line-height-compact)]"
                classList={{
                  "text-v2-text-text-base": item.status === "in_progress",
                  "text-v2-text-text-muted": item.status === "pending",
                }}
              >
                {item.title}
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  )
}
