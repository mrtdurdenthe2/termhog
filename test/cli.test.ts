import { describe, expect, test } from "bun:test"

const cli = `${import.meta.dir}/../src/cli.ts`

const run = (...args: ReadonlyArray<string>) =>
  Bun.spawnSync([process.execPath, cli, ...args], {
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })

describe("Effect CLI", () => {
  test("generates root and nested command help", () => {
    const root = run("--help")
    const nested = run("widgets", "set", "--help")
    const compatibilityAlias = run("help", "widgets", "set")

    expect(root.exitCode).toBe(0)
    expect(root.stdout.toString()).toContain("PostHog stats without slow shell startup")
    expect(root.stdout.toString()).toContain("widgets")
    expect(nested.exitCode).toBe(0)
    expect(nested.stdout.toString()).toContain("<widget...>")
    expect(compatibilityAlias.exitCode).toBe(0)
    expect(compatibilityAlias.stdout.toString()).toContain("<widget...>")
  })

  test("reports the application version", () => {
    const result = run("--version")

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain("termhog v0.1.0")
  })

  test("validates widget choices before running a handler", () => {
    const result = run("widgets", "set", "retention")
    const output = `${result.stdout.toString()}${result.stderr.toString()}`

    expect(result.exitCode).toBe(1)
    expect(output).toContain("Invalid value for argument <widget>")
  })
})
