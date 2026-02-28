import type { AuthorityMode, FieldTypeV0 } from "./v0"

export type ValidationIssue = {
  path: string
  message: string
  code:
    | "missing_required"
    | "invalid_type"
    | "invalid_value"
    | "duplicate"
    | "unknown_reference"
    | "empty"
}

export type ValidationResult = {
  ok: boolean
  issues: ValidationIssue[]
}

const authorityModes: AuthorityMode[] = ["owner", "editor", "viewer"]
const fieldTypes: FieldTypeV0[] = [
  "text",
  "longtext",
  "number",
  "boolean",
  "datetime",
  "duration",
  "url",
  "location",
  "select",
  "multiselect",
]

const signalSources = ["plan", "stop", "event"] as const
const uiTones = ["playful", "neutral", "formal"] as const
const constraintKinds = [
  "recommend_at_least_one",
  "recommend_order",
  "warn_if_missing_required_field",
  "warn_if_too_many",
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === "string"

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean"

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const isAuthorityMode = (value: unknown): value is AuthorityMode =>
  isString(value) && authorityModes.includes(value as AuthorityMode)

const isFieldType = (value: unknown): value is FieldTypeV0 =>
  isString(value) && fieldTypes.includes(value as FieldTypeV0)

export const validateVerticalTemplateV0 = (template: unknown): ValidationResult => {
  const issues: ValidationIssue[] = []

  const addIssue = (path: string, message: string, code: ValidationIssue["code"]) => {
    issues.push({ path, message, code })
  }

  const requireRecord = (value: unknown, path: string) => {
    if (value === undefined) {
      addIssue(path, "Missing required object", "missing_required")
      return undefined
    }
    if (!isRecord(value)) {
      addIssue(path, "Expected object", "invalid_type")
      return undefined
    }
    return value
  }

  const requireString = (value: unknown, path: string) => {
    if (value === undefined) {
      addIssue(path, "Missing required string", "missing_required")
      return undefined
    }
    if (!isString(value)) {
      addIssue(path, "Expected string", "invalid_type")
      return undefined
    }
    return value
  }

  const optionalString = (value: unknown, path: string) => {
    if (value === undefined) return
    if (!isString(value)) {
      addIssue(path, "Expected string", "invalid_type")
    }
  }

  const optionalBoolean = (value: unknown, path: string) => {
    if (value === undefined) return
    if (!isBoolean(value)) {
      addIssue(path, "Expected boolean", "invalid_type")
    }
  }

  const optionalNumber = (value: unknown, path: string) => {
    if (value === undefined) return
    if (!isNumber(value)) {
      addIssue(path, "Expected number", "invalid_type")
    }
  }

  const requireArray = (value: unknown, path: string) => {
    if (value === undefined) {
      addIssue(path, "Missing required array", "missing_required")
      return undefined
    }
    if (!Array.isArray(value)) {
      addIssue(path, "Expected array", "invalid_type")
      return undefined
    }
    return value
  }

  if (!isRecord(template)) {
    addIssue("", "Expected object", "invalid_type")
    return { ok: false, issues }
  }

  if (template.version !== "v0") {
    if (template.version === undefined) {
      addIssue("version", "Missing required literal 'v0'", "missing_required")
    } else {
      addIssue("version", "Expected literal 'v0'", "invalid_value")
    }
  }

  requireString(template.id, "id")
  requireString(template.name, "name")

  const intent = requireRecord(template.intent, "intent")
  if (intent) {
    requireString(intent.primaryOutcome, "intent.primaryOutcome")
    const successSignals = requireArray(intent.successSignals, "intent.successSignals")
    if (successSignals) {
      successSignals.forEach((entry, index) => {
        if (!isString(entry)) {
          addIssue(`intent.successSignals[${index}]`, "Expected string", "invalid_type")
        }
      })
    }
  }

  const stopTypes = requireArray(template.stopTypes, "stopTypes")
  const stopTypeIds = new Set<string>()
  const stopTypeFields = new Map<string, Set<string>>()
  if (stopTypes) {
    if (stopTypes.length === 0) {
      addIssue("stopTypes", "Array must not be empty", "empty")
    }
    stopTypes.forEach((entry, index) => {
      const path = `stopTypes[${index}]`
      if (!isRecord(entry)) {
        addIssue(path, "Expected object", "invalid_type")
        return
      }

      const id = requireString(entry.id, `${path}.id`)
      requireString(entry.label, `${path}.label`)
      requireString(entry.intent, `${path}.intent`)

      if (id) {
        if (stopTypeIds.has(id)) {
          addIssue(`${path}.id`, "Duplicate stop type id", "duplicate")
        } else {
          stopTypeIds.add(id)
        }
      }

      const fields = requireArray(entry.fields, `${path}.fields`)
      if (fields) {
        const fieldKeys = new Set<string>()
        fields.forEach((fieldEntry, fieldIndex) => {
          const fieldPath = `${path}.fields[${fieldIndex}]`
          if (!isRecord(fieldEntry)) {
            addIssue(fieldPath, "Expected object", "invalid_type")
            return
          }

          const fieldKey = requireString(fieldEntry.key, `${fieldPath}.key`)
          requireString(fieldEntry.label, `${fieldPath}.label`)

          if (fieldKey) {
            if (fieldKeys.has(fieldKey)) {
              addIssue(`${fieldPath}.key`, "Duplicate field key", "duplicate")
            } else {
              fieldKeys.add(fieldKey)
            }
          }

          const typeValue = fieldEntry.type
          if (!isFieldType(typeValue)) {
            if (typeValue === undefined) {
              addIssue(`${fieldPath}.type`, "Missing required field type", "missing_required")
            } else {
              addIssue(`${fieldPath}.type`, "Invalid field type", "invalid_value")
            }
          } else if (typeValue === "select" || typeValue === "multiselect") {
            const options = requireArray(fieldEntry.options, `${fieldPath}.options`)
            if (options) {
              if (options.length === 0) {
                addIssue(`${fieldPath}.options`, "Array must not be empty", "empty")
              }
              options.forEach((optionEntry, optionIndex) => {
                const optionPath = `${fieldPath}.options[${optionIndex}]`
                if (!isRecord(optionEntry)) {
                  addIssue(optionPath, "Expected object", "invalid_type")
                  return
                }
                requireString(optionEntry.value, `${optionPath}.value`)
                requireString(optionEntry.label, `${optionPath}.label`)
              })
            }
          }

          optionalBoolean(fieldEntry.required, `${fieldPath}.required`)
          optionalString(fieldEntry.placeholder, `${fieldPath}.placeholder`)
          optionalString(fieldEntry.helpText, `${fieldPath}.helpText`)
        })

        if (id) {
          stopTypeFields.set(id, fieldKeys)
        }
      }

      optionalBoolean(entry.required, `${path}.required`)
      optionalBoolean(entry.repeatable, `${path}.repeatable`)
      optionalNumber(entry.minCount, `${path}.minCount`)
      optionalNumber(entry.maxCount, `${path}.maxCount`)
    })
  }

  const editorGuidance = requireRecord(template.editorGuidance, "editorGuidance")
  if (editorGuidance) {
    const suggestedOrder = requireArray(
      editorGuidance.suggestedOrder,
      "editorGuidance.suggestedOrder",
    )
    if (suggestedOrder) {
      suggestedOrder.forEach((entry, index) => {
        if (!isString(entry)) {
          addIssue(
            `editorGuidance.suggestedOrder[${index}]`,
            "Expected string",
            "invalid_type",
          )
          return
        }
        if (!stopTypeIds.has(entry)) {
          addIssue(
            `editorGuidance.suggestedOrder[${index}]`,
            "Unknown stop type id",
            "unknown_reference",
          )
        }
      })
    }

    const optionalStops = requireArray(
      editorGuidance.optionalStops,
      "editorGuidance.optionalStops",
    )
    if (optionalStops) {
      optionalStops.forEach((entry, index) => {
        if (!isString(entry)) {
          addIssue(`editorGuidance.optionalStops[${index}]`, "Expected string", "invalid_type")
          return
        }
        if (!stopTypeIds.has(entry)) {
          addIssue(
            `editorGuidance.optionalStops[${index}]`,
            "Unknown stop type id",
            "unknown_reference",
          )
        }
      })
    }

    const constraints = requireArray(editorGuidance.constraints, "editorGuidance.constraints")
    if (constraints) {
      constraints.forEach((entry, index) => {
        const path = `editorGuidance.constraints[${index}]`
        if (!isRecord(entry)) {
          addIssue(path, "Expected object", "invalid_type")
          return
        }

        const kind = entry.kind
        if (!isString(kind)) {
          addIssue(`${path}.kind`, "Expected string", "invalid_type")
          return
        }
        if (!constraintKinds.includes(kind as (typeof constraintKinds)[number])) {
          addIssue(`${path}.kind`, "Unknown constraint kind", "invalid_value")
          return
        }

        if (kind === "recommend_at_least_one") {
          const stopTypeId = requireString(entry.stopTypeId, `${path}.stopTypeId`)
          if (stopTypeId && !stopTypeIds.has(stopTypeId)) {
            addIssue(`${path}.stopTypeId`, "Unknown stop type id", "unknown_reference")
          }
          return
        }

        if (kind === "recommend_order") {
          const ordered = requireArray(entry.orderedStopTypeIds, `${path}.orderedStopTypeIds`)
          if (ordered) {
            ordered.forEach((entryId, entryIndex) => {
              if (!isString(entryId)) {
                addIssue(
                  `${path}.orderedStopTypeIds[${entryIndex}]`,
                  "Expected string",
                  "invalid_type",
                )
                return
              }
              if (!stopTypeIds.has(entryId)) {
                addIssue(
                  `${path}.orderedStopTypeIds[${entryIndex}]`,
                  "Unknown stop type id",
                  "unknown_reference",
                )
              }
            })
          }
          return
        }

        if (kind === "warn_if_missing_required_field") {
          const stopTypeId = requireString(entry.stopTypeId, `${path}.stopTypeId`)
          const fieldKey = requireString(entry.fieldKey, `${path}.fieldKey`)
          if (stopTypeId && !stopTypeIds.has(stopTypeId)) {
            addIssue(`${path}.stopTypeId`, "Unknown stop type id", "unknown_reference")
          }
          if (stopTypeId && fieldKey) {
            const fieldsForStop = stopTypeFields.get(stopTypeId)
            if (fieldsForStop && !fieldsForStop.has(fieldKey)) {
              addIssue(`${path}.fieldKey`, "Unknown field key", "unknown_reference")
            }
          }
          return
        }

        if (kind === "warn_if_too_many") {
          const stopTypeId = requireString(entry.stopTypeId, `${path}.stopTypeId`)
          if (stopTypeId && !stopTypeIds.has(stopTypeId)) {
            addIssue(`${path}.stopTypeId`, "Unknown stop type id", "unknown_reference")
          }
          if (entry.max === undefined) {
            addIssue(`${path}.max`, "Missing required number", "missing_required")
          } else if (!isNumber(entry.max)) {
            addIssue(`${path}.max`, "Expected number", "invalid_type")
          }
        }
      })
    }
  }

  const sharingModel = requireRecord(template.sharingModel, "sharingModel")
  if (sharingModel) {
    let defaultAuthorityIsValid = false
    if (sharingModel.defaultAuthority === undefined) {
      addIssue("sharingModel.defaultAuthority", "Missing required authority", "missing_required")
    } else if (!isAuthorityMode(sharingModel.defaultAuthority)) {
      addIssue("sharingModel.defaultAuthority", "Invalid authority mode", "invalid_value")
    } else {
      defaultAuthorityIsValid = true
    }

    const allowedAuthorities = requireArray(
      sharingModel.allowedAuthorities,
      "sharingModel.allowedAuthorities",
    )
    if (allowedAuthorities) {
      if (allowedAuthorities.length === 0) {
        addIssue("sharingModel.allowedAuthorities", "Array must not be empty", "empty")
      }
      if (defaultAuthorityIsValid) {
        const includesDefault = allowedAuthorities.some((entry) =>
          isAuthorityMode(entry) ? entry === sharingModel.defaultAuthority : false,
        )
        if (!includesDefault) {
          addIssue(
            "sharingModel.allowedAuthorities",
            "Must include defaultAuthority",
            "invalid_value",
          )
        }
      }
      allowedAuthorities.forEach((entry, index) => {
        if (!isAuthorityMode(entry)) {
          addIssue(
            `sharingModel.allowedAuthorities[${index}]`,
            "Invalid authority mode",
            "invalid_value",
          )
        }
      })
    }
  }

  if (template.defaults !== undefined) {
    if (!isRecord(template.defaults)) {
      addIssue("defaults", "Expected object", "invalid_type")
    } else {
      const durationHints = template.defaults.durationHints
      if (durationHints !== undefined) {
        if (!Array.isArray(durationHints)) {
          addIssue("defaults.durationHints", "Expected array", "invalid_type")
        } else {
          durationHints.forEach((entry, index) => {
            const path = `defaults.durationHints[${index}]`
            if (!isRecord(entry)) {
              addIssue(path, "Expected object", "invalid_type")
              return
            }
            const stopTypeId = requireString(entry.stopTypeId, `${path}.stopTypeId`)
            if (stopTypeId && !stopTypeIds.has(stopTypeId)) {
              addIssue(`${path}.stopTypeId`, "Unknown stop type id", "unknown_reference")
            }
            if (entry.defaultMinutes === undefined) {
              addIssue(`${path}.defaultMinutes`, "Missing required number", "missing_required")
            } else if (!isNumber(entry.defaultMinutes)) {
              addIssue(`${path}.defaultMinutes`, "Expected number", "invalid_type")
            }
          })
        }
      }

      const participantRoles = template.defaults.participantRoles
      if (participantRoles !== undefined) {
        if (!Array.isArray(participantRoles)) {
          addIssue("defaults.participantRoles", "Expected array", "invalid_type")
        } else {
          participantRoles.forEach((entry, index) => {
            const path = `defaults.participantRoles[${index}]`
            if (!isRecord(entry)) {
              addIssue(path, "Expected object", "invalid_type")
              return
            }
            requireString(entry.id, `${path}.id`)
            requireString(entry.label, `${path}.label`)
          })
        }
      }
    }
  }

  if (template.uiHints !== undefined) {
    if (!isRecord(template.uiHints)) {
      addIssue("uiHints", "Expected object", "invalid_type")
    } else {
      if (template.uiHints.tone !== undefined) {
        const tone = template.uiHints.tone
        if (!isString(tone)) {
          addIssue("uiHints.tone", "Expected string", "invalid_type")
        } else if (!uiTones.includes(tone as (typeof uiTones)[number])) {
          addIssue("uiHints.tone", "Invalid tone", "invalid_value")
        }
      }

      if (template.uiHints.stopLabelOverrides !== undefined) {
        const overrides = template.uiHints.stopLabelOverrides
        if (!isRecord(overrides)) {
          addIssue("uiHints.stopLabelOverrides", "Expected object", "invalid_type")
        } else {
          Object.entries(overrides).forEach(([key, value]) => {
            if (!isString(value)) {
              addIssue(
                `uiHints.stopLabelOverrides.${key}`,
                "Expected string",
                "invalid_type",
              )
            }
          })
        }
      }
    }
  }

  const signals = requireArray(template.signals, "signals")
  if (signals) {
    const signalNames = new Set<string>()
    signals.forEach((entry, index) => {
      const path = `signals[${index}]`
      if (!isRecord(entry)) {
        addIssue(path, "Expected object", "invalid_type")
        return
      }
      const name = requireString(entry.name, `${path}.name`)
      if (name) {
        if (signalNames.has(name)) {
          addIssue(`${path}.name`, "Duplicate signal name", "duplicate")
        } else {
          signalNames.add(name)
        }
      }
      const source = entry.source
      if (source === undefined) {
        addIssue(`${path}.source`, "Missing required source", "missing_required")
      } else if (!isString(source)) {
        addIssue(`${path}.source`, "Expected string", "invalid_type")
      } else if (!signalSources.includes(source as (typeof signalSources)[number])) {
        addIssue(`${path}.source`, "Invalid source", "invalid_value")
      }
      requireString(entry.description, `${path}.description`)
    })
  }

  return { ok: issues.length === 0, issues }
}

export const assertValidVerticalTemplateV0 = (template: unknown): void => {
  const result = validateVerticalTemplateV0(template)
  if (!result.ok) {
    const details = result.issues
      .map((issue) => `${issue.path || "(root)"}: ${issue.message}`)
      .join("; ")
    throw new Error(`VerticalTemplateV0 validation failed: ${details}`)
  }
}
