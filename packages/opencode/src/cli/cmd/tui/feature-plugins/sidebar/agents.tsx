import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const id = "cogitor:sidebar-agents"
const execFileAsync = promisify(execFile)

type AgentData = {
  name: string
  pid: number | null
  pid_alive: boolean
  elapsed_seconds: number | null
  health: string
  health_reason: string
  heartbeat_timestamp: string | null
  heartbeat_age_seconds: number | null
  heartbeat_iteration: number | null
  heartbeat_persona: string | null
  heartbeat_summary: string | null
  commits_ahead: number
  uncommitted_files: number
  bead_id: string | null
  bead_title: string | null
  bead_status: string | null
}

type StatusData = {
  agents: AgentData[]
  total: number
  swarm?: {
    epic: string
    progress: string
    completed: string[]
    active: Array<{ bead: string; agent: string; health: string | null }>
    ready: string[]
    blocked: string[]
  }
}

const HEALTH_COLORS: Record<string, string> = {
  healthy: "success",
  slow: "warning",
  stuck: "error",
  zombie: "error",
  exited: "textMuted",
  unknown: "textMuted",
}

const HEALTH_ICONS: Record<string, string> = {
  healthy: "\u2705",
  slow: "\u{1F7E1}",
  stuck: "\u{1F534}",
  zombie: "\u{1F480}",
  exited: "\u2B1B",
  unknown: "\u2753",
}

function fmtTime(seconds: number | null): string {
  if (seconds === null) return "-"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}h${(m % 60).toString().padStart(2, "0")}m`
  }
  return `${m}m${s.toString().padStart(2, "0")}s`
}

function View(props: { api: TuiPluginApi; data: () => StatusData | null }) {
  const theme = () => props.api.theme.current
  const agents = createMemo(() => {
    const d = props.data()
    if (!d) return []
    return d.agents.sort((a, b) => {
      const order = ["healthy", "slow", "stuck", "zombie", "exited", "unknown"]
      return order.indexOf(a.health) - order.indexOf(b.health)
    })
  })

  return (
    <Show when={agents().length > 0}>
      <box>
        <text fg={theme().text}>
          <b>Agents</b>{" "}
          <span style={{ fg: theme().textMuted }}>({agents().length})</span>
        </text>
        <For each={agents()}>
          {(agent) => (
            <box flexDirection="row" gap={1}>
              <text style={{ fg: HEALTH_COLORS[agent.health] ?? "textMuted" }}>
                {HEALTH_ICONS[agent.health] ?? "?"}
              </text>
              <box flexDirection="column" flexGrow={1} gap={0}>
                <text fg={theme().text} wrapMode="word">
                  <b>{agent.name}</b>
                  <Show when={agent.heartbeat_persona}>
                    <span style={{ fg: theme().textMuted }}>/{agent.heartbeat_persona}</span>
                  </Show>
                </text>
                <Show when={agent.heartbeat_summary}>
                  <text fg={theme().textMuted} wrapMode="word">
                    {agent.heartbeat_summary}
                  </text>
                </Show>
                <text fg={theme().textMuted}>
                  iter={agent.heartbeat_iteration ?? "-"} elapsed={fmtTime(agent.elapsed_seconds)} hb=
                  {agent.heartbeat_age_seconds !== null ? `${Math.round(agent.heartbeat_age_seconds)}s ago` : "-"}{" "}
                  commits={agent.commits_ahead} dirty={agent.uncommitted_files}
                </text>
                <Show when={agent.bead_id}>
                  <text fg={theme().textMuted}>
                    bead:{agent.bead_id}
                    <Show when={agent.bead_title}>
                      <span style={{ fg: theme().textMuted }}> {agent.bead_title}</span>
                    </Show>
                  </text>
                </Show>
              </box>
            </box>
          )}
        </For>
        <Show when={props.data()?.swarm}>
          <box marginTop={1}>
            <text fg={theme().text}>
              <b>Swarm</b>
            </text>
            <text fg={theme().textMuted}>{props.data()!.swarm!.progress}</text>
            <text fg={theme().textMuted}>
              Completed: {props.data()!.swarm!.completed.length} Active:{" "}
              {props.data()!.swarm!.active.length} Ready: {props.data()!.swarm!.ready.length} Blocked:{" "}
              {props.data()!.swarm!.blocked.length}
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  const [data, setData] = createSignal<StatusData | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  async function poll() {
    try {
      const { stdout } = await execFileAsync("cogitor", ["--status", "--json"], { timeout: 10000 })
      const parsed = JSON.parse(stdout)
      if (parsed && Array.isArray(parsed.agents)) {
        setData(parsed)
      }
    } catch {
      // cogitor not installed or error - keep last data or null
    }
  }

  poll()
  timer = setInterval(poll, 5000)

  api.slots.register({
    order: 600,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} data={data} />
      },
    },
  })

  api.lifecycle.onDispose(() => {
    if (timer) clearInterval(timer)
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
