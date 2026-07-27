import { Effect, Redacted, Schema } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

const ProjectResponse = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
})

const OrganizationsResponse = Schema.Struct({
  next: Schema.NullOr(Schema.String),
  results: Schema.Array(Schema.Struct({
    name: Schema.String,
    projects: Schema.Array(ProjectResponse),
  })),
})

const ValidationResponse = Schema.Struct({
  results: Schema.Array(Schema.Array(Schema.Union([Schema.Number, Schema.String]))),
})

export interface Project {
  readonly id: number
  readonly name: string
  readonly organization: string
}

export interface Credentials {
  readonly host: URL
  readonly apiKey: Redacted.Redacted<string>
}

export class PostHogSetupError
  extends Schema.TaggedErrorClass<PostHogSetupError>()(
    "PostHogSetupError",
    {
      operation: Schema.String,
      message: Schema.String,
      status: Schema.optionalKey(Schema.Number),
    },
  ) {}

const setupError = (operation: string, cause: unknown): PostHogSetupError =>
  cause instanceof PostHogSetupError
    ? cause
    : new PostHogSetupError({
        operation,
        message: cause instanceof Error ? cause.message : String(cause),
      })

export const discoverProjects = Effect.fn("PostHogSetup.discoverProjects")(
  function* (credentials: Credentials) {
    const client = yield* HttpClient.HttpClient
    const projects: Array<Project> = []
    let endpoint: URL | undefined = new URL("/api/organizations/?limit=100", credentials.host)

    for (let page = 0; endpoint && page < 20; page++) {
      const request: HttpClientRequest.HttpClientRequest = HttpClientRequest.get(endpoint).pipe(
        HttpClientRequest.bearerToken(credentials.apiKey),
        HttpClientRequest.acceptJson,
      )
      const response: HttpClientResponse.HttpClientResponse = yield* client.execute(request)
      if (response.status < 200 || response.status >= 300) {
        return yield* new PostHogSetupError({
          operation: "PostHogSetup.discoverProjects",
          message: response.status === 403
            ? "Project discovery requires Organization Read permission"
            : `PostHog returned HTTP ${response.status}`,
          status: response.status,
        })
      }

      const body: typeof OrganizationsResponse.Type = yield* Schema.decodeUnknownEffect(OrganizationsResponse)(
        yield* response.json,
      )
      for (const organization of body.results) {
        for (const project of organization.projects) {
          projects.push({ ...project, organization: organization.name })
        }
      }

      if (body.next === null) {
        endpoint = undefined
      } else {
        const next: URL = new URL(body.next, credentials.host)
        if (next.origin !== credentials.host.origin) {
          return yield* new PostHogSetupError({
            operation: "PostHogSetup.discoverProjects",
            message: "PostHog returned a pagination URL on a different host",
          })
        }
        endpoint = next
      }
    }

    return projects
  },
  (effect) =>
    effect.pipe(
      Effect.timeout("12 seconds"),
      Effect.mapError((cause) => setupError("PostHogSetup.discoverProjects", cause)),
    ),
)

export const validateQueryAccess = Effect.fn("PostHogSetup.validateQueryAccess")(
  function* (credentials: Credentials, projectId: number) {
    const client = yield* HttpClient.HttpClient
    const endpoint = new URL(`/api/projects/${projectId}/query/`, credentials.host)
    const request = yield* HttpClientRequest.post(endpoint).pipe(
      HttpClientRequest.bearerToken(credentials.apiKey),
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyJson({
        query: { kind: "HogQLQuery", query: "SELECT 1 AS ok LIMIT 1" },
        name: "termhog_query_read_permission_check",
      }),
    )
    const response = yield* client.execute(request)
    if (response.status < 200 || response.status >= 300) {
      return yield* new PostHogSetupError({
        operation: "PostHogSetup.validateQueryAccess",
        message: response.status === 403
          ? "The key needs Query Read permission for this project"
          : `PostHog returned HTTP ${response.status}`,
        status: response.status,
      })
    }

    const body = yield* Schema.decodeUnknownEffect(ValidationResponse)(
      yield* response.json,
    )
    if (Number(body.results[0]?.[0]) !== 1) {
      return yield* new PostHogSetupError({
        operation: "PostHogSetup.validateQueryAccess",
        message: "PostHog returned an unexpected validation result",
      })
    }
  },
  (effect) =>
    effect.pipe(
      Effect.timeout("12 seconds"),
      Effect.mapError((cause) => setupError("PostHogSetup.validateQueryAccess", cause)),
    ),
)
