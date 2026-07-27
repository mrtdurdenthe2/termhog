# termhog

Show a compact PostHog snapshot whenever a terminal opens, without putting a
network request or a TUI renderer on the shell startup path.

```text
  PostHog  ·  06:43 PM
  24h     12.3K events +18%  ·  678 users +7.4%  ·  ⡀⡄⣤⣶⣿⣷⣦⣀⣄⣤⣶⣿ 24h
  week    54.1K events +11%  ·  2.4K users -3.2%  ·  ⢀⣀⣤⣶⣶⣦⣶⣿⣿⣿⣶⣦
                                                     ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿
                                                     ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿ 7d
  mobile  4.2K events +9.1%  ·  391 users +4.8%  ·  ⡀⣀⣤⣶⣷⣦⣀⣤⣶⣿⣤⣀ 24h
```

## How It Stays Fast

`termhog-prompt` only reads and prints a cached, pre-rendered line. It never
loads Effect or OpenTUI and never accesses the network. The shell starts a
separate `termhog refresh` process in the background; that process uses Effect
to query PostHog and atomically update the cache when it is older than five
minutes.

OpenTUI is used by the optional `termhog show` command. It is deliberately not
initialized on every shell startup because native renderer setup can consume
most of a 200 ms latency budget by itself.

## Install

Requirements: Bun 1.3 or newer.

```sh
bun install
bun run build
bun link
```

Ensure `~/.bun/bin` is on `PATH`.

## Configure

Run the guided setup:

```sh
termhog configure
```

The command masks API-key input, discovers accessible projects, validates
Query Read access, saves the selected project in
`~/.config/termhog/config.json` with mode `0600`, refreshes the cache, and
installs shell hooks. Automatic project discovery requires **Organization
Read** permission; if it is unavailable, setup asks for the numeric project ID
instead.

Personal API key permissions:

- **Query Read** is required to fetch analytics and validate the connection.
- **Organization Read** enables automatic project discovery. Without it, setup
  falls back to asking for the numeric project ID.

To create the key, open PostHog's **Settings → User → Personal API keys** page
(`https://us.posthog.com/settings/user-api-keys` for US Cloud or
`https://eu.posthog.com/settings/user-api-keys` for EU Cloud), select **New
personal API key**, name it `termhog`, grant the permissions above, and create
the key. Set **Organization & project access** to **All access** and grant
**Organization Read** so termhog can automatically infer the project. This does
not mean granting every permission: **Query** remains Read-only. Without both
discovery settings, setup asks for the numeric project ID. Interactive setup
prints the correct URL for the selected host.

At the end, setup prints the commands for customizing terminal output. The main
command is `termhog widgets`; for example:

```sh
termhog widgets list
termhog widgets set 24h week mobile
```

Environment variables remain available as higher-priority overrides:

```sh
export POSTHOG_PERSONAL_API_KEY="phx_..."
export POSTHOG_PROJECT_ID="12345"
export POSTHOG_HOST="https://us.posthog.com"
```

The personal API key always needs **Query Read** access. Use
`https://eu.posthog.com` for EU Cloud or the base URL of a self-hosted
instance. `POSTHOG_HOST` defaults to US Cloud.

Optional settings:

```sh
export TERMHOG_CACHE_TTL_SECONDS="300"
export TERMHOG_LABEL="PostHog"
export TERMHOG_CACHE_DIR="$HOME/.cache/termhog"
```

For manual environment-based configuration, prime the cache once:

```sh
termhog refresh --force
```

## Shell Startup

Automatically add the hook to every installed supported shell:

```sh
termhog install
```

The installer supports zsh, bash, and fish, resolves the command paths, and is
safe to run more than once. For Powerlevel10k, it puts the snapshot before the
instant-prompt preamble and keeps the background refresh after environment
configuration. To configure selected shells or create all three configuration
files explicitly:

```sh
termhog install zsh bash
termhog install all
```

`termhog init <shell>` remains available to print a snippet for manual setup.
Do not use `eval "$(termhog init ...)"` in the startup file, as that would load
the full CLI on every terminal open.

The generated zsh/bash snippet is:

```sh
# termhog: instant cached output, then silent background refresh
termhog-prompt
(command termhog refresh >/dev/null 2>&1 &)
```

Stale data is intentionally shown once and refreshed for the next terminal.
This keeps startup deterministic even when PostHog is slow or unavailable.

## Widgets

Startup output is composed of configurable PostHog widgets. The built-ins are:

- `24h`: hourly event activity and unique users over the last 24 hours.
- `week`: a three-row daily activity chart and unique users over seven days.
- `mobile`: hourly activity filtered to `$device_type = 'Mobile'`.

Event and user percentages compare against the immediately preceding matching
period: prior 24 hours, prior seven days, or prior mobile 24 hours. A positive
change is green, a negative change is red, and activity with no previous-period
baseline is shown as `new`.

List or change the enabled lines:

```sh
termhog widgets list
termhog widgets set 24h week mobile
termhog widgets add week
termhog widgets remove mobile
```

The order passed to `termhog widgets set` is the display order. Widget
selection can also be overridden with `TERMHOG_WIDGETS=24h,week,mobile`.
Currently, `24h`, `week`, and `mobile` are the supported built-ins; custom
queries, filters, titles, and dimensions are not configurable yet.

Selected widgets are combined into one HogQL request and one events-table scan.
The weekly comparison scans 14 days to cover both adjacent seven-day periods.

## Commands

```text
termhog configure            Connect a PostHog project interactively
termhog show                 Render the cached snapshot with OpenTUI
termhog refresh [--force]    Refresh the cache when stale
termhog widgets [action]     List or change startup widgets
termhog install [shell...]   Add startup hooks to installed shells
termhog init <bash|zsh|fish> Print shell startup integration
termhog help                 Show command help
```

Commands are parsed with Effect CLI, which provides typed arguments, generated
help, validation, version output, and shell completions:

```sh
termhog --help
termhog widgets set --help
termhog --version
termhog --completions zsh
```

## Performance

Run the local startup benchmark with:

```sh
bun run bench:prompt
```

The benchmark measures the compiled prompt executable as a child process,
discards five warmups, and reports 20 samples. It excludes the asynchronous
refresh process because that does not block shell input.

## Security

The personal API key is read through Effect configuration and sent only in the
PostHog API request. The configuration file is restricted to the current user
with mode `0600`; the key is never written to the stats cache. Cached files
contain only aggregate counts, a label, and an update timestamp.
