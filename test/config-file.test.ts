import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { Effect, Option, Redacted } from "effect"

let directory = ""

beforeAll(async () => {
  directory = await mkdtemp(`${tmpdir()}/termhog-config-`)
  process.env.TERMHOG_CONFIG_DIR = directory
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
  delete process.env.TERMHOG_CONFIG_DIR
})

describe("stored configuration", () => {
  test("round-trips with user-only permissions", async () => {
    const { readStoredConfiguration, writeStoredConfiguration } =
      await import("../src/config-file.ts")
    const value = {
      version: 1,
      apiKey: "phx_file",
      projectId: 123,
      host: "https://us.posthog.com",
      label: "Production",
      pathFilter: "/pricing",
    }

    await Effect.runPromise(writeStoredConfiguration(value))
    const stored = await Effect.runPromise(readStoredConfiguration())
    const metadata = await stat(`${directory}/config.json`)

    expect(Option.getOrUndefined(stored)).toEqual(value)
    expect(metadata.mode & 0o777).toBe(0o600)
  })

  test("environment values override the stored file", async () => {
    const previous = {
      key: process.env.POSTHOG_PERSONAL_API_KEY,
      project: process.env.POSTHOG_PROJECT_ID,
      host: process.env.POSTHOG_HOST,
      label: process.env.TERMHOG_LABEL,
      path: process.env.TERMHOG_PATH,
    }
    Object.assign(process.env, {
      POSTHOG_PERSONAL_API_KEY: "phx_environment",
      POSTHOG_PROJECT_ID: "456",
      POSTHOG_HOST: "https://eu.posthog.com",
      TERMHOG_LABEL: "Environment",
      TERMHOG_PATH: "/docs",
    })

    try {
      const { layer, Service } = await import("../src/configuration.ts")
      const config = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* Service
        }).pipe(Effect.provide(layer)),
      )

      expect(Redacted.value(config.apiKey)).toBe("phx_environment")
      expect(config.projectId).toBe(456)
      expect(config.host.origin).toBe("https://eu.posthog.com")
      expect(config.label).toBe("Environment")
      expect(config.pathFilter).toBe("/docs")
    } finally {
      const restore = (name: string, value: string | undefined) => {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      restore("POSTHOG_PERSONAL_API_KEY", previous.key)
      restore("POSTHOG_PROJECT_ID", previous.project)
      restore("POSTHOG_HOST", previous.host)
      restore("TERMHOG_LABEL", previous.label)
      restore("TERMHOG_PATH", previous.path)
    }
  })
})
