import z from "zod"
import { Effect } from "effect"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import * as Tool from "./tool"

const execFileAsync = promisify(execFile)

const BdParameters = z.object({
  args: z.array(z.string()).describe("Arguments to pass to the bd CLI (e.g., ['list', '--json'])"),
  workdir: z.string().describe("Working directory for the bd command").optional(),
})

type BdMetadata = { command: string; returncode: number }

export const BdTool = Tool.define(
  "cogitor_bd",
  Effect.gen(function* () {
    return {
      description:
        "Run beads (bd) CLI commands for issue tracking. Supports: list, show, create, update, delete, search, swarm.\n" +
        "Use --json flag to get structured JSON output.\n" +
        "Examples: ['list', '--json'], ['show', 'cogitor-e8e', '--json'], ['create', '--json']",
      parameters: BdParameters,
      execute: (params: z.infer<typeof BdParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const cmd = ["bd", ...params.args]
          const opts = { cwd: params.workdir || (ctx.extra?.worktree as string) || (ctx.extra?.directory as string) || ".", timeout: 30000 }
          try {
            const { stdout, stderr } = yield* Effect.promise(() =>
              execFileAsync(cmd[0], cmd.slice(1), opts),
            )
            return {
              title: `bd ${params.args.join(" ")}`,
              output: stdout || stderr || "(no output)",
              metadata: { command: params.args.join(" "), returncode: 0 },
            }
          } catch (e) {
            const err = e as { stdout?: string; stderr?: string; code?: number }
            return {
              title: `bd ${params.args.join(" ")} (error)`,
              output: err.stderr || err.stdout || String(e),
              metadata: { command: params.args.join(" "), returncode: err.code ?? 1 },
            }
          }
        }),
    }
  }),
)

const KbQueryParameters = z.object({
  query: z.string().describe("Search query for the knowledge base"),
  limit: z
    .number()
    .describe("Maximum number of results to return")
    .optional()
    .default(5),
})

type KbQueryMetadata = { query: string; results: number }

export const KbQueryTool = Tool.define(
  "cogitor_kb_query",
  Effect.gen(function* () {
    return {
      description:
        "Search the Cogitor knowledge base (KB) for relevant documentation and guides.\n" +
        "The KB contains project documentation, best practices, and procedural guides.\n" +
        "Use this before performing tasks to find existing guidance.",
      parameters: KbQueryParameters,
      execute: (params: z.infer<typeof KbQueryParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const workdir = (ctx.extra?.worktree as string) || (ctx.extra?.directory as string) || "."
          try {
            const { stdout } = yield* Effect.promise(() =>
              execFileAsync("kb_search", [params.query, "--limit", String(params.limit)], {
                cwd: workdir,
                timeout: 15000,
              }),
            )
            return {
              title: `KB search: ${params.query}`,
              output: stdout || "(no results found)",
              metadata: { query: params.query, results: Number((stdout.match(/\d+/g) || []).pop() ?? "0") },
            }
          } catch {
            try {
              const { stdout } = yield* Effect.promise(() =>
                execFileAsync("grep", ["-ri", "--max-count=3", "-l", params.query, "docs/kb/"], {
                  cwd: workdir,
                  timeout: 10000,
                }),
              )
              const files = stdout
                .split("\n")
                .filter(Boolean)
                .slice(0, params.limit)
              return {
                title: `KB search: ${params.query}`,
                output: files.length > 0
                  ? files.map((f) => `- ${f}`).join("\n")
                  : `(no results found for: ${params.query})`,
                metadata: { query: params.query, results: files.length },
              }
            } catch {
              return {
                title: `KB search: ${params.query}`,
                output: `(KB not available: unable to search knowledge base)`,
                metadata: { query: params.query, results: 0 },
              }
            }
          }
        }),
    }
  }),
)

const SpawnAgentParameters = z.object({
  persona: z.string().describe("Persona to use (e.g., architect, coder, tdd-guide, reviewer)"),
  task: z.string().describe("Task description for the agent"),
  bead_id: z
    .string()
    .describe("Bead ID to assign to this agent (optional, creates new bead if not specified)")
    .optional(),
  workdir: z
    .string()
    .describe("Worktree directory for the agent (optional, creates new worktree if not specified)")
    .optional(),
})

