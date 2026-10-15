import { describe, expect } from "bun:test"
import { DateTime, Effect } from "effect"
import { Message } from "@opencode/ai"
import type { SessionContext } from "@opencode/plugin/effect/session"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { TodoPromptPlugin } from "@opencode/core/plugin/todo"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_todo_plugin_test")
const agent = Agent.ID.make("build")

type CommandItem = { name: string; description: string; execute: (input: unknown) => unknown }

/** Runs the todo plugin against stubbed domains, capturing the command it registers and what it persists. */
const run = Effect.fnUntraced(function* () {
  const commands: CommandItem[] = []
  const prompted: { text: string }[] = []
  const persisted: string[] = []
  let contextHook: ((input: SessionContext) => Effect.Effect<void>) | undefined
  let compactionHook: ((input: SessionContext) => Effect.Effect<void>) | undefined

  yield* TodoPromptPlugin.Plugin.effect(
    host({
      command: {
        transform: (callback: (editor: { add: (item: CommandItem) => unknown }) => void) => {
          callback({
            add: (item: CommandItem) => {
              commands.push(item)
              return item
            },
          })
          return Effect.succeed({ dispose: Effect.void })
        },
        reload: () => Effect.void,
      } as never,
      session: {
        hook: (name: string, callback: unknown) => {
          if (name === "context") contextHook = callback as (input: SessionContext) => Effect.Effect<void>
          if (name === "compaction") compactionHook = callback as (input: SessionContext) => Effect.Effect<void>
          return Effect.succeed({ dispose: Effect.void })
        },
        prompt: (input) => {
          prompted.push({ text: input.text })
          return Effect.succeed(
            SessionInbox.User.make({
              id: SessionMessage.ID.make("msg_todo_prompt_test"),
              sessionID,
              time: { created: DateTime.makeUnsafe(0) },
              type: "user",
              payload: { text: input.text },
              delivery: "steer",
            }),
          )
        },
        synthetic: (input: { text: string }) => {
          persisted.push(input.text)
          return Effect.succeed(
            SessionInbox.Synthetic.make({
              id: SessionMessage.ID.make("msg_todo_test"),
              sessionID,
              time: { created: DateTime.makeUnsafe(0) },
              type: "synthetic",
              payload: { text: input.text },
              delivery: "steer",
            }),
          )
        },
      },
    }),
  )

  if (!contextHook) return yield* Effect.die("todo plugin did not register a context hook")
  if (!compactionHook) return yield* Effect.die("todo plugin did not register a compaction hook")

  const todo = commands.find((item) => item.name === "todo")

  if (!todo) return yield* Effect.die("todo plugin did not register the /todo command")

  return { todo, prompted, persisted, contextHook, compactionHook }
})

const request = (messages: Array<Message>): SessionContext => ({
  sessionID,
  agent,
  model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test") },
  system: [],
  messages,
  tools: {},
  options: {},
})

const promptInput = (text: string | undefined) => ({
  prompt: { text, sessionID },
  sessionID,
  delivery: "steer",
})

/** An assistant turn that wrote the list, which is what the staleness nudge anchors on. */
const wrote = (id = "call-1") =>
  Message.assistant({ type: "tool-call", id, name: "todowrite", input: { todos: [] } })

/** An assistant turn that wrote a specific list. */
const wroteList = (todos: unknown, id = "call-list") =>
  Message.assistant({ type: "tool-call", id, name: "todowrite", input: { todos } })

/** Assistant turns that did something else. */
const steps = (count: number) => Array.from({ length: count }, (_, index) => Message.assistant(`step ${index}`))

const injected = (messages: Array<Message>) =>
  messages.filter((message) => message.role === "user").map((message) => message.content.map((part) => (part.type === "text" ? part.text : "")).join(""))

/** Reminders the compaction hook appended, told apart by their opening line. */
const compactionMessages = (messages: Array<Message>) =>
  injected(messages).filter((text) => text.includes("Keep every item in the summary"))

