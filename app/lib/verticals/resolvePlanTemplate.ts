import { initVerticals } from "./init"
import {
  __registryFingerprint,
  getVerticalTemplate,
  hasTemplateId,
  listTemplateIds,
  registrySize,
} from "./registry/templateRegistry"
import type { RegisteredVerticalTemplate } from "./registry/templateRegistry"

type PlanTemplateRef = { template_id?: string }

export function resolvePlanTemplate(
  plan: PlanTemplateRef,
): RegisteredVerticalTemplate | undefined {
  if (!plan?.template_id) return undefined
  const normalizedTemplateId =
    plan.template_id === "idea_date"
      ? "idea-date"
      : plan.template_id === "community_org"
        ? "community-org"
        : plan.template_id
  const beforeSize = registrySize()
  initVerticals()
  const afterSize = registrySize()
  const VERTICAL_DEBUG =
    process.env.NODE_ENV === "development" && Boolean(process.env.NEXT_PUBLIC_VERTICAL_DEBUG)
  if (VERTICAL_DEBUG) {
    console.log("[resolvePlanTemplate]", {
      fp: __registryFingerprint,
      beforeSize,
      afterSize,
      template_id: normalizedTemplateId,
      has: hasTemplateId(normalizedTemplateId),
    })
  }
  const resolved = getVerticalTemplate(normalizedTemplateId)
  if (!resolved && VERTICAL_DEBUG) {
    console.log("[resolvePlanTemplate] miss", {
      template_id: normalizedTemplateId,
      known: listTemplateIds(),
    })
  }
  return resolved
}

export function setPlanTemplateId<T extends PlanTemplateRef>(
  plan: T,
  templateId: string | undefined,
): T {
  return {
    ...plan,
    template_id: templateId,
  }
}
