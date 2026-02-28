import { registerBuiltInVerticalTemplates } from "./index"
import {
  __registryFingerprint,
  listTemplateIds,
  registrySize,
} from "./registry/templateRegistry"

let didInit = false

export function initVerticals(): void {
  if (didInit) return
  registerBuiltInVerticalTemplates()
  const VERTICAL_DEBUG =
    process.env.NODE_ENV === "development" && Boolean(process.env.NEXT_PUBLIC_VERTICAL_DEBUG)
  if (VERTICAL_DEBUG) {
    console.log("[initVerticals]", {
      fp: __registryFingerprint,
      size: registrySize(),
      ids: listTemplateIds(),
    })
  }
  didInit = true
}