describe("todo plugin", () => {
  it.effect("registers a /todo command that asks for the tool", () =>
    Effect.gen(function* () {
      const { todo } = yield* run()

      expect(todo.description).toBe("write a todo list for the current task")
    }),
  )

  // A bare /todo carries no user text, so the command must still send a well formed prompt.
  it.effect("sends the instruction even when the command has no arguments", () =>
    Effect.gen(function* () {
      const { todo, prompted } = yield* run()

      yield* todo.execute(promptInput(undefined)) as Effect.Effect<unknown>

      expect(prompted).toHaveLength(1)
      expect(prompted[0]?.text).toContain("todowrite")
    }),
  )

  it.effect("keeps the user's own text after the instruction", () =>
    Effect.gen(function* () {
      const { todo, prompted } = yield* run()

      yield* todo.execute(promptInput("ship the release")) as Effect.Effect<unknown>

      expect(prompted[0]?.text).toEndWith("ship the release")
    }),
  )

  for (const text of [
    "give me a todo list",
    "please make a Todo-List for this",
    "帮我列一个待办列表",
    "生成任务列表",
  ]) {
    it.effect(`injects a reminder when the user asks for a todo list: ${text}`, () =>
      Effect.gen(function* () {
        const { contextHook, persisted } = yield* run()
        const messages = [Message.user(text)]

        yield* contextHook(request(messages))

        expect(messages).toHaveLength(2)
        expect(injected(messages)[0]).toContain("todowrite")
        expect(persisted).toHaveLength(1)
      }),
    )
  }

  for (const text of ["fix the parser", "the todo variable in main.ts is undefined", "继续做上一件事"]) {
    it.effect(`leaves an unrelated message alone: ${text}`, () =>
      Effect.gen(function* () {
        const { contextHook, persisted } = yield* run()
        const messages = [Message.user(text)]

        yield* contextHook(request(messages))

        expect(messages).toHaveLength(1)
        expect(persisted).toHaveLength(0)
      }),
    )
  }

  it.effect("ignores a trailing assistant turn", () =>
    Effect.gen(function* () {
      const { contextHook, persisted } = yield* run()
      const messages = [Message.user("make a todo list"), Message.assistant("done")]

      yield* contextHook(request(messages))

      expect(messages).toHaveLength(2)
      expect(persisted).toHaveLength(0)
    }),
  )

  it.effect("does not nudge a list that was never written", () =>
    Effect.gen(function* () {
      const { contextHook, persisted } = yield* run()
      const messages = [Message.user("start"), ...steps(9)]

      yield* contextHook(request(messages))

      expect(persisted).toHaveLength(0)
    }),
  )

  for (const count of [1, 4]) {
    it.effect(`stays quiet ${count} step(s) after a write`, () =>
      Effect.gen(function* () {
        const { contextHook, persisted } = yield* run()
        const messages = [Message.user("start"), wrote(), ...steps(count)]

        yield* contextHook(request(messages))

        expect(persisted).toHaveLength(0)
      }),
    )
  }

  it.effect("nudges five steps after a write", () =>
    Effect.gen(function* () {
      const todoRun = yield* run()
      const messages = [Message.user("start"), wrote(), ...steps(5)]

      yield* todoRun.contextHook(request(messages))

      expect(todoRun.persisted).toHaveLength(1)
      expect(todoRun.persisted[0]).toContain("has not been updated for 5 steps")
      // With no trailing user turn the nudge lands at the tail, right before the next call.
      expect(messages.at(-1)?.role).toBe("user")
      expect(messages.at(-2)?.role).toBe("assistant")
      expect(injected(messages).at(-1)).toContain("has not been updated for 5 steps")
    }),
  )

  it.effect("nudges again five steps after the previous nudge", () =>
    Effect.gen(function* () {
      const first = yield* run()
      const opening = [Message.user("start"), wrote(), ...steps(5)]
      yield* first.contextHook(request(opening))
      const nudge = first.persisted[0]!

      const second = yield* run()
      const later = [Message.user("start"), wrote(), ...steps(5), Message.user(nudge), ...steps(5)]
      yield* second.contextHook(request(later))

      expect(second.persisted).toHaveLength(1)
      expect(second.persisted[0]).toBe(nudge)
    }),
  )

  it.effect("prefers the ask reminder when the user asks while the list is stale", () =>
    Effect.gen(function* () {
      const { contextHook, persisted } = yield* run()
      const messages = [wrote(), ...steps(9), Message.user("give me a todo list")]

      yield* contextHook(request(messages))

      expect(persisted).toHaveLength(1)
      expect(persisted[0]).toContain("The user asked for a todo list")
    }),
  )

  it.effect("hands the current list to the summarizer so compaction keeps the plan", () =>
    Effect.gen(function* () {
      const { compactionHook } = yield* run()
      const messages = [
        Message.user("start"),
        wroteList([
          { title: "Ship it", status: "done" },
          { title: "Test it", status: "in_progress" },
        ]),
        ...steps(3),
      ]

      yield* compactionHook(request(messages))

      expect(messages).toHaveLength(6)
      expect(messages.at(-1)?.role).toBe("user")
      expect(injected(messages).at(-1)).toContain("- [done] Ship it")
      expect(injected(messages).at(-1)).toContain("- [in_progress] Test it")
      expect(injected(messages).at(-1)).toContain("Keep every item in the summary")
    }),
  )

  it.effect("folds the newest list, not the oldest", () =>
    Effect.gen(function* () {
      const { compactionHook } = yield* run()
      const messages = [
        wroteList([{ title: "old", status: "pending" }], "call-old"),
        ...steps(2),
        wroteList([{ title: "new", status: "done" }], "call-new"),
      ]

      yield* compactionHook(request(messages))

      const carried = injected(messages).at(-1) ?? ""
      expect(carried).toContain("- [done] new")
      expect(carried).not.toContain("old")
    }),
  )

  it.effect("leaves compaction alone when the list was cleared", () =>
    Effect.gen(function* () {
      const { compactionHook } = yield* run()
      const messages = [wroteList([], "call-empty"), ...steps(2)]

      yield* compactionHook(request(messages))

      expect(compactionMessages(messages)).toHaveLength(0)
    }),
  )

  it.effect("leaves compaction alone when no list was ever written", () =>
    Effect.gen(function* () {
      const { compactionHook } = yield* run()
      const messages = [Message.user("start"), ...steps(4)]

      yield* compactionHook(request(messages))

      expect(compactionMessages(messages)).toHaveLength(0)
    }),
  )

  for (const todos of ["not a list", [{ title: "no status" }], [{ status: "done" }], [null]]) {
    it.effect(`ignores a malformed list payload: ${JSON.stringify(todos)}`, () =>
      Effect.gen(function* () {
        const { compactionHook } = yield* run()
        const messages = [wroteList(todos), ...steps(2)]

        yield* compactionHook(request(messages))

        expect(compactionMessages(messages)).toHaveLength(0)
      }),
    )
  }
})