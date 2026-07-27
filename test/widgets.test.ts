import { expect, test } from "bun:test"
import { parseWidgetIds } from "../src/widgets.ts"

test("parseWidgetIds validates and deduplicates widget selections", () => {
  expect(parseWidgetIds("24h, week,24h")).toEqual(["24h", "week"])
  expect(() => parseWidgetIds("24h,countries")).toThrow("Unknown widget: countries")
  expect(() => parseWidgetIds("")).toThrow("At least one widget is required")
})
