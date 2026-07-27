import { Context, Effect, Layer, Schema } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { Service as Configuration } from "./configuration.ts"
import type { Stats, WidgetStats } from "./model.ts"
import {
  widgetDefinitions,
  type WidgetDefinition,
} from "./widgets.ts"

const QueryResponse = Schema.Struct({
  results: Schema.Array(
    Schema.Array(Schema.Union([Schema.Number, Schema.String])),
  ),
})

export class PostHogError extends Schema.TaggedErrorClass<PostHogError>()(
  "PostHogError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export interface Interface {
  readonly fetchStats: () => Effect.Effect<Stats, PostHogError>
}

export class Service extends Context.Service<Service, Interface>()(
  "termhog/PostHog",
) {}

const condition = (
  definition: WidgetDefinition,
  startHours = definition.rangeHours,
  endHours = 0,
): string => {
  const time = `timestamp >= now() - INTERVAL ${startHours} HOUR AND timestamp < now() - INTERVAL ${endHours} HOUR`
  return definition.filter ? `(${time}) AND (${definition.filter})` : time
}

const buildQuery = (definitions: ReadonlyArray<WidgetDefinition>): string => {
  const selections = definitions.flatMap((definition, widgetIndex) => {
    const totalCondition = condition(definition)
    const previousCondition = condition(
      definition,
      definition.rangeHours * 2,
      definition.rangeHours,
    )
    const buckets = Array.from({ length: definition.bucketCount }, (_, bucketIndex) => {
      const start = definition.rangeHours - bucketIndex * definition.bucketHours
      const end = start - definition.bucketHours
      return `countIf(${condition(definition, start, end)}) AS widget_${widgetIndex}_bucket_${bucketIndex}`
    })
    return [
      `countIf(${totalCondition}) AS widget_${widgetIndex}_events`,
      `uniqExactIf(person_id, ${totalCondition}) AS widget_${widgetIndex}_users`,
      `countIf(${previousCondition}) AS widget_${widgetIndex}_previous_events`,
      `uniqExactIf(person_id, ${previousCondition}) AS widget_${widgetIndex}_previous_users`,
      ...buckets,
    ]
  })
  const rangeHours = Math.max(
    ...definitions.map((definition) => definition.rangeHours * 2),
  )

  return `SELECT
  ${selections.join(",\n  ")}
FROM events
WHERE timestamp >= now() - INTERVAL ${rangeHours} HOUR
  AND timestamp <= now()`
}

const messageFrom = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Configuration
    const client = yield* HttpClient.HttpClient

    const fetchStats = Effect.fn("PostHog.fetchStats")(function* () {
      const definitions = config.widgets.map((id) => widgetDefinitions[id])
      const endpoint = new URL(
        `/api/projects/${config.projectId}/query/`,
        config.host,
      )
      const request = yield* HttpClientRequest.post(endpoint).pipe(
        HttpClientRequest.bearerToken(config.apiKey),
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyJson({
          query: { kind: "HogQLQuery", query: buildQuery(definitions) },
          name: "termhog_widgets",
          refresh: "blocking",
        }),
      )
      const response = yield* client.execute(request)
      const ok = yield* HttpClientResponse.filterStatusOk(response)
      const body = yield* Schema.decodeUnknownEffect(QueryResponse)(yield* ok.json)
      const row = body.results[0]
      let offset = 0
      const widgets: Array<WidgetStats> = []

      for (const definition of definitions) {
        const eventCount = Number(row?.[offset])
        const uniqueUsers = Number(row?.[offset + 1])
        const previousEventCount = Number(row?.[offset + 2])
        const previousUniqueUsers = Number(row?.[offset + 3])
        const eventBuckets = Array.from(
          { length: definition.bucketCount },
          (_, index) => Number(row?.[offset + index + 4]),
        )
        offset += definition.bucketCount + 4

        if (
          !Number.isFinite(eventCount) ||
          !Number.isFinite(uniqueUsers) ||
          !Number.isFinite(previousEventCount) ||
          !Number.isFinite(previousUniqueUsers) ||
          eventBuckets.some((value) => !Number.isFinite(value))
        ) {
          return yield* new PostHogError({
            operation: "PostHog.fetchStats",
            message: `PostHog returned an unexpected result for ${definition.title}`,
          })
        }

        widgets.push({
          id: definition.id,
          title: definition.title,
          rangeLabel: definition.rangeLabel,
          eventCount,
          previousEventCount,
          uniqueUsers,
          previousUniqueUsers,
          eventBuckets,
        })
      }

      return {
        generatedAt: new Date().toISOString(),
        label: config.label,
        widgets,
      }
    }, (effect) =>
      effect.pipe(
        Effect.timeout("12 seconds"),
        Effect.mapError((cause) =>
          cause instanceof PostHogError
            ? cause
            : new PostHogError({
                operation: "PostHog.fetchStats",
                message: messageFrom(cause),
              })
        ),
      ))

    return Service.of({ fetchStats })
  }),
)
