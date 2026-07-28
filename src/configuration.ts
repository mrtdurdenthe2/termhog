import {
  Config,
  ConfigProvider,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect"
import { readStoredConfiguration } from "./config-file.ts"
import { parseWidgetIds, type WidgetId } from "./widgets.ts"

export interface Interface {
  readonly apiKey: Redacted.Redacted<string>
  readonly projectId: number
  readonly host: URL
  readonly cacheTtlMs: number
  readonly label: string
  readonly widgets: ReadonlyArray<WidgetId>
  readonly pathFilter: string
}

export class Service extends Context.Service<Service, Interface>()(
  "termhog/Configuration",
) {}

const positiveNumber = (name: string) =>
  Config.schema(
    Schema.NumberFromString.check(Schema.isGreaterThan(0)),
    name,
  )

const recipe = Config.all({
  apiKey: Config.redacted("POSTHOG_PERSONAL_API_KEY"),
  projectId: positiveNumber("POSTHOG_PROJECT_ID"),
  host: Config.url("POSTHOG_HOST").pipe(
    Config.withDefault(new URL("https://us.posthog.com")),
  ),
  cacheTtlSeconds: positiveNumber("TERMHOG_CACHE_TTL_SECONDS").pipe(
    Config.withDefault(300),
  ),
  label: Config.string("TERMHOG_LABEL").pipe(Config.withDefault("PostHog")),
  widgets: Config.string("TERMHOG_WIDGETS").pipe(
    Config.withDefault("24h,week,mobile"),
  ),
  pathFilter: Config.string("TERMHOG_PATH").pipe(Config.withDefault("/")),
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const stored = yield* readStoredConfiguration()
    const fileProvider = ConfigProvider.fromUnknown(
      Option.match(stored, {
        onNone: () => ({}),
        onSome: (value) => ({
          POSTHOG_PERSONAL_API_KEY: value.apiKey,
          POSTHOG_PROJECT_ID: value.projectId,
          POSTHOG_HOST: value.host,
          TERMHOG_LABEL: value.label,
          TERMHOG_WIDGETS: value.widgets?.join(","),
          TERMHOG_PATH: value.pathFilter,
        }),
      }),
    )
    const provider = ConfigProvider.fromEnv().pipe(
      ConfigProvider.orElse(fileProvider),
    )
    const config = yield* recipe.parse(provider)
    const widgets = yield* Effect.try({
      try: () => parseWidgetIds(config.widgets),
      catch: (cause) => new Error(
        cause instanceof Error ? cause.message : String(cause),
      ),
    })

    return Service.of({
      apiKey: config.apiKey,
      projectId: config.projectId,
      host: config.host,
      cacheTtlMs: config.cacheTtlSeconds * 1_000,
      label: config.label,
      widgets,
      pathFilter: config.pathFilter,
    })
  }),
)
