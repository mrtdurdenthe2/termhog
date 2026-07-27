#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Console, Effect, Schema } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { supportedShells } from "./init.ts"
import { widgetIds } from "./widgets.ts"

class ActionError extends Schema.TaggedErrorClass<ActionError>()(
  "ActionError",
  { message: Schema.String },
) {}

const action = (run: () => Promise<void>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new ActionError({
      message: cause instanceof Error ? cause.message : String(cause),
    }),
  })

const configure = Command.make(
  "configure",
  {},
  () => action(async () => (await import("./configure.ts")).runConfigure()),
).pipe(Command.withDescription("Connect a PostHog project interactively"))

const show = Command.make(
  "show",
  {},
  () => action(async () => (await import("./show.ts")).runShow()),
).pipe(Command.withDescription("Render the cached snapshot with OpenTUI"))

const refresh = Command.make(
  "refresh",
  {
    force: Flag.boolean("force").pipe(
      Flag.withAlias("f"),
      Flag.withDescription("Refresh even when the cache is fresh"),
    ),
  },
  ({ force }) => action(async () => (await import("./refresh.ts")).runRefresh(force)),
).pipe(Command.withDescription("Refresh cached PostHog statistics"))

const widgetArgument = Argument.choice("widget", widgetIds).pipe(
  Argument.withDescription("Widget to display: 24h, week, or mobile"),
  Argument.variadic({ min: 1 }),
)

const widgetList = Command.make(
  "list",
  {},
  () => action(async () => (await import("./widget-command.ts")).runWidgets(["list"])),
).pipe(Command.withDescription("List available and enabled widgets"))

const widgetSet = Command.make(
  "set",
  { widgets: widgetArgument },
  ({ widgets }) => action(async () =>
    (await import("./widget-command.ts")).runWidgets(["set", ...widgets])
  ),
).pipe(Command.withDescription("Replace widgets and set their display order"))

const widgetAdd = Command.make(
  "add",
  { widgets: widgetArgument },
  ({ widgets }) => action(async () =>
    (await import("./widget-command.ts")).runWidgets(["add", ...widgets])
  ),
).pipe(Command.withDescription("Add one or more startup widgets"))

const widgetRemove = Command.make(
  "remove",
  { widgets: widgetArgument },
  ({ widgets }) => action(async () =>
    (await import("./widget-command.ts")).runWidgets(["remove", ...widgets])
  ),
).pipe(Command.withDescription("Remove one or more startup widgets"))

const widgets = Command.make(
  "widgets",
  {},
  () => action(async () => (await import("./widget-command.ts")).runWidgets(["list"])),
).pipe(
  Command.withDescription("List or change terminal output widgets"),
  Command.withSubcommands([widgetList, widgetSet, widgetAdd, widgetRemove]),
)

const shellArgument = Argument.choice("shell", [...supportedShells, "all"]).pipe(
  Argument.withDescription("Shell configuration to update"),
  Argument.variadic(),
)

const install = Command.make(
  "install",
  { shells: shellArgument },
  ({ shells }) => action(async () => {
    const installer = await import("./init.ts")
    const requested = shells.includes("all")
      ? installer.supportedShells
      : shells.filter(
          (shell): shell is (typeof installer.supportedShells)[number] => shell !== "all",
        )
    const results = await installer.installShellIntegrations({
      ...(requested.length > 0 ? { shells: requested } : {}),
    })
    for (const result of results) {
      process.stdout.write(`${result.shell}: ${result.status} (${result.file})\n`)
    }
  }),
).pipe(Command.withDescription("Add startup hooks to installed shells"))

const init = Command.make(
  "init",
  {
    shell: Argument.choice("shell", supportedShells).pipe(
      Argument.withDescription("Shell snippet to print"),
    ),
  },
  ({ shell }) => action(async () =>
    (await import("./init.ts")).printShellIntegration(shell)
  ),
).pipe(Command.withDescription("Print shell startup integration"))

const app = Command.make(
  "termhog",
  {},
  () => action(async () => (await import("./show.ts")).runShow()),
).pipe(
  Command.withDescription("PostHog stats without slow shell startup"),
  Command.withSubcommands([
    configure,
    show,
    refresh,
    widgets,
    install,
    init,
  ]),
)

const input = Bun.argv.slice(2)
const args = input.length === 0
  ? ["show"]
  : input[0] === "help"
  ? [...input.slice(1), "--help"]
  : input.length === 1 && input[0] === "widgets"
  ? ["widgets", "list"]
  : input

Command.runWith(app, { version: "0.1.0" })(args).pipe(
  Effect.catchTag("ActionError", (error) =>
    Console.error(`termhog: ${error.message}`).pipe(
      Effect.andThen(Effect.fail(error)),
    )
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain({ disableErrorReporting: true }),
)
