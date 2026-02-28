import type { SignalSchemaV0 } from "../schema"

export const CORE_ENGINE_SIGNALS_V0: SignalSchemaV0[] = [
  { name: "plan.created", source: "event", description: "Plan created" },
  { name: "plan.opened", source: "event", description: "Plan opened" },
  { name: "plan.saved", source: "event", description: "Plan saved" },
  {
    name: "plan.migrated_local_to_cloud",
    source: "event",
    description: "Plan migrated from local to cloud",
  },
  { name: "plan.archived", source: "event", description: "Plan archived" },

  { name: "share.link_created", source: "event", description: "Share link created" },
  { name: "share.link_opened", source: "event", description: "Share link opened" },
  { name: "share.fork_created", source: "event", description: "Share fork created" },
  { name: "authority.mode_changed", source: "event", description: "Authority mode changed" },

  { name: "stop.added", source: "event", description: "Stop added" },
  { name: "stop.removed", source: "event", description: "Stop removed" },
  { name: "stop.reordered", source: "event", description: "Stop reordered" },
  { name: "stop.updated", source: "event", description: "Stop updated" },

  { name: "warning.shown", source: "event", description: "Warning shown" },
  { name: "warning.dismissed", source: "event", description: "Warning dismissed" },
]