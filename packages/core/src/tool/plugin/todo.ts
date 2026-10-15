export * as TodoTool from "./todo.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"

export const name = "todowrite"

export const Status = Schema.Literals(["pending", "in_progress", "done"])

export const Item = Schema.Struct({
  title: Schema.String.annotate({
    description: "Short imperative description of the task, for example 'Run the migration script'.",
  }),
  status: Status.annotate({
    description: "pending = not started, in_progress = being worked on right now, done = finished.",
  }),
})

export const Input = Schema.Struct({
  todos: Schema.Array(Item).annotate({
    description:
      "The complete todo list. Send the whole list every time, not just the changes. Keep titles stable across updates so progress is visible.",
  }),
})

type EncodedItem = typeof Item.Encoded

export const Output = Schema.Struct({
  todoId: Schema.String,
  items: Schema.Array(Item),
  updatedAt: Schema.String,
})

/** Renders the list the way models read it back: one line per item, status first. */
export function toModelContent(items: readonly EncodedItem[]) {
  if (items.length === 0) return "Todo list is now empty."

  const lines = items.map((item) => `- [${item.status}] ${item.title}`)
  const done = items.filter((item) => item.status === "done").length

  lines.push("", `${done}/${items.length} done.`)

  return lines.join("\n")
}

/**
 * Todo list leaf. The model owns the list: every call carries the whole set, so the tool itself is
 * stateless and the timeline renders each call as a snapshot of the plan at that point.
 */
export const Plugin = {
  id: "opencode.tool.todo",
  effect: Effect.fn("TodoTool.Plugin")(function* (ctx: Context) {
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: [
            "Create or update the task list for the current session.",
            "",
            "Use it for work that takes three or more distinct steps, and keep it current as you go:",
            "mark the item you are working on as in_progress, mark finished items as done, and drop items that",
            "turned out to be unnecessary. Never mark something done that you have not actually completed.",
            "",
            "Every call replaces the whole list, so always send every item you still want on it, not only the",
            "ones that changed. Keep exactly one item in_progress at a time, the one you are working on right now.",
            "",
            'Example: { "todos": [{ "title": "Read the auth module", "status": "in_progress" },',
            '  { "title": "Add the regression test", "status": "pending" }] }',
          ].join("\n"),
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (input.todos.length > 100)
                return yield* Effect.fail(
                  new ToolFailure({ message: `Todo list is too long (${input.todos.length} items, maximum 100)` }),
                )

              const active = input.todos.filter((item) => item.status === "in_progress")

              if (active.length > 1)
                return yield* Effect.fail(
                  new ToolFailure({
                    message: `Only one todo can be in_progress at a time, but ${active.length} are: ${active
                      .map((item) => item.title)
                      .join(", ")}`,
                  }),
                )

              return {
                output: {
                  todoId: context.sessionID,
                  items: input.todos,
                  updatedAt: new Date().toISOString(),
                },
                content: toModelContent(input.todos),
                metadata: {
                  count: input.todos.length,
                  done: input.todos.filter((item) => item.status === "done").length,
                },
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: "Unable to update the todo list", error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}