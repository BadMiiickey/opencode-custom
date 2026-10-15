export * as TodoPromptPlugin from "./todo.js"

import { Message } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { TodoTool } from "../tool/plugin/todo.js"
import { Effect } from "effect"

const TODO = "todo"

const instruction = `<system-reminder>
The user asked for a todo list. Call the \`${TodoTool.name}\` tool now with the complete list, instead of writing
the list as markdown text. Send the whole list on every call, keep titles stable across updates, mark exactly
one item as in_progress at a time, and never mark something done that you have not finished.
</system-reminder>`

/**
 * Nudges the model to keep the list current. Matches the spacing kimi-code settled on: after this many
 * steps without a write the plan is usually stale enough to be worth restating.
 */
const STEPS_SINCE_WRITE = 5

const stale = `<system-reminder>
The todo list has not been updated for ${STEPS_SINCE_WRITE} steps. Mark the item you just finished as done, and
move the one you are working on to in_progress. If the plan changed, call \`${TodoTool.name}\` with the complete
list you want to keep.
</system-reminder>`

/**
 * Matches a user asking for a todo list. Deliberately narrow: a bare "todo" inside code or prose should not
 * trigger the tool, while the Chinese and the spaced/hyphenated spellings should.
 */
const requested = /\btodo[ -]?list\b|待办(?:事项|列表)?|任务列表|做一?[个份]?计划清单/i

const wants = (text: string) => requested.test(text)

const textOf = (message: Message) =>
  message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")

const lastUserText = (messages: readonly Message[]) => {
  const message = messages.at(-1)

  return message?.role === "user" ? textOf(message) : undefined
}

const wroteTodo = (message: Message) =>
  message.content.some((part) => part.type === "tool-call" && part.name === TodoTool.name)

type Item = { readonly title: string; readonly status: string }

/**
 * The list the model last sent, folded out of the message stream. This is the session's current plan for
 * anything that cannot see the tool call itself, such as the compaction summary and the persistent panel.
 */
function lastWrittenList(messages: readonly Message[]): readonly Item[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]

    if (message === undefined) continue

    for (const part of message.content) {
      if (part.type !== "tool-call" || part.name !== TodoTool.name) continue
      if (typeof part.input !== "object" || part.input === null || !("todos" in part.input)) continue

      const todos = part.input.todos

      if (!Array.isArray(todos)) continue

      const items = todos.flatMap((item) => {
        if (typeof item !== "object" || item === null) return []
        if (!("title" in item) || typeof item.title !== "string") return []
        if (!("status" in item) || typeof item.status !== "string") return []

        return [{ title: item.title, status: item.status }]
      })

      if (items.length > 0) return items
    }
  }

  return []
}

const render = (items: readonly Item[]) =>
  items.map((item) => `- [${item.status}] ${item.title}`).join("\n")

const said = (text: string) => (message: Message) => message.role === "user" && textOf(message).includes(text)

function lastIndex(messages: readonly Message[], match: (message: Message) => boolean) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (match(messages[index]!)) return index
  }

  return -1
}

/**
 * The reminder to inject before this request, if any.
 *
 * A request that asks for a list wins outright. Otherwise the list is only nudged when the model has already
 * written one, and enough steps have passed since the last write or nudge. Anchoring on the later of those two
 * bounds makes the spacing hold without keeping state: once a nudge is in the history it becomes the anchor,
 * so the next one lands another {@link STEPS_SINCE_WRITE} steps later.
 */
function reminderFor(messages: readonly Message[]) {
  const asked = lastUserText(messages)

  if (asked !== undefined && wants(asked)) return instruction

  const anchor = Math.max(
    lastIndex(messages, wroteTodo),
    lastIndex(messages, said(stale)),
    lastIndex(messages, said(instruction)),
  )

  if (anchor < 0) return undefined

  const steps = messages.slice(anchor + 1).filter((message) => message.role === "assistant").length

  return steps >= STEPS_SINCE_WRITE ? stale : undefined
}

export const Plugin = define({
  id: "opencode.todo",
  effect: Effect.fn(function* (ctx) {
    // /todo asks for the same thing the hook asks for, without depending on the wording of the prompt.
    yield* ctx.command.transform((editor) => {
      editor.add({
        name: TODO,
        description: "write a todo list for the current task",
        execute: (input) =>
          ctx.session
            .prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: [instruction, input.prompt.text].filter(Boolean).join("\n\n"),
              delivery: input.delivery,
            })
            .pipe(Effect.asVoid),
      })
    })

    // The model answers a plain "give me a todo list" with markdown instead of the tool, and forgets to keep
    // the list current once it is working. Both are handled by restating the requirement per request.
    yield* ctx.session.hook("context", (event) => {
      const text = reminderFor(event.messages)

      if (text === undefined) return Effect.void

      // Before the user's prompt, matching where agent-switch reminders land.
      const at = event.messages.at(-1)?.role === "user" ? event.messages.length - 1 : event.messages.length

      event.messages.splice(at, 0, Message.user(text))

      return ctx.session
        .synthetic({ sessionID: event.sessionID, text, resume: false })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to persist the todo reminder", { sessionID: event.sessionID, cause }),
          ),
        )
    })

    // A compacted history drops the tool calls that carried the list, so the model would resume without a
    // plan. Hand the current list to the summarizer and ask it to carry the items forward verbatim.
    yield* ctx.session.hook("compaction", (event) => {
      const items = lastWrittenList(event.messages)

      if (items.length === 0) return Effect.void

      event.messages.push(
        Message.user(`<system-reminder>
The session's current todo list follows. Keep every item in the summary you produce, with its status
unchanged, so the plan survives the compaction:

${render(items)}
</system-reminder>`),
      )

      return Effect.void
    })
  }),
})