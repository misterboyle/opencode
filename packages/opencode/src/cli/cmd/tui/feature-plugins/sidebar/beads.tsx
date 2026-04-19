import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const id = "cogitor:sidebar-beads"
const execFileAsync = promisify(execFile)

type Bead = {
  id: string
  title: string
  status: string
  priority: number
  issue_type: string
  assignee?: string
  parent?: string
}

type TreeBead = Bead & {
  children: TreeBead[]
}

type BeadData = {
  beads: TreeBead[]
  total: number
  byStatus: Record<string, number>
}

type FlattenedItem = { bead: Bead; depth: number }

const STATUS_COLORS: Record<string, string> = {
  open: "textMuted",
  in_progress: "warning",
  closed: "success",
  blocked: "error",
  cancelled: "textMuted",
}

const STATUS_ICONS: Record<string, string> = {
  open: "\u25CB",
  in_progress: "\u25CF",
  closed: "\u2713",
  blocked: "\u25A0",
  cancelled: "\u2717",
}

function truncate(s: string, max: number = 50): string {
  s = s.replace(/\n/g, " ").trim()
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "\u2026"
}

function buildTree(beads: Bead[]): TreeBead[] {
  const byId = new Map<string, TreeBead>()
  const roots: TreeBead[] = []

  for (const b of beads) {
    byId.set(b.id, { ...b, children: [] })
  }

  for (const b of beads) {
    const node = byId.get(b.id)!
    if (b.parent && byId.has(b.parent)) {
      byId.get(b.parent)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const statusOrder: Record<string, number> = { in_progress: 0, open: 1, blocked: 2, closed: 3, cancelled: 4 }
  roots.sort((a, b) => a.priority - b.priority || (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5))

  return roots
}

function flattenTree(tree: TreeBead[], depth = 0): FlattenedItem[] {
  const result: FlattenedItem[] = []
  for (const t of tree) {
    result.push({ bead: t, depth })
    result.push(...flattenTree(t.children, depth + 1))
  }
  return result
}

function BeadRow(props: {
  api: TuiPluginApi
  item: FlattenedItem
  expanded: Set<string>
  toggle: (id: string) => void
}) {
  const theme = () => props.api.theme.current
  const bead = props.item.bead as TreeBead
  const status = bead.status
  const color = STATUS_COLORS[status] ?? "textMuted"
  const icon = STATUS_ICONS[status] ?? "?"
  const hasChildren = bead.issue_type !== "task" || bead.children?.length > 0
  const isExpanded = props.expanded.has(bead.id)
  const prefix = "\u00A0".repeat(props.item.depth * 2)
  const childIcon = hasChildren ? (isExpanded ? "\u25BC" : "\u25B6") : "\u00A0"

  return (
    <box flexDirection="row" gap={1}>
      <text fg={theme().text}>{prefix}{childIcon}</text>
      <text style={{ fg: color }}>{icon}</text>
      <box flexDirection="column" flexGrow={1}>
        <text
          fg={theme().text}
          wrapMode="word"
          onMouseDown={() => {
            if (hasChildren) props.toggle(bead.id)
          }}
        >
          <Show when={props.item.depth > 0}>
            <span style={{ fg: theme().textMuted }}>{bead.id} </span>
          </Show>
          {truncate(bead.title, 42)}
        </text>
        <Show when={bead.assignee}>
          <text fg={theme().textMuted}>
            {truncate(bead.assignee!, 30)}
          </text>
        </Show>
      </box>
    </box>
  )
}

function View(props: { api: TuiPluginApi; data: () => BeadData | null }) {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const theme = () => props.api.theme.current

  const items = createMemo(() => {
    const d = props.data()
    if (!d) return []
    return flattenTree(d.beads)
  })

  const toggle = (beadId: string) => {
    const next = new Set(expanded())
    if (next.has(beadId)) next.delete(beadId)
    else next.add(beadId)
    setExpanded(next)
  }

  return (
    <Show when={items().length > 0}>
      <box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme().text}>
            <b>Beads</b>{" "}
            <span style={{ fg: theme().textMuted }}>({items().length})</span>
          </text>
          <Show when={props.data()!.byStatus}>
            <text fg={theme().textMuted}>
              {Object.entries(props.data()!.byStatus)
                .filter(([, c]) => c > 0)
                .map(([s, c]) => `${STATUS_ICONS[s] ?? "?"}${c}`)
                .join(" ")}
            </text>
          </Show>
        </box>
        <For each={items()}>
          {(item) => <BeadRow api={props.api} item={item} expanded={expanded()} toggle={toggle} />}
        </For>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  const [data, setData] = createSignal<BeadData | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  async function poll() {
    try {
      const { stdout } = await execFileAsync("bd", ["list", "--json"], { timeout: 10000 })
      const beads: Bead[] = JSON.parse(stdout)
      if (!Array.isArray(beads)) return

      const tree = buildTree(beads)
      const byStatus: Record<string, number> = {}
      for (const b of beads) {
        byStatus[b.status] = (byStatus[b.status] || 0) + 1
      }

      setData({ beads: tree, total: beads.length, byStatus })
    } catch {
      // bd not available
    }
  }

  poll()
  timer = setInterval(poll, 10000)

  api.slots.register({
    order: 700,
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
