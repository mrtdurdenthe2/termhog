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
  const hasPathOverride = process.env.TERMHOG_PATH !== undefined
  const [action = "list", ...values] = args

  if (action === "list") {
    for (const id of widgetIds) {
      const enabled = config.widgets.includes(id) ? "*" : " "
      const definition = widgetDefinitions[id]
      const description = id === "countries"
        ? "top 5 countries by users"
        : id === "path"
        ? `${definition.rangeLabel} pageviews for ${config.pathFilter}`
        : `${definition.rangeLabel} event activity`
      process.stdout.write(`[${enabled}] ${id.padEnd(9)} ${description}\n`)
    }
    return
  }

  let widgets: ReadonlyArray<WidgetId>
  let pathFilter = config.pathFilter
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
    case "path": {
      const selectedPath = values[0]?.trim()
      if (!selectedPath || !selectedPath.startsWith("/")) {
        throw new Error("Path must start with `/`, for example `/pricing`")
      }
      pathFilter = selectedPath
      widgets = config.widgets.includes("path")
        ? config.widgets
        : [...config.widgets, "path"]
      break
    }
    default:
      throw new Error("Usage: termhog widgets [list|set|add|remove|path]")
  }

  await Effect.runPromise(writeStoredConfiguration({
    version: 1,
    apiKey: Redacted.value(config.apiKey),
    projectId: config.projectId,
    host: config.host.origin,
    label: config.label,
    widgets: [...widgets],
    pathFilter,
  }))

  process.env.TERMHOG_WIDGETS = widgets.join(",")
  process.env.TERMHOG_PATH = pathFilter
  const { runRefresh } = await import("./refresh.ts")
  await runRefresh(true)
  process.stdout.write(`Widgets: ${widgets.join(", ")}\n`)
  if (action === "path") process.stdout.write(`Path filter: ${pathFilter}\n`)

  if (hasWidgetOverride) {
    process.stdout.write("Saved widget settings can be overridden by TERMHOG_WIDGETS.\n")
  }
  if (hasPathOverride) {
    process.stdout.write("Saved path settings can be overridden by TERMHOG_PATH.\n")
  }
}
