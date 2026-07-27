import { ansiSnapshotFile, textSnapshotFile } from "./paths.ts"

const snapshot = process.env.NO_COLOR === undefined
  ? ansiSnapshotFile
  : textSnapshotFile

try {
  process.stdout.write(await Bun.file(snapshot).text())
} catch {
  // A missing cache is expected before the first background refresh.
}
