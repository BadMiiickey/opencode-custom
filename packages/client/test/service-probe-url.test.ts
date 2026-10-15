import { expect, test } from "bun:test"
import { reachableUrl } from "../src/service-probe"

// A service bound to a wildcard address answers on loopback. Probing the wildcard fails on Windows,
// where 0.0.0.0 is not connectable, and elsewhere it usually leaves NO_PROXY and goes to an HTTP proxy.
test.each([
  { input: "http://0.0.0.0:3084", expected: "http://127.0.0.1:3084/" },
  { input: "http://0.0.0.0:3084/api/info", expected: "http://127.0.0.1:3084/api/info" },
  { input: "http://[::]:3084", expected: "http://[::1]:3084/" },
  { input: "http://127.0.0.1:3084", expected: "http://127.0.0.1:3084/" },
  { input: "http://localhost:4096", expected: "http://localhost:4096/" },
  { input: "http://192.168.1.10:4096", expected: "http://192.168.1.10:4096/" },
  // An unparseable registration is handed back so the caller reports it rather than masking it.
  { input: "not a url", expected: "not a url" },
])("reachableUrl($input) is $expected", ({ input, expected }) => {
  expect(reachableUrl(input)).toBe(expected)
})