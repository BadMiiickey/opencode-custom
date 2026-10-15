import { describe, expect, test } from "bun:test"
import { Effect, Option, Schema } from "effect"

/**
 * Pins the decoding contract of the shared tool-input schema in `./tool-renderer.tsx`.
 *
 * Why it mirrors instead of importing: `toolInput` is module-private, and the repository forbids adding
 * exports for tests. So this pins the *approach* — struct fields wrapped in `optional()`, decoded with
 * `decodeUnknownOption` and an empty-object fallback — rather than the production symbol itself. A change
 * to the production decoder will not fail here; the structural facts it protects are listed per case below.
 */
function optional(schema: Schema.Schema.All) {
  const field = Schema.optional(schema)
  return Schema.catchDecoding<typeof field>(() => Effect.succeed(Option.none()))(field)
}

const ToolInput = Schema.Struct({
  path: optional(Schema.String),
  offset: optional(Schema.Number),
  limit: optional(Schema.Number),
  url: optional(Schema.String),
  query: optional(Schema.String),
  command: optional(Schema.String),
  content: optional(Schema.String),
  questions: optional(Schema.Array(Schema.Unknown)),
  todos: optional(Schema.Array(Schema.Unknown)),
})

const decodeToolInput = Schema.decodeUnknownOption(ToolInput)
const emptyToolInput: typeof ToolInput.Type = {}

const toolInput = (input: unknown) => {
  const value = decodeToolInput(input)

  return Option.isSome(value) ? value.value : emptyToolInput
}

describe("shared tool input decoding", () => {
  test("reads the fields a renderer asks for", () => {
    expect(toolInput({ path: "a.ts", offset: 3 })).toMatchObject({ path: "a.ts", offset: 3 })
  })

  // A tool part arrives before its input is complete, so every prefix of a payload must decode.
  test("accepts a partially streamed payload", () => {
    expect(toolInput({ path: "a.ts" })).toMatchObject({ path: "a.ts" })
    expect(toolInput({})).toEqual({})
  })

  // The field-level optional() helper absorbs a wrong value type on its own; this pins that behaviour.
  test("drops a malformed field instead of failing the whole input", () => {
    expect(toolInput({ path: 123 })).toEqual({})
    expect(toolInput({ todos: "not a list" })).toEqual({})
  })

  // These are the inputs that used to throw, turning a partial part into a renderer crash.
  for (const input of [null, undefined, "text", 42, []]) {
    test(`does not throw for ${JSON.stringify(input) ?? "undefined"}`, () => {
      expect(() => toolInput(input)).not.toThrow()
      expect(toolInput(input)).toEqual({})
    })
  }
})
