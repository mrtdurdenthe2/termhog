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

const buildTrendQuery = (definitions: ReadonlyArray<WidgetDefinition>): string => {
  const selections = definitions.flatMap((definition, widgetIndex) => {
    const totalCondition = condition(definition)
    const previousCondition = condition(
      definition,
      definition.rangeHours * 2,
      definition.rangeHours,
    )
    const buckets = Array.from({ length: definition.bucketCount }, (_, bucketIndex) => {
      const start = Math.round(
        (definition.rangeHours * (definition.bucketCount - bucketIndex)) /
          definition.bucketCount,
      )
      const end = Math.round(
        (definition.rangeHours * (definition.bucketCount - bucketIndex - 1)) /
          definition.bucketCount,
      )
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

const countriesQuery = `SELECT
  properties.$geoip_country_code AS country,
  uniqExact(person_id) AS users
FROM events
WHERE timestamp >= now() - INTERVAL 168 HOUR
  AND properties.$geoip_country_code IS NOT NULL
  AND properties.$geoip_country_code != ''
GROUP BY country
ORDER BY users DESC
LIMIT 5`

const quoteHogQlString = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`

const messageFrom = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Configuration
    const client = yield* HttpClient.HttpClient
    const endpoint = new URL(
      `/api/projects/${config.projectId}/query/`,
      config.host,
    )

    const executeQuery = Effect.fn("PostHog.executeQuery")(function* (
      query: string,
      name: string,
    ) {
      const request = yield* HttpClientRequest.post(endpoint).pipe(
        HttpClientRequest.bearerToken(config.apiKey),
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyJson({
          query: { kind: "HogQLQuery", query },
          name,
          refresh: "blocking",
        }),
      )
      const response = yield* client.execute(request)
      const ok = yield* HttpClientResponse.filterStatusOk(response)
      const body = yield* Schema.decodeUnknownEffect(QueryResponse)(yield* ok.json)
      return body.results
    })

    const fetchStats = Effect.fn("PostHog.fetchStats")(function* () {
      const definitions = config.widgets.map((id) => {
        const definition = widgetDefinitions[id]
        if (id !== "path") return definition
        return {
          ...definition,
          title: config.pathFilter,
          filter: `event = '$pageview' AND properties.$pathname = ${quoteHogQlString(config.pathFilter)}`,
        }
      })
      const trendDefinitions = definitions.filter(
        (definition) => definition.kind === "trend",
      )
      const hasCountries = config.widgets.includes("countries")
      const [trendRows, countryRows] = yield* Effect.all([
        trendDefinitions.length > 0
          ? executeQuery(buildTrendQuery(trendDefinitions), "termhog_trend_widgets")
          : Effect.succeed([]),
        hasCountries
          ? executeQuery(countriesQuery, "termhog_country_widget")
          : Effect.succeed([]),
      ], { concurrency: "unbounded" })
      const row = trendRows[0]
      let offset = 0
      const widgets = new Map<string, WidgetStats>()

      for (const definition of trendDefinitions) {
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

        widgets.set(definition.id, {
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

      if (hasCountries) {
        const items = countryRows.map((countryRow) => ({
          label: String(countryRow[0]),
          value: Number(countryRow[1]),
        }))
        if (items.some((item) => !Number.isFinite(item.value))) {
          return yield* new PostHogError({
            operation: "PostHog.fetchStats",
            message: "PostHog returned an unexpected country ranking",
          })
        }
        const definition = widgetDefinitions.countries
        widgets.set("countries", {
          id: definition.id,
          title: definition.title,
          rangeLabel: definition.rangeLabel,
          eventCount: 0,
          previousEventCount: 0,
          uniqueUsers: 0,
          previousUniqueUsers: 0,
          eventBuckets: [],
          items,
        })
      }

      const orderedWidgets = config.widgets.flatMap((id) => {
        const widget = widgets.get(id)
        return widget ? [widget] : []
      })

      return {
        generatedAt: new Date().toISOString(),
        label: config.label,
        widgets: orderedWidgets,
      }
    }, (effect) =>
      effect.pipe(
        Effect.timeout("20 seconds"),
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
