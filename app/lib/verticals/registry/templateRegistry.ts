import type { SignalSchemaV0, VerticalTemplateV0 } from "../schema"
import type { ValidationIssue } from "../schema"
import { validateVerticalTemplateV0 } from "../schema"
import { CORE_ENGINE_SIGNALS_V0 } from "../signals/coreSignalsV0"

export type RegisteredVerticalTemplate = VerticalTemplateV0 & { signals: SignalSchemaV0[] }

type TemplateId = string

const registry = new Map<TemplateId, RegisteredVerticalTemplate>()

export const __registryFingerprint = Math.random().toString(16).slice(2)

const summarizeIssues = (templateId: string | undefined, issues: ValidationIssue[]) => {
  const prefix = templateId ? `Template ${templateId}: ` : "Template: "
  return (
    prefix +
    issues.map((issue) => `${issue.path || "(root)"}: ${issue.message}`).join("; ")
  )
}

export function registerVerticalTemplates(templates: unknown[]): RegisteredVerticalTemplate[] {
  const registered: RegisteredVerticalTemplate[] = []

  templates.forEach((template, index) => {
    const result = validateVerticalTemplateV0(template)
    if (!result.ok) {
      const templateId =
        typeof template === "object" && template !== null && "id" in template
          ? String((template as { id?: unknown }).id)
          : undefined
      throw new Error(summarizeIssues(templateId ?? `at index ${index}`, result.issues))
    }

    const typedTemplate = template as VerticalTemplateV0
    if (registry.has(typedTemplate.id)) {
      throw new Error(`Duplicate template id: ${typedTemplate.id}`)
    }

    const mergedSignals: SignalSchemaV0[] = [
      ...CORE_ENGINE_SIGNALS_V0,
      ...typedTemplate.signals,
    ]
    const seenSignals = new Set<string>()
    mergedSignals.forEach((signal) => {
      if (seenSignals.has(signal.name)) {
        throw new Error(
          `Duplicate signal name '${signal.name}' in template ${typedTemplate.id}`,
        )
      }
      seenSignals.add(signal.name)
    })

    const registeredTemplate: RegisteredVerticalTemplate = {
      ...typedTemplate,
      signals: mergedSignals,
    }

    registry.set(typedTemplate.id, registeredTemplate)
    registered.push(registeredTemplate)
  })

  return registered
}

export function getVerticalTemplate(id: TemplateId): RegisteredVerticalTemplate | undefined {
  return registry.get(id)
}

export function registrySize(): number {
  return registry.size
}

export function hasTemplateId(id: string): boolean {
  return registry.has(id)
}

export function listVerticalTemplates(): RegisteredVerticalTemplate[] {
  return Array.from(registry.values())
}

export function listTemplateIds(): string[] {
  return Array.from(registry.keys())
}

export function clearVerticalTemplatesForTestOnly(): void {
  registry.clear()
}
