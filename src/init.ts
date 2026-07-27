import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

export const supportedShells = ["bash", "zsh", "fish"] as const
export type SupportedShell = typeof supportedShells[number]

const common = `# termhog: instant cached output, then silent background refresh
termhog-prompt
(command termhog refresh >/dev/null 2>&1 &)`

const fish = `# termhog: instant cached output, then silent background refresh
termhog-prompt
command termhog refresh >/dev/null 2>&1 &; disown`

export const shellIntegration = (shell: SupportedShell): string =>
  shell === "fish" ? fish : common

export const printShellIntegration = (shell: string): void => {
  if (!isSupportedShell(shell)) {
    throw new Error("Supported shells: bash, zsh, fish")
  }
  process.stdout.write(`${shellIntegration(shell)}\n`)
}

export interface InstallResult {
  readonly shell: SupportedShell
  readonly file: string
  readonly status: "installed" | "already-installed" | "shell-not-found"
}

interface InstallOptions {
  readonly home?: string
  readonly shells?: ReadonlyArray<SupportedShell>
  readonly termhogPath?: string
  readonly promptPath?: string
  readonly shellExists?: (shell: SupportedShell) => boolean
}

const isSupportedShell = (shell: string): shell is SupportedShell =>
  supportedShells.some((supported) => supported === shell)

const configFile = (home: string, shell: SupportedShell): string => {
  switch (shell) {
    case "bash": return `${home}/.bashrc`
    case "zsh": return `${home}/.zshrc`
    case "fish": return `${home}/.config/fish/config.fish`
  }
}

const installedIntegration = (
  shell: SupportedShell,
  termhogPath: string,
  promptPath: string,
): string => {
  const header = "# termhog: instant cached output, then silent background refresh"
  if (shell === "fish") {
    return `${header}\n"${promptPath}"\ncommand "${termhogPath}" refresh >/dev/null 2>&1 &; disown`
  }
  return `${header}\n"${promptPath}"\n(command "${termhogPath}" refresh >/dev/null 2>&1 &)`
}

const installWithPowerlevel10k = async (
  file: string,
  existing: string,
  termhogPath: string,
  promptPath: string,
): Promise<void> => {
  const display = `# termhog output must run before Powerlevel10k's instant-prompt preamble.\n"${promptPath}"`
  const refresh = `# termhog: silent background refresh\n(command "${termhogPath}" refresh >/dev/null 2>&1 &)`
  const separator = existing.endsWith("\n") ? "" : "\n"
  await Bun.write(file, `${display}\n\n${existing}${separator}\n${refresh}\n`)
}

export const installShellIntegrations = async (
  options: InstallOptions = {},
): Promise<ReadonlyArray<InstallResult>> => {
  const home = options.home ?? process.env.HOME
  if (!home) throw new Error("HOME is not set")

  const shellExists = options.shellExists ?? ((shell) => Bun.which(shell) !== null)
  const shells = options.shells ?? supportedShells
  const termhogPath = options.termhogPath ?? Bun.which("termhog") ?? `${home}/.bun/bin/termhog`
  const promptPath = options.promptPath ?? Bun.which("termhog-prompt") ?? `${home}/.bun/bin/termhog-prompt`
  const results: Array<InstallResult> = []

  for (const shell of shells) {
    const file = configFile(home, shell)
    if (!shellExists(shell)) {
      results.push({ shell, file, status: "shell-not-found" })
      continue
    }

    const target = Bun.file(file)
    const existing = await target.exists() ? await target.text() : ""
    if (existing.includes("termhog-prompt") && existing.includes("refresh >/dev/null")) {
      results.push({ shell, file, status: "already-installed" })
      continue
    }

    await mkdir(dirname(file), { recursive: true })
    if (shell === "zsh" && existing.includes("p10k-instant-prompt-")) {
      await installWithPowerlevel10k(
        file,
        existing,
        termhogPath,
        promptPath,
      )
      results.push({ shell, file, status: "installed" })
      continue
    }

    const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n"
    await appendFile(
      file,
      `${separator}\n${installedIntegration(shell, termhogPath, promptPath)}\n`,
      "utf8",
    )
    results.push({ shell, file, status: "installed" })
  }

  return results
}
