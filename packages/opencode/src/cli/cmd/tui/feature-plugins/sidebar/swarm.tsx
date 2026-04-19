import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const id = "cogitor:sidebar-swarm"
const execFileAsync = promisify(execFile)

type SwarmActiveItem = {
  bead: string
  agent: string
  health: string | null
}

type SwarmData = {
  epic: string
  progress: string
  completed: string[]
  active: SwarmActiveItem[]
  ready: string[]
  blocked: string[]
}

type SwarmRaw = {
  agents?: Array<{
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
    swarm?: SwarmData
  }>
  total: number
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

function SwarmActiveRow(props: { api: TuiPluginApi; item: SwarmActiveItem }) {
  const theme = () => props.api.theme.current
  const color = props.item.health ? (HEALTH_COLORS[props.item.health] ?? "textMuted") : "textMuted"
  const icon = props.item.health ? (HEALTH_ICONS[props.item.health] ?? "?") : "?"
  const details = [props.item.agent, props.item.health].filter(Boolean).join(", ")

  return (
    <box flexDirection="row" gap={1}>
      <text style={{ fg: color }}>{icon}</text>
      <text fg={theme().text} wrapMode="word">
        {"  "}{props.item.bead}
        <Show when={details}>
          <span style={{ fg: theme().textMuted }}> ({details})</span>
        </Show>
      </text>
    </box>
  )
}

function SwarmCompletedRow(props: { api: TuiPluginApi; id: string }) {
  const theme = () => props.api.theme.current
  return (
    <text fg={theme().success} wrapMode="word">
      {"  "} {props.id}
    </text>
  )
}

function SwarmReadyRow(props: { api: TuiPluginApi; id: string }) {
  const theme = () => props.api.theme.current
  return (
    <text fg={theme().textMuted} wrapMode="word">
      {"  "} {props.id}
    </text>
  )
}

function SwarmBlockedRow(props: { api: TuiPluginApi; id: string }) {
  const theme = () => props.api.theme.current
  return (
    <text fg={theme().error} wrapMode="word">
      {"  "} {props.id}
    </text>
  )
}

function View(props: { api: TuiPluginApi; swarm: () => SwarmData | null }) {
  const theme = () => props.api.theme.current

  return (
    <Show when={props.swarm()}>
      <box>
        <text fg={theme().text}>
          <b>Swarm</b>
        </text>
        <Show when={props.swarm()!.epic}>
          <text fg={theme().textMuted}>
            Epic: {props.swarm()!.epic}
          </text>
        </Show>
        <text fg={theme().textMuted}>
          {props.swarm()!.progress}
        </text>

        <box marginTop={1}>
          <text fg={theme().text}>
            <b>Completed</b>{" "}
            <span style={{ fg: theme().success }}>({props.swarm()!.completed.length})</span>
          </text>
          <For each={props.swarm()!.completed}>
            {(id) => <SwarmCompletedRow api={props.api} id={id} />}
          </For>
        </box>

        <Show when={props.swarm()!.active.length > 0}>
          <box marginTop={1}>
            <text fg={theme().text}>
              <b>Active</b>{" "}
              <span style={{ fg: theme().warning }}>({props.swarm()!.active.length})</span>
            </text>
            <For each={props.swarm()!.active}>
              {(item) => <SwarmActiveRow api={props.api} item={item} />}
            </For>
          </box>
        </Show>

        <Show when={props.swarm()!.ready.length > 0}>
          <box marginTop={1}>
            <text fg={theme().text}>
              <b>Ready</b>{" "}
              <span style={{ fg: theme().textMuted }}>({props.swarm()!.ready.length})</span>
            </text>
            <For each={props.swarm()!.ready}>
              {(id) => <SwarmReadyRow api={props.api} id={id} />}
            </For>
          </box>
        </Show>

        <Show when={props.swarm()!.blocked.length > 0}>
          <box marginTop={1}>
            <text fg={theme().error}>
              <b>Blocked</b>{" "}
              <span>({props.swarm()!.blocked.length})</span>
            </text>
            <For each={props.swarm()!.blocked}>
              {(id) => <SwarmBlockedRow api={props.api} id={id} />}
            </For>
          </box>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  const [swarmData, setSwarmData] = createSignal<SwarmData | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  async function poll() {
    try {
      const { stdout } = await execFileAsync("cogitor", ["--status", "--json"], { timeout: 10000 })
      const parsed: SwarmRaw = JSON.parse(stdout)
      if (parsed.agents && parsed.agents.length > 0) {
        const swarm = parsed.agents[0].swarm
        if (swarm) {
          setSwarmData(swarm)
        }
      }
    } catch {
      // cogitor not installed or error
    }
  }

  poll()
  timer = setInterval(poll, 5000)

  api.slots.register({
    order: 800,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} swarm={swarmData} />
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
