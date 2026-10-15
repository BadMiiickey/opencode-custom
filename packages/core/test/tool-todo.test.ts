import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Session } from "@opencode/core/session"
import { TodoTool } from "@opencode/core/tool/plugin/todo"
import { Tool } from "@opencode/core/tool"
import { it } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const todoToolNode = makeLocationNode({
  name: "test/todo-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(TodoTool.Plugin)),
  deps: [Tool.node],
})
const sessionID = Session.ID.make("ses_todo_tool_test")

const withTools = <A, E, R>(body: (registry: Tool.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* body(registry)
  }).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([Tool.node, todoToolNode]))))

const call = (input: unknown) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: "call-todo", name: "todowrite", input },
})

const item = (title: string, status: "pending" | "in_progress" | "done") => ({ title, status })

describe("todo tool", () => {
  it.live("returns the whole list and a progress summary the model can read", () =>
    withTools((registry) =>
      Effect.gen(function* () {
        const result = yield* executeTool(
          registry,
          call({
            todos: [
              item("Read the auth module", "done"),
              item("Add the regression test", "in_progress"),
              item("Update the docs", "pending"),
            ],
          }),
        )

        expect(result.status).toBe("completed")
        expect(result.metadata).toEqual({ count: 3, done: 1 })
        expect(result.output).toEqual({
          todoId: sessionID,
          updatedAt: expect.any(String),
          items: [
            item("Read the auth module", "done"),
            item("Add the regression test", "in_progress"),
            item("Update the docs", "pending"),
          ],
        })

        const text = result.content?.[0]?.type === "text" ? result.content[0].text : ""
        expect(text.split("\n")).toEqual([
          "- [done] Read the auth module",
          "- [in_progress] Add the regression test",
          "- [pending] Update the docs",
          "",
          "1/3 done.",
        ])
      }),
    ),
  )

  it.live("accepts an empty list as clearing the plan", () =>
    withTools((registry) =>
      Effect.gen(function* () {
        const result = yield* executeTool(registry, call({ todos: [] }))

        expect(result.status).toBe("completed")
        expect(result.metadata).toEqual({ count: 0, done: 0 })
        const text = result.content?.[0]?.type === "text" ? result.content[0].text : ""
        expect(text).toBe("Todo list is now empty.")
      }),
    ),
  )

  it.live("rejects more than one in-progress item and names the conflict", () =>
    withTools((registry) =>
      Effect.gen(function* () {
        const result = yield* executeTool(
          registry,
          call({
            todos: [item("First", "in_progress"), item("Second", "in_progress")],
          }),
        )

        expect(result).toEqual({
          status: "error",
          error: {
            type: "tool.execution",
            message: "Only one todo can be in_progress at a time, but 2 are: First, Second",
          },
        })
      }),
    ),
  )

  it.live("rejects a list beyond the item ceiling", () =>
    withTools((registry) =>
      Effect.gen(function* () {
        const result = yield* executeTool(
          registry,
          call({ todos: Array.from({ length: 101 }, (_, index) => item(`Step ${index}`, "pending")) }),
        )

        expect(result).toEqual({
          status: "error",
          error: { type: "tool.execution", message: "Todo list is too long (101 items, maximum 100)" },
        })
      }),
    ),
  )

  it.live("rejects an unknown status", () =>
    withTools((registry) =>
      Effect.gen(function* () {
        const result = yield* executeTool(registry, call({ todos: [{ title: "Step", status: "blocked" }] }))

        expect(result.status).toBe("error")
        if (result.status !== "error" || !result.error) return
        expect(result.error.message).toStartWith('Invalid arguments for tool "todowrite"')
      }),
    ),
  )
})