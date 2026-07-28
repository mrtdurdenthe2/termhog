export const widgetIds = [
  "24h",
  "week",
  "month",
  "year",
  "mobile",
  "countries",
  "path",
] as const
export type WidgetId = typeof widgetIds[number]

export interface WidgetDefinition {
  readonly id: WidgetId
  readonly kind: "trend" | "ranking"
  readonly title: string
  readonly rangeLabel: string
  readonly rangeHours: number
  readonly bucketCount: number
  readonly filter?: string
}

export const widgetDefinitions: Readonly<Record<WidgetId, WidgetDefinition>> = {
  "24h": {
    id: "24h",
    kind: "trend",
    title: "24h",
    rangeLabel: "24h",
    rangeHours: 24,
    bucketCount: 24,
  },
  week: {
    id: "week",
    kind: "trend",
    title: "week",
    rangeLabel: "7d",
    rangeHours: 168,
    bucketCount: 7,
  },
  month: {
    id: "month",
    kind: "trend",
    title: "month",
    rangeLabel: "30d",
    rangeHours: 720,
    bucketCount: 30,
  },
  year: {
    id: "year",
    kind: "trend",
    title: "year",
    rangeLabel: "1y",
    rangeHours: 8_760,
    bucketCount: 12,
  },
  mobile: {
    id: "mobile",
    kind: "trend",
    title: "mobile",
    rangeLabel: "24h",
    rangeHours: 24,
    bucketCount: 24,
    filter: "properties.$device_type = 'Mobile'",
  },
  countries: {
    id: "countries",
    kind: "ranking",
    title: "countries",
    rangeLabel: "7d",
    rangeHours: 168,
    bucketCount: 0,
  },
  path: {
    id: "path",
    kind: "trend",
    title: "path",
    rangeLabel: "7d",
    rangeHours: 168,
    bucketCount: 7,
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
