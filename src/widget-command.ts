import { Effect, Redacted } from "effect"
import { writeStoredConfiguration } from "./config-file.ts"
import {
  layer as ConfigurationLayer,
  Service as Configuration,
} from "./configuration.ts"
import {
  parseWidgetIds,
  widgetDefinitions,
  widgetIds,
  type WidgetId,
} from "./widgets.ts"

const readConfiguration = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* Configuration
    }).pipe(Effect.provide(ConfigurationLayer)),
  )

const requestedWidgets = (args: ReadonlyArray<string>): ReadonlyArray<WidgetId> =>
  parseWidgetIds(args.join(","))

export const runWidgets = async (args: ReadonlyArray<string>): Promise<void> => {
  const config = await readConfiguration()
  const hasWidgetOverride = process.env.TERMHOG_WIDGETS !== undefined
  const [action = "list", ...values] = args

  if (action === "list") {
    for (const id of widgetIds) {
      const enabled = config.widgets.includes(id) ? "*" : " "
      const definition = widgetDefinitions[id]
      process.stdout.write(`[${enabled}] ${id.padEnd(6)} ${definition.rangeLabel} event activity\n`)
    }
    return
  }

  let widgets: ReadonlyArray<WidgetId>
  switch (action) {
    case "set":
      widgets = requestedWidgets(values)
      break
    case "add": {
      const additions = requestedWidgets(values)
      widgets = widgetIds.filter((id) =>
        config.widgets.includes(id) || additions.includes(id)
      )
      break
    }
    case "remove": {
      const removals = requestedWidgets(values)
      widgets = config.widgets.filter((id) => !removals.includes(id))
      if (widgets.length === 0) throw new Error("At least one widget is required")
      break
    }
    default:
      throw new Error("Usage: termhog widgets [list|set|add|remove] [24h|week|mobile ...]")
  }

  await Effect.runPromise(writeStoredConfiguration({
    version: 1,
    apiKey: Redacted.value(config.apiKey),
    projectId: config.projectId,
    host: config.host.origin,
    label: config.label,
    widgets: [...widgets],
  }))

  process.env.TERMHOG_WIDGETS = widgets.join(",")
  const { runRefresh } = await import("./refresh.ts")
  await runRefresh(true)
  process.stdout.write(`Widgets: ${widgets.join(", ")}\n`)

  if (hasWidgetOverride) {
    process.stdout.write("Saved widget settings can be overridden by TERMHOG_WIDGETS.\n")
  }
}
