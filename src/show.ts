import { Effect, Option } from "effect"
import { layer as CacheLayer, Service as Cache } from "./cache.ts"
import { formatPanel, formatSnapshot } from "./format.ts"

export const runShow = async (): Promise<void> => {
  const stats = await Effect.runPromise(
    Effect.gen(function* () {
      const cache = yield* Cache
      return yield* cache.read()
    }).pipe(Effect.provide(CacheLayer)),
  )

  if (Option.isNone(stats)) {
    throw new Error("No cached stats. Run `termhog refresh --force` first.")
  }

  if (!process.stdout.isTTY) {
    process.stdout.write(formatSnapshot(stats.value, false))
    return
  }

  const { createCliRenderer, TextRenderable } = await import("@opentui/core")
  const panel = formatPanel(stats.value)
  const panelHeight = panel.split("\n").length
  const renderer = await createCliRenderer({
    screenMode: "split-footer",
    footerHeight: 1,
    externalOutputMode: "capture-stdout",
    clearOnShutdown: false,
    useMouse: false,
    useKittyKeyboard: null,
    consoleMode: "disabled",
  })

  try {
    renderer.writeToScrollback((context) => {
      const root = new TextRenderable(context.renderContext, {
        id: "termhog-stats",
        position: "absolute",
        left: 2,
        top: 0,
        width: Math.max(1, context.width - 4),
        height: panelHeight,
        content: panel,
        fg: "#f5f5f5",
      })

      return {
        root,
        width: context.width,
        height: panelHeight,
        startOnNewLine: true,
        trailingNewline: true,
      }
    })
    await renderer.idle()
  } finally {
    renderer.destroy()
  }
}
