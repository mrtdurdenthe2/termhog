import { Schema } from "effect"

export const WidgetStats = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  rangeLabel: Schema.String,
  eventCount: Schema.Number,
  previousEventCount: Schema.Number,
  uniqueUsers: Schema.Number,
  previousUniqueUsers: Schema.Number,
  eventBuckets: Schema.Array(Schema.Number),
})

export interface WidgetStats extends Schema.Schema.Type<typeof WidgetStats> {}

export const Stats = Schema.Struct({
  generatedAt: Schema.String,
  label: Schema.String,
  widgets: Schema.Array(WidgetStats),
})

export interface Stats extends Schema.Schema.Type<typeof Stats> {}
