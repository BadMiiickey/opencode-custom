import type { SessionMessageInfo } from "@opencode/client/promise"

export type SessionTodoItem = {
  readonly title: string
  readonly status: "pending" | "in_progress" | "done"
}

const statuses: readonly string[] = ["pending", "in_progress", "done"]

// Tool input arrives as an open record, so every field is checked rather than trusted.
function isTodoItem(value: unknown): value is SessionTodoItem {
  if (typeof value !== "object" || value === null) return false

  const item = value as { title?: unknown; status?: unknown }

  return typeof item.title === "string" && typeof item.status === "string" && statuses.includes(item.status)
}

/**
 * The plan the session is working from, or an empty list.
 *
 * The todo tool is a stateless snapshot: every call carries the whole list, so the newest settled call is
 * the current state and nothing has to be merged with older ones. A call that is still streaming is
 * skipped, because while it streams `input` holds the raw argument text rather than a record.
 */
export function selectSessionTodos(messages: readonly SessionMessageInfo[]): SessionTodoItem[] {
  for (const message of [...messages].reverse()) {
    if (message.type !== "assistant") continue

    for (const content of [...message.content].reverse()) {
      if (content.type !== "tool" || content.name !== "todowrite") continue
      if (content.state.status === "streaming") continue

      const todos = content.state.input?.todos

      // The newest settled call decides. An empty list there is the model clearing the plan, not an absence
      // of one, so looking further back would resurrect a list that was deliberately dropped.
      return Array.isArray(todos) ? todos.filter(isTodoItem) : []
    }
  }

  return []
}
