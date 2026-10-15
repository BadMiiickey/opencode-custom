import { describe, expect, test } from "bun:test"
import { Option, Schema } from "effect"

type Todo = { readonly title: string; readonly status: "pending" | "in_progress" | "done" }

/** Mirrors the decoder the todowrite renderer uses, so the input shape stays pinned. */
const todoItem = Schema.Struct({
  title: Schema.String,
  status: Schema.Literals(["pending", "in_progress", "done"]),
})

const decodeTodoInput = Schema.decodeUnknownOption(Schema.Struct({ todos: Schema.Array(todoItem) }))

const read = (input: unknown): readonly Todo[] => {
  const value = decodeTodoInput(input)

  return Option.isSome(value) && Array.isArray(value.value.todos) ? value.value.todos : []
}

const empty: readonly Todo[] = []

describe("todowrite renderer input", () => {
  // A tool part arrives before its input finishes streaming, so partial shapes must degrade quietly.
  const cases: { input: unknown; expected: readonly Todo[] }[] = [
    {
      input: { todos: [{ title: "Ship it", status: "done" }, { title: "Test it", status: "in_progress" }] },
      expected: [
        { title: "Ship it", status: "done" },
        { title: "Test it", status: "in_progress" },
      ],
    },
    { input: { todos: [] }, expected: empty },
    { input: {}, expected: empty },
    { input: { todos: [{ title: "no status" }] }, expected: empty },
    { input: { todos: [{ title: "a", status: "bogus" }] }, expected: empty },
    { input: { todos: "not a list" }, expected: empty },
  ]

  for (const { input, expected } of cases) {
    test(`reads ${JSON.stringify(input)}`, () => {
      expect(read(input)).toEqual(expected)
    })
  }

  // The renderer reads a length off this value, so it must never be anything but an array.
  test("never yields a non-array", () => {
    for (const input of [undefined, null, "text", 42, {}, { todos: null }, []]) {
      expect(Array.isArray(read(input))).toBe(true)
    }
  })
})