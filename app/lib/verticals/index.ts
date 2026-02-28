export * from "./schema"
export * from "./registry/templateRegistry"
export * from "./signals/coreSignalsV0"
export * from "./templates"
export * from "./resolvePlanTemplate"

import { registerVerticalTemplates } from "./registry/templateRegistry"
import { IdeaDateTemplateV0 } from "./templates/ideaDate.v0"
import { CommunityOrgTemplateV0 } from "./templates/communityOrg.v0"
import { RestaurantsHospitalityTemplateV0 } from "./templates/restaurantsHospitality.v0"
import { EventsFestivalsTemplateV0 } from "./templates/eventsFestivals.v0"
import { TourismDMOTemplateV0 } from "./templates/tourismDMO.v0"

export function registerBuiltInVerticalTemplates() {
  return registerVerticalTemplates([
    IdeaDateTemplateV0,
    CommunityOrgTemplateV0,
    RestaurantsHospitalityTemplateV0,
    EventsFestivalsTemplateV0,
    TourismDMOTemplateV0,
  ])
}
