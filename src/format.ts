import type { Stats, WidgetStats } from "./model.ts"

const RESET = "\x1b[0m"
const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"
const PINK = "\x1b[38;5;205m"
const GREEN = "\x1b[38;5;114m"
const RED = "\x1b[38;5;203m"
const regionNames = new Intl.DisplayNames(["en"], { type: "region" })

export const formatCount = (value: number): string =>
  new Intl.NumberFormat("en", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value)

export const formatPercentageChange = (
  current: number,
  previous: number,
): string => {
  if (previous === 0) return current === 0 ? "0%" : "new"
  const percentage = ((current - previous) / previous) * 100
  const formatted = new Intl.NumberFormat("en", {
    maximumFractionDigits: 1,
  }).format(Math.abs(percentage))
  if (percentage > 0) return `+${formatted}%`
  if (percentage < 0) return `-${formatted}%`
  return "0%"
}

const colorChange = (current: number, previous: number): string => {
  const change = formatPercentageChange(current, previous)
  if (current > previous) return `${GREEN}${change}${RESET}`
  if (current < previous) return `${RED}${change}${RESET}`
  return `${DIM}${change}${RESET}`
}

const brailleDots = {
  left: [0x40, 0x04, 0x02, 0x01],
  right: [0x80, 0x20, 0x10, 0x08],
} as const

export const formatBrailleGraphRows = (
  values: ReadonlyArray<number>,
  rows: number,
): ReadonlyArray<string> => {
  if (values.length === 0 || rows < 1) return []
  const maximum = Math.max(...values, 0)
  const heights = values.map((value) =>
    maximum === 0
      ? 1
      : value === 0
      ? 0
      : Math.max(1, Math.ceil((value / maximum) * rows * 4))
  )
  return Array.from({ length: rows }, (_, row) => {
    const lowerBound = (rows - row - 1) * 4
    const cells: Array<string> = []

    for (let index = 0; index < heights.length; index += 2) {
      const left = Math.max(0, Math.min(4, (heights[index] ?? 0) - lowerBound))
      const right = Math.max(0, Math.min(4, (heights[index + 1] ?? 0) - lowerBound))
      let mask = 0
      for (let dot = 0; dot < left; dot++) mask |= brailleDots.left[dot] ?? 0
      for (let dot = 0; dot < right; dot++) mask |= brailleDots.right[dot] ?? 0
      cells.push(String.fromCodePoint(0x2800 + mask))
    }

    return cells.join("")
  })
}

export const formatBrailleGraph = (values: ReadonlyArray<number>): string =>
  formatBrailleGraphRows(values, 1)[0] ?? ""

export const resampleValues = (
  values: ReadonlyArray<number>,
  targetLength: number,
): ReadonlyArray<number> => {
  if (values.length === 0 || targetLength < 1) return []
  if (values.length === 1) return Array(targetLength).fill(values[0] ?? 0)
  if (targetLength === 1) return [values[0] ?? 0]

  return Array.from({ length: targetLength }, (_, index) => {
    const position = (index * (values.length - 1)) / (targetLength - 1)
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    const progress = position - lower
    const from = values[lower] ?? 0
    const to = values[upper] ?? from
    return from + (to - from) * progress
  })
}

const formatWidgetLines = (
  widget: WidgetStats,
  color: boolean,
  titleWidth: number,
  titleOverride?: string,
): ReadonlyArray<string> => {
  const title = (titleOverride ?? widget.title).padEnd(titleWidth)
  if (widget.id === "countries") {
    const heading = color
      ? `  ${PINK}${BOLD}${title}${RESET}  top countries by users  ${DIM}·  ${widget.rangeLabel}${RESET}`
      : `  ${title}  top countries by users  ·  ${widget.rangeLabel}`
    const items = widget.items ?? []
    const names = items.map((item) => {
      try {
        return regionNames.of(item.label) ?? item.label
      } catch {
        return item.label
      }
    })
    const nameWidth = Math.max(...names.map((name) => name.length), 1)
    const indent = " ".repeat(titleWidth + 4)
    return [
      heading,
      ...items.map((item, index) => {
        const name = (names[index] ?? item.label).padEnd(nameWidth)
        const value = `${formatCount(item.value)} users`
        return color
          ? `${indent}${DIM}${index + 1}.${RESET} ${name}  ${BOLD}${value}${RESET}`
          : `${indent}${index + 1}. ${name}  ${value}`
      }),
    ]
  }

  const eventChange = formatPercentageChange(
    widget.eventCount,
    widget.previousEventCount,
  )
  const userChange = formatPercentageChange(
    widget.uniqueUsers,
    widget.previousUniqueUsers,
  )
  const summary = `${formatCount(widget.eventCount)} events ${eventChange}  ·  ${formatCount(widget.uniqueUsers)} users ${userChange}  ·  `
  const plainPrefix = `  ${title}  ${summary}`
  const colorPrefix = `  ${PINK}${BOLD}${title}${RESET}  ${BOLD}${formatCount(widget.eventCount)}${RESET} events ${colorChange(widget.eventCount, widget.previousEventCount)}  ${DIM}·${RESET}  ${BOLD}${formatCount(widget.uniqueUsers)}${RESET} users ${colorChange(widget.uniqueUsers, widget.previousUniqueUsers)}  ${DIM}·${RESET}  `
  const rowCount = widget.id === "week" ? 3 : 1
  const graphValues = widget.eventBuckets.length === 24
    ? widget.eventBuckets
    : resampleValues(widget.eventBuckets, 24)
  const graphs = formatBrailleGraphRows(graphValues, rowCount)
  const indent = " ".repeat(plainPrefix.length)

  return graphs.map((graph, index) => {
    const prefix = index === 0 ? (color ? colorPrefix : plainPrefix) : indent
    const renderedGraph = color ? `${PINK}${graph}${RESET}` : graph
    const suffix = index === graphs.length - 1
      ? color ? ` ${DIM}${widget.rangeLabel}${RESET}` : ` ${widget.rangeLabel}`
      : ""
    return `${prefix}${renderedGraph}${suffix}`
  })
}

export const formatSnapshot = (stats: Stats, color: boolean): string => {
  const time = new Date(stats.generatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })

  if (stats.widgets.length === 1 && stats.widgets[0]?.id !== "countries") {
    const widget = stats.widgets[0]
    if (!widget) return ""
    const lines = [...formatWidgetLines(
      widget,
      color,
      stats.label.length,
      stats.label,
    )]
    const timestamp = color
      ? `  ${DIM}·  ${time}${RESET}`
      : `  ·  ${time}`
    if (lines[0]) lines[0] += timestamp
    return `${lines.join("\n")}\n`
  }

  const titleWidth = Math.max(...stats.widgets.map((widget) => widget.title.length), 1)
  const heading = color
    ? `  ${PINK}${BOLD}${stats.label}${RESET}  ${DIM}·  ${time}${RESET}`
    : `  ${stats.label}  ·  ${time}`
  const widgets = stats.widgets.flatMap((widget) =>
    formatWidgetLines(widget, color, titleWidth)
  )
  return `${[heading, ...widgets].join("\n")}\n`
}

export const formatPanel = (stats: Stats): string => {
  const updated = new Date(stats.generatedAt).toLocaleString()
  return `${formatSnapshot(stats, false).trimEnd()}\n\nUpdated ${updated}`
}
