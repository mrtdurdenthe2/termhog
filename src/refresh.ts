import { Effect, Layer, Option } from "effect"
import { layer as CacheLayer, Service as Cache } from "./cache.ts"
import {
  layer as ConfigurationLayer,
  Service as Configuration,
} from "./configuration.ts"
import { layer as PostHogLayer, Service as PostHog } from "./posthog.ts"
import { FetchHttpClient } from "effect/unstable/http"

const PostHogLive = PostHogLayer.pipe(
  Layer.provide(ConfigurationLayer),
  Layer.provide(FetchHttpClient.layer),
)

const AppLayer = Layer.mergeAll(
  CacheLayer,
  ConfigurationLayer,
  PostHogLive,
)

const refresh = (force: boolean) =>
  Effect.gen(function* () {
    const cache = yield* Cache
    const config = yield* Configuration
    const posthog = yield* PostHog

    const result = yield* cache.withRefreshLock(
      Effect.gen(function* () {
        const cached = yield* cache.read()
        if (
          !force &&
          Option.isSome(cached) &&
          Date.now() - Date.parse(cached.value.generatedAt) < config.cacheTtlMs
        ) {
          return "fresh" as const
        }

        const stats = yield* posthog.fetchStats()
        yield* cache.write(stats)
        return "updated" as const
      }),
    )

    return Option.getOrElse(result, () => "locked" as const)
  }).pipe(Effect.provide(AppLayer))

export const runRefresh = async (force: boolean): Promise<void> => {
  const result = await Effect.runPromise(refresh(force))
  if (process.stdout.isTTY) process.stdout.write(`${result}\n`)
}
