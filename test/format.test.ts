import { describe, expect, test } from "bun:test"
import {
  formatBrailleGraph,
  formatBrailleGraphRows,
  formatCount,
  formatPercentageChange,
  formatSnapshot,
  resampleValues,
} from "../src/format.ts"
import type { Stats } from "../src/model.ts"

const stats: Stats = {
  generatedAt: "2026-07-27T12:00:00.000Z",
  label: "PostHog",
  widgets: [{
    id: "24h",
    title: "24h",
    rangeLabel: "24h",
    eventCount: 12_345,
    previousEventCount: 10_000,
    uniqueUsers: 678,
    previousUniqueUsers: 700,
    eventBuckets: Array.from({ length: 24 }, (_, index) => index + 1),
  }],
}

describe("formatSnapshot", () => {
  test("renders a compact one-line snapshot", () => {
    const output = formatSnapshot(stats, false)

    expect(output.split("\n")).toHaveLength(2)
    expect(output).toContain("12.3K events")
    expect(output).toContain("678 users")
    expect(output).toContain("24h")
    expect(output).not.toContain("\x1b[")
  })

  test("adds ANSI styling only when requested", () => {
    expect(formatSnapshot(stats, true)).toContain("\x1b[")
  })

  test("renders multiple widgets on separate lines", () => {
    const output = formatSnapshot({
      ...stats,
      widgets: [
        ...stats.widgets,
        {
          id: "week",
          title: "week",
          rangeLabel: "7d",
          eventCount: 50_000,
          previousEventCount: 40_000,
          uniqueUsers: 2_000,
          previousUniqueUsers: 1_800,
          eventBuckets: [1, 3, 2, 5, 8, 4, 7],
        },
      ],
    }, false)

    expect(output).toContain("\n  24h ")
    expect(output).toContain("\n  week")
    expect(output.split("\n")).toHaveLength(6)
  })
})

test("formatCount keeps small values exact", () => {
  expect(formatCount(9_999)).toBe("9,999")
})

test("formatPercentageChange compares matching periods", () => {
  expect(formatPercentageChange(125, 100)).toBe("+25%")
  expect(formatPercentageChange(75, 100)).toBe("-25%")
  expect(formatPercentageChange(0, 0)).toBe("0%")
  expect(formatPercentageChange(1, 0)).toBe("new")
})

test("formatBrailleGraph packs two hourly values into each cell", () => {
  const graph = formatBrailleGraph(
    Array.from({ length: 24 }, (_, index) => index + 1),
  )

  expect(Array.from(graph)).toHaveLength(12)
  expect(graph).toMatch(/[\u2800-\u28ff]+/)
  expect(formatBrailleGraph(Array(24).fill(0))).toBe("⣀".repeat(12))
})

test("formatBrailleGraphRows scales values across multiple terminal rows", () => {
  const rows = formatBrailleGraphRows(
    resampleValues([1, 2, 3, 4, 5, 6, 7], 24),
    3,
  )

  expect(rows).toHaveLength(3)
  expect(rows.every((row) => Array.from(row).length === 12)).toBe(true)
  expect(rows[0]).not.toBe(rows[2])
})

test("resampleValues preserves graph endpoints", () => {
  const values = resampleValues([10, 20, 5], 24)

  expect(values).toHaveLength(24)
  expect(values[0]).toBe(10)
  expect(values[23]).toBe(5)
})
