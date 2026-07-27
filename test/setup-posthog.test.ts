import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import {
  discoverProjects,
  validateQueryAccess,
} from "../src/setup-posthog.ts"

const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

const run = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(effect)

describe("PostHog setup", () => {
  test("discovers paginated projects and validates query access", async () => {
    const server: ReturnType<typeof Bun.serve> = Bun.serve({
      port: 0,
      async fetch(request): Promise<Response> {
        if (request.headers.get("authorization") !== "Bearer phx_test") {
          return new Response("unauthorized", { status: 401 })
        }
        const url = new URL(request.url)
        if (url.pathname === "/api/organizations/" && !url.searchParams.has("offset")) {
          return Response.json({
            next: `http://127.0.0.1:${server.port}/api/organizations/?offset=1`,
            results: [{
              name: "Acme",
              projects: [{ id: 1, name: "Production" }],
            }],
          })
        }
        if (url.pathname === "/api/organizations/") {
          return Response.json({
            next: null,
            results: [{
              name: "Acme",
              projects: [{ id: 2, name: "Development" }],
            }],
          })
        }
        return Response.json({ results: [[1]] })
      },
    })
    servers.push(server)
    const credentials = {
      host: new URL(`http://127.0.0.1:${server.port}`),
      apiKey: Redacted.make("phx_test"),
    }

    const projects = await run(
      discoverProjects(credentials).pipe(Effect.provide(FetchHttpClient.layer)),
    )
    await run(
      validateQueryAccess(credentials, 1).pipe(Effect.provide(FetchHttpClient.layer)),
    )

    expect(projects.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 1, name: "Production" },
      { id: 2, name: "Development" },
    ])
  })
})
