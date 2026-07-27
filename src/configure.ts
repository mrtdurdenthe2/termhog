import { createInterface } from "node:readline/promises"
import { Effect, Redacted } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import { writeStoredConfiguration } from "./config-file.ts"
import { installShellIntegrations } from "./init.ts"
import { configurationFile } from "./paths.ts"
import {
  discoverProjects,
  type Project,
  validateQueryAccess,
} from "./setup-posthog.ts"

const ask = async (prompt: string): Promise<string> => {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await readline.question(prompt)
  } finally {
    readline.close()
  }
}

const askSecret = (prompt: string): Promise<string> => {
  if (!process.stdin.setRawMode) {
    throw new Error("Masked input is not supported by this terminal")
  }

  return new Promise((resolve, reject) => {
    let value = ""
    const wasRaw = process.stdin.isRaw

    const cleanup = () => {
      process.stdin.off("data", onData)
      process.stdin.setRawMode(wasRaw)
      process.stdin.pause()
    }
    const onData = (data: Buffer | string) => {
      for (const character of String(data)) {
        if (character === "\u0003") {
          cleanup()
          process.stdout.write("\n")
          reject(new Error("Configuration cancelled"))
          return
        }
        if (character === "\r" || character === "\n") {
          cleanup()
          process.stdout.write("\n")
          resolve(value)
          return
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1)
            process.stdout.write("\b \b")
          }
          continue
        }
        if (character >= " " && character !== "\u007f") {
          value += character
          process.stdout.write("*")
        }
      }
    }

    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on("data", onData)
  })
}

const askChoice = async (
  prompt: string,
  count: number,
  defaultChoice = 1,
): Promise<number> => {
  while (true) {
    const answer = (await ask(`${prompt} [${defaultChoice}]: `)).trim()
    const choice = answer === "" ? defaultChoice : Number(answer)
    if (Number.isInteger(choice) && choice >= 1 && choice <= count) return choice
    process.stdout.write(`Enter a number from 1 to ${count}.\n`)
  }
}

const askProjectId = async (): Promise<number> => {
  while (true) {
    const projectId = Number((await ask("Numeric project ID: ")).trim())
    if (Number.isInteger(projectId) && projectId > 0) return projectId
    process.stdout.write("Enter a positive numeric project ID.\n")
  }
}

const selectHost = async (): Promise<URL> => {
  process.stdout.write("\nPostHog region\n  1. US Cloud\n  2. EU Cloud\n  3. Self-hosted\n")
  const region = await askChoice("Region", 3)
  if (region === 1) return new URL("https://us.posthog.com")
  if (region === 2) return new URL("https://eu.posthog.com")

  while (true) {
    const value = (await ask("PostHog URL: ")).trim()
    try {
      const host = new URL(value)
      if (host.protocol === "https:" || host.hostname === "localhost") return host
    } catch {
      // The message below gives the user a concise correction.
    }
    process.stdout.write("Enter a valid HTTPS URL.\n")
  }
}

const selectProject = async (projects: ReadonlyArray<Project>): Promise<Project> => {
  if (projects.length === 1) {
    const project = projects[0]
    if (!project) throw new Error("PostHog returned no projects")
    process.stdout.write(`Found ${project.organization} / ${project.name}.\n`)
    return project
  }

  process.stdout.write("\nAvailable projects\n")
  projects.forEach((project, index) => {
    process.stdout.write(`  ${index + 1}. ${project.organization} / ${project.name} (${project.id})\n`)
  })
  const selection = await askChoice("Project", projects.length)
  const project = projects[selection - 1]
  if (!project) throw new Error("Invalid project selection")
  return project
}

const runSetupEffect = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(FetchHttpClient.layer)))

export const runConfigure = async (): Promise<void> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("`termhog configure` requires an interactive terminal")
  }

  process.stdout.write("\ntermhog configure\n")
  const host = await selectHost()
  process.stdout.write("\nCreate a PostHog personal API key\n")
  process.stdout.write(`  1. Open ${host.origin}/settings/user-api-keys\n`)
  process.stdout.write("  2. Select New personal API key\n")
  process.stdout.write("  3. Name it termhog\n")
  process.stdout.write("  4. Set Organization & project access to All access (for automatic project discovery)\n")
  process.stdout.write("  5. Grant Query Read (required for analytics)\n")
  process.stdout.write("  6. Grant Organization Read (required for automatic project discovery)\n")
  process.stdout.write("  7. Create the key and paste it below\n")
  process.stdout.write("  Without both discovery settings, setup will ask for the numeric project ID.\n\n")
  const environmentKey = process.env.POSTHOG_PERSONAL_API_KEY
  const useEnvironment = environmentKey
    ? (await ask("Use POSTHOG_PERSONAL_API_KEY from the environment? [Y/n]: "))
        .trim().toLowerCase() !== "n"
    : false
  const key = useEnvironment
    ? environmentKey
    : (await askSecret("Personal API key: ")).trim()
  if (!key) throw new Error("A personal API key is required")

  const credentials = { host, apiKey: Redacted.make(key) }
  process.stdout.write("Discovering projects...\n")

  let project: Project | undefined
  try {
    const projects = await runSetupEffect(discoverProjects(credentials))
    if (projects.length > 0) project = await selectProject(projects)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    process.stdout.write(`Automatic discovery unavailable: ${message}\n`)
  }

  if (!project) {
    process.stdout.write("Enter the project ID from PostHog project settings instead.\n")
    const projectId = await askProjectId()
    const label = (await ask("Project label [PostHog]: ")).trim() || "PostHog"
    project = { id: projectId, name: label, organization: "" }
  }

  process.stdout.write("Validating Query Read access...\n")
  await runSetupEffect(validateQueryAccess(credentials, project.id))
  await Effect.runPromise(writeStoredConfiguration({
    version: 1,
    apiKey: key,
    projectId: project.id,
    host: host.origin,
    label: project.name,
    widgets: ["24h", "week", "mobile"],
  }))

  // Ensure the initial refresh uses the values just validated, even when the
  // current shell still exports an older configuration.
  process.env.POSTHOG_PERSONAL_API_KEY = key
  process.env.POSTHOG_PROJECT_ID = String(project.id)
  process.env.POSTHOG_HOST = host.origin
  process.env.TERMHOG_LABEL = project.name
  process.env.TERMHOG_WIDGETS = "24h,week,mobile"

  const { runRefresh } = await import("./refresh.ts")
  await runRefresh(true)
  const installed = await installShellIntegrations()

  process.stdout.write(`\nConnected to ${project.name}.\n`)
  process.stdout.write(`Configuration saved to ${configurationFile} (mode 0600).\n`)
  const changed = installed.filter((result) => result.status === "installed")
  if (changed.length > 0) {
    process.stdout.write(`Shell hooks installed for ${changed.map((result) => result.shell).join(", ")}.\n`)
  }
  if (environmentKey) {
    process.stdout.write("Environment variables override this file; remove old POSTHOG_* exports when no longer needed.\n")
  }
  process.stdout.write("\nCustomize the terminal output anytime:\n")
  process.stdout.write("  termhog widgets list\n")
  process.stdout.write("  termhog widgets set 24h week mobile\n")
  process.stdout.write("  termhog widgets add week\n")
  process.stdout.write("  termhog widgets remove mobile\n")
}
