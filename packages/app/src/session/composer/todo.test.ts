import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { selectSessionTodos } from "./todo"

function todoTool(input: unknown, status = "completed") {
  return {
    type: "tool",
    id: `tool_${status}`,
    name: "todowrite",
    state: { status, input, content: [], metadata: {} },
    time: { created: 1 },
  }
}

function otherTool() {
  return { type: "tool", id: "tool_read", name: "read", state: { status: "completed", input: {}, content: [] }, time: { created: 1 } }
}

function assistant(content: unknown[]) {
  return {
    id: "msg_assistant",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content,
    time: { created: 1 },
  }
}

const messages = (...items: unknown[]) => items as SessionMessageInfo[]

describe("selectSessionTodos", () => {
  test("is empty when the session never wrote a list", () => {
    expect(selectSessionTodos(messages())).toEqual([])
    expect(selectSessionTodos(messages(assistant([otherTool()])))).toEqual([])
  })

  test("reports the newest list, because every call carries the whole set", () => {
    const older = assistant([todoTool({ todos: [{ title: "first", status: "pending" }] })])
    const newer = assistant([todoTool({ todos: [{ title: "second", status: "in_progress" }] })])

    expect(selectSessionTodos(messages(older, newer))).toEqual([{ title: "second", status: "in_progress" }])
  })

  // While a call streams, `input` holds raw argument text rather than a record. Reading through it would
  // throw, and this is the case that used to crash the timeline renderer.
  test("skips a call whose arguments are still streaming", () => {
    const settled = assistant([todoTool({ todos: [{ title: "known", status: "pending" }] })])
    const streaming = assistant([todoTool('{"todos":[{"title":"half', "streaming")])

    expect(() => selectSessionTodos(messages(settled, streaming))).not.toThrow()
    expect(selectSessionTodos(messages(settled, streaming))).toEqual([{ title: "known", status: "pending" }])
  })

  test("answers with an empty list when the newest call cleared it", () => {
    const older = assistant([todoTool({ todos: [{ title: "dropped", status: "pending" }] })])
    const cleared = assistant([todoTool({ todos: [] })])

    expect(selectSessionTodos(messages(older, cleared))).toEqual([])
  })

  test("drops items that are not shaped like a task", () => {
    const mixed = assistant([todoTool({ todos: [{ title: "keep", status: "done" }, "text", { title: 7 }, null] })])

    expect(selectSessionTodos(messages(mixed))).toEqual([{ title: "keep", status: "done" }])
  })

  test("survives a call whose input is not a record", () => {
    expect(selectSessionTodos(messages(assistant([todoTool(null)])))).toEqual([])
    expect(selectSessionTodos(messages(assistant([todoTool({ todos: "not a list" })])))).toEqual([])
  })
})
