import { open, mkdir, rename, rm, stat } from "node:fs/promises"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { formatSnapshot } from "./format.ts"
import { Stats } from "./model.ts"
import {
  ansiSnapshotFile,
  cacheDirectory,
  cacheFile,
  refreshLockFile,
  textSnapshotFile,
} from "./paths.ts"

export class CacheError extends Schema.TaggedErrorClass<CacheError>()(
  "CacheError",
  { operation: Schema.String, message: Schema.String },
) {}

export interface Interface {
  readonly read: () => Effect.Effect<Option.Option<Stats>>
  readonly write: (stats: Stats) => Effect.Effect<void, CacheError>
  readonly withRefreshLock: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<Option.Option<A>, E | CacheError, R>
}

export class Service extends Context.Service<Service, Interface>()(
  "termhog/Cache",
) {}

const cacheError = (operation: string) => (cause: unknown) =>
  new CacheError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  })

const ensureDirectory = Effect.tryPromise({
  try: () => mkdir(cacheDirectory, { recursive: true }),
  catch: cacheError("Cache.ensureDirectory"),
})

export const layer = Layer.succeed(
  Service,
  Service.of({
    read: Effect.fn("Cache.read")(function* () {
      const exists = yield* Effect.promise(() => Bun.file(cacheFile).exists())
      if (!exists) return Option.none()

      const value = yield* Effect.tryPromise(() => Bun.file(cacheFile).json()).pipe(
        Effect.option,
      )
      if (Option.isNone(value)) return Option.none()

      return Schema.decodeUnknownOption(Stats)(value.value)
    }),

    write: Effect.fn("Cache.write")(function* (stats) {
      yield* ensureDirectory
      const suffix = `${process.pid}-${Date.now()}.tmp`
      const writes = [
        [cacheFile, `${cacheFile}.${suffix}`, `${JSON.stringify(stats)}\n`],
        [textSnapshotFile, `${textSnapshotFile}.${suffix}`, formatSnapshot(stats, false)],
        [ansiSnapshotFile, `${ansiSnapshotFile}.${suffix}`, formatSnapshot(stats, true)],
      ] as const

      yield* Effect.forEach(writes, ([target, temporary, content]) =>
        Effect.tryPromise({
          try: async () => {
            await Bun.write(temporary, content)
            await rename(temporary, target)
          },
          catch: cacheError("Cache.write"),
        }),
      )
    }),

    withRefreshLock: (effect) =>
      Effect.gen(function* () {
        yield* ensureDirectory

        const acquired = yield* Effect.tryPromise(async () => {
          try {
            const handle = await open(refreshLockFile, "wx")
            await handle.close()
            return true
          } catch (cause) {
            if (
              cause instanceof Error &&
              "code" in cause &&
              cause.code === "EEXIST"
            ) {
              const lock = await stat(refreshLockFile).catch(() => undefined)
              if (lock && Date.now() - lock.mtimeMs > 30_000) {
                await rm(refreshLockFile, { force: true })
                const handle = await open(refreshLockFile, "wx")
                await handle.close()
                return true
              }
              return false
            }
            throw cause
          }
        }).pipe(Effect.mapError(cacheError("Cache.acquireLock")))

        if (!acquired) return Option.none()

        return yield* effect.pipe(
          Effect.map(Option.some),
          Effect.ensuring(
            Effect.promise(() => rm(refreshLockFile, { force: true })),
          ),
        )
      }),
  }),
)