type SpawnAgentMetadata = { persona: string; agent_name: string; worktree: string }

export const SpawnAgentTool = Tool.define(
  "cogitor_spawn_agent",
  Effect.gen(function* () {
    return {
      description:
        "Spawn a new Cogitor agent with a specific persona to work on a task.\n" +
        "Agents run in isolated worktrees and report status via heartbeat files.\n" +
        "Available personas: architect, coder, tdd-guide, reviewer, security-auditor, docs-writer, perf-tuner, devops, release-manager, cos (chief-of-staff)\n" +
        "Use this to dispatch parallel work to specialized agents.",
      parameters: SpawnAgentParameters,
      execute: (params: z.infer<typeof SpawnAgentParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const workdir = params.workdir || (ctx.extra?.worktree as string) || (ctx.extra?.directory as string) || "."
          const agentName = params.persona.replace(/[^a-zA-Z0-9_-]/g, "_")
          const cmd = ["cogitor", "--spawn", params.persona, "--task", params.task]
          if (params.bead_id) cmd.push("--bead", params.bead_id)
          if (params.workdir) cmd.push("--worktree", params.workdir)

          try {
            const { stdout, stderr } = yield* Effect.promise(() =>
              execFileAsync(cmd[0], cmd.slice(1), {
                cwd: workdir,
                timeout: 30000,
              }),
            )
            return {
              title: `Spawned ${params.persona} agent`,
              output: stdout || stderr || `Agent ${params.persona} spawned successfully`,
              metadata: { persona: params.persona, agent_name: agentName, worktree: params.workdir ?? "" },
            }
          } catch (e) {
            const err = e as { stdout?: string; stderr?: string; code?: number }
            return {
              title: `Spawn ${params.persona} failed`,
              output: err.stderr || err.stdout || String(e),
              metadata: { persona: params.persona, agent_name: agentName, worktree: "" },
            }
          }
        }),
    }
  }),
)

const ReportStatusParameters = z.object({
  summary: z.string().describe("Brief summary of what was accomplished in this iteration").optional(),
  errors: z.record(z.string(), z.unknown()).describe("Structured error information (optional)").optional(),
  persona: z.string().describe("Persona name for the heartbeat (optional, defaults to agent persona)").optional(),
})

type ReportStatusMetadata = { summary: string; iterations: number }

export const ReportStatusTool = Tool.define(
  "cogitor_report_status",
  Effect.gen(function* () {
    return {
      description:
        "Report agent status and write a heartbeat file for the Cogitor orchestrator.\n" +
        "This updates the agent's heartbeat so the orchestrator knows the agent is alive and making progress.\n" +
        "Use this at the end of each iteration to report what was accomplished.",
      parameters: ReportStatusParameters,
      execute: (params: z.infer<typeof ReportStatusParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const workdir = (ctx.extra?.worktree as string) || (ctx.extra?.directory as string) || "."
          const heartbeatFile = ".cogitor.heartbeat"
          const heartbeatPath = `${workdir}/${heartbeatFile}`

          const timestamp = new Date().toISOString()
          const persona = params.persona || (ctx.extra?.persona as string) || "unknown"
          const iter = (ctx.extra?.iteration as number) || 0

          const heartbeatData = JSON.stringify({
            timestamp,
            iteration: iter,
            pid: process.pid,
            persona,
            summary: params.summary || "(no summary)",
            errors: params.errors || null,
          })

          const fs = yield* Effect.promise(() => import("node:fs/promises"))
          try {
            yield* Effect.promise(() => fs.mkdir(workdir, { recursive: true }))
            yield* Effect.promise(() => fs.writeFile(heartbeatPath, heartbeatData))

            return {
              title: `Status reported (iter ${iter})`,
              output: `Heartbeat written to ${heartbeatPath}\n${heartbeatData}`,
              metadata: { summary: params.summary ?? "", iterations: iter },
            }
          } catch (e) {
            return {
              title: `Status report failed`,
              output: `Failed to write heartbeat: ${e}`,
              metadata: { summary: params.summary ?? "", iterations: iter },
            }
          }
        }),
    }
  }),
)