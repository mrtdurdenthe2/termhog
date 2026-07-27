import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { installShellIntegrations } from "../src/init.ts"

const directories: Array<string> = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe("installShellIntegrations", () => {
  test("installs shell-specific hooks and is idempotent", async () => {
    const home = await mkdtemp(`${tmpdir()}/termhog-install-`)
    directories.push(home)
    const options = {
      home,
      shells: ["zsh", "fish"] as const,
      termhogPath: "/opt/termhog",
      promptPath: "/opt/termhog-prompt",
      shellExists: () => true,
    }

    const first = await installShellIntegrations(options)
    const second = await installShellIntegrations(options)
    const zsh = await Bun.file(`${home}/.zshrc`).text()
    const fish = await Bun.file(`${home}/.config/fish/config.fish`).text()

    expect(first.map((result) => result.status)).toEqual(["installed", "installed"])
    expect(second.map((result) => result.status)).toEqual([
      "already-installed",
      "already-installed",
    ])
    expect(zsh.match(/termhog-prompt/g)).toHaveLength(1)
    expect(zsh).toContain("(command \"/opt/termhog\" refresh")
    expect(fish).toContain("&; disown")
  })

  test("does not create files for unavailable shells", async () => {
    const home = await mkdtemp(`${tmpdir()}/termhog-install-`)
    directories.push(home)

    const result = await installShellIntegrations({
      home,
      shells: ["bash"],
      shellExists: () => false,
    })

    expect(result[0]?.status).toBe("shell-not-found")
    expect(await Bun.file(`${home}/.bashrc`).exists()).toBe(false)
  })

  test("places zsh output before the Powerlevel10k instant prompt", async () => {
    const home = await mkdtemp(`${tmpdir()}/termhog-install-`)
    directories.push(home)
    const zshrc = `${home}/.zshrc`
    await Bun.write(
      zshrc,
      `if [[ -r "$HOME/.cache/p10k-instant-prompt-user.zsh" ]]; then\n  source "$HOME/.cache/p10k-instant-prompt-user.zsh"\nfi\nexport POSTHOG_PROJECT_ID="1"\n`,
    )

    await installShellIntegrations({
      home,
      shells: ["zsh"],
      termhogPath: "/opt/termhog",
      promptPath: "/opt/termhog-prompt",
      shellExists: () => true,
    })
    const result = await Bun.file(zshrc).text()

    expect(result.indexOf("termhog-prompt")).toBeLessThan(
      result.indexOf("p10k-instant-prompt-"),
    )
    expect(result.indexOf("termhog\" refresh")).toBeGreaterThan(
      result.indexOf("POSTHOG_PROJECT_ID"),
    )
  })
})
