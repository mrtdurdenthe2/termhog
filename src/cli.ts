#!/usr/bin/env bun

const [command = "show", ...args] = Bun.argv.slice(2)

export {}

const usage = `termhog - PostHog stats without slow shell startup

Usage:
  termhog configure            Connect a PostHog project interactively
  termhog show                 Render the cached snapshot with OpenTUI
  termhog refresh [--force]    Refresh the cache when stale
  termhog widgets [action]     List or change startup widgets
  termhog install [shell...]   Add startup hooks to installed shells
  termhog init <bash|zsh|fish> Print shell startup integration
  termhog help                 Show this help
`

try {
  switch (command) {
    case "configure":
      await (await import("./configure.ts")).runConfigure()
      break
    case "show":
      await (await import("./show.ts")).runShow()
      break
    case "refresh":
      await (await import("./refresh.ts")).runRefresh(args.includes("--force"))
      break
    case "widgets":
      await (await import("./widget-command.ts")).runWidgets(args)
      break
    case "init":
      ;(await import("./init.ts")).printShellIntegration(args[0] ?? "")
      break
    case "install": {
      const installer = await import("./init.ts")
      const requested = args.includes("all")
        ? installer.supportedShells
        : args.length > 0
        ? args.map((shell) => {
            if (!installer.supportedShells.some((item) => item === shell)) {
              throw new Error(`Unsupported shell: ${shell}`)
            }
            return shell as (typeof installer.supportedShells)[number]
          })
        : undefined
      const results = await installer.installShellIntegrations({
        ...(requested ? { shells: requested } : {}),
      })
      for (const result of results) {
        process.stdout.write(`${result.shell}: ${result.status} (${result.file})\n`)
      }
      break
    }
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(usage)
      break
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${usage}`)
      process.exitCode = 1
  }
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause)
  process.stderr.write(`termhog: ${message}\n`)
  process.exitCode = 1
}
