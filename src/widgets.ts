export const widgetIds = ["24h", "week", "mobile"] as const
export type WidgetId = typeof widgetIds[number]

export interface WidgetDefinition {
  readonly id: WidgetId
  readonly title: string
  readonly rangeLabel: string
  readonly rangeHours: number
  readonly bucketCount: number
  readonly bucketHours: number
  readonly filter?: string
}

export const widgetDefinitions: Readonly<Record<WidgetId, WidgetDefinition>> = {
  "24h": {
    id: "24h",
    title: "24h",
    rangeLabel: "24h",
    rangeHours: 24,
    bucketCount: 24,
    bucketHours: 1,
  },
  week: {
    id: "week",
    title: "week",
    rangeLabel: "7d",
    rangeHours: 168,
    bucketCount: 7,
    bucketHours: 24,
  },
  mobile: {
    id: "mobile",
    title: "mobile",
    rangeLabel: "24h",
    rangeHours: 24,
    bucketCount: 24,
    bucketHours: 1,
    filter: "properties.$device_type = 'Mobile'",
  },
}

export const isWidgetId = (value: string): value is WidgetId =>
  widgetIds.some((id) => id === value)

export const parseWidgetIds = (value: string): ReadonlyArray<WidgetId> => {
  const parsed = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]
  if (parsed.length === 0) throw new Error("At least one widget is required")
  const unknown = parsed.find((item) => !isWidgetId(item))
  if (unknown) throw new Error(`Unknown widget: ${unknown}`)
  return parsed.filter(isWidgetId)
}
