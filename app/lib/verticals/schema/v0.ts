export type AuthorityMode = "owner" | "editor" | "viewer"

export type FieldTypeV0 =
  | "text"
  | "longtext"
  | "number"
  | "boolean"
  | "datetime"
  | "duration"
  | "url"
  | "location"
  | "select"
  | "multiselect"

export type FieldSchemaV0 =
  | {
      key: string
      label: string
      type: Exclude<FieldTypeV0, "select" | "multiselect">
      required?: boolean
      placeholder?: string
      helpText?: string
      defaultValue?: unknown
    }
  | {
      key: string
      label: string
      type: "select" | "multiselect"
      options: { value: string; label: string }[]
      required?: boolean
      placeholder?: string
      helpText?: string
      defaultValue?: unknown
    }

export type StopTypeV0 = {
  id: string
  label: string
  intent: string
  fields: FieldSchemaV0[]
  required?: boolean
  repeatable?: boolean
  minCount?: number
  maxCount?: number
}

export type EditorConstraintV0 =
  | { kind: "recommend_at_least_one"; stopTypeId: string }
  | { kind: "recommend_order"; orderedStopTypeIds: string[] }
  | { kind: "warn_if_missing_required_field"; stopTypeId: string; fieldKey: string }
  | { kind: "warn_if_too_many"; stopTypeId: string; max: number }

export type SignalSchemaV0 = {
  name: string
  source: "plan" | "stop" | "event"
  description: string
}

export type VerticalTemplateV0 = {
  version: "v0"
  id: string
  name: string

  intent: {
    primaryOutcome: string
    successSignals: string[]
  }

  stopTypes: StopTypeV0[]

  editorGuidance: {
    suggestedOrder: string[]
    optionalStops: string[]
    constraints: EditorConstraintV0[]
  }

  sharingModel: {
    defaultAuthority: AuthorityMode
    allowedAuthorities: AuthorityMode[]
  }

  defaults?: {
    durationHints?: { stopTypeId: string; defaultMinutes: number }[]
    participantRoles?: { id: string; label: string }[]
  }

  uiHints?: {
    tone?: "playful" | "neutral" | "formal"
    stopLabelOverrides?: Record<string, string>
  }

  signals: SignalSchemaV0[]
}