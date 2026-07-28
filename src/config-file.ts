import { chmod, mkdir, open, rename, rm } from "node:fs/promises"
import { Effect, Option, Schema } from "effect"
import { configurationDirectory, configurationFile } from "./paths.ts"

export const StoredConfiguration = Schema.Struct({
  version: Schema.Number,
  apiKey: Schema.NonEmptyString,
  projectId: Schema.Number.check(Schema.isGreaterThan(0)),
  host: Schema.String,
  label: Schema.NonEmptyString,
  widgets: Schema.optionalKey(Schema.Array(Schema.String)),
  pathFilter: Schema.optionalKey(Schema.String),
})

export interface StoredConfiguration
  extends Schema.Schema.Type<typeof StoredConfiguration> {}

export class ConfigurationFileError
  extends Schema.TaggedErrorClass<ConfigurationFileError>()(
    "ConfigurationFileError",
    { operation: Schema.String, message: Schema.String },
  ) {}

const configurationFileError = (operation: string) => (cause: unknown) =>
  new ConfigurationFileError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  })

export const readStoredConfiguration = Effect.fn("ConfigurationFile.read")(
  function* () {
    const file = Bun.file(configurationFile)
    if (!(yield* Effect.promise(() => file.exists()))) return Option.none()

    const value = yield* Effect.tryPromise({
      try: () => file.json(),
      catch: configurationFileError("ConfigurationFile.read"),
    })
    const config = yield* Schema.decodeUnknownEffect(StoredConfiguration)(value).pipe(
      Effect.mapError(configurationFileError("ConfigurationFile.decode")),
    )
    return Option.some(config)
  },
)

export const writeStoredConfiguration = Effect.fn("ConfigurationFile.write")(
  function* (config: StoredConfiguration) {
    const temporary = `${configurationFile}.${process.pid}-${Date.now()}.tmp`
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(configurationDirectory, { recursive: true, mode: 0o700 })
        await chmod(configurationDirectory, 0o700)
        const handle = await open(temporary, "wx", 0o600)
        try {
          await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, "utf8")
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temporary, configurationFile)
        await chmod(configurationFile, 0o600)
      },
      catch: async (cause) => {
        await rm(temporary, { force: true }).catch(() => undefined)
        return configurationFileError("ConfigurationFile.write")(cause)
      },
    })
  },
)
