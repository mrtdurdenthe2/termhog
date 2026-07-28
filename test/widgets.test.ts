import { expect, test } from "bun:test"
import { parseWidgetIds, widgetDefinitions } from "../src/widgets.ts"

test("parseWidgetIds validates and deduplicates widget selections", () => {
  expect(parseWidgetIds("24h, week,24h")).toEqual(["24h", "week"])
  expect(parseWidgetIds("month,year,countries,path")).toEqual([
    "month",
    "year",
    "countries",
    "path",
  ])
  expect(() => parseWidgetIds("24h,retention")).toThrow("Unknown widget: retention")
  expect(() => parseWidgetIds("")).toThrow("At least one widget is required")
})

test("long-range and filtered widgets have bounded chart buckets", () => {
  expect(widgetDefinitions.month).toMatchObject({
    rangeHours: 720,
    bucketCount: 30,
  })
  expect(widgetDefinitions.year).toMatchObject({
    rangeHours: 8_760,
    bucketCount: 12,
  })
  expect(widgetDefinitions.countries.kind).toBe("ranking")
  expect(widgetDefinitions.path.rangeLabel).toBe("7d")
})
