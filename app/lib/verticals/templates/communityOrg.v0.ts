import type { VerticalTemplateV0 } from "../schema"

export const CommunityOrgTemplateV0: VerticalTemplateV0 = {
  version: "v0",
  id: "community-org",
  name: "Community Org",

  intent: {
    primaryOutcome: "Organize a community initiative with clear roles and milestones",
    successSignals: ["Aligned stakeholders", "Delivered kickoff event"],
  },

  stopTypes: [
    {
      id: "mission",
      label: "Mission",
      intent: "Clarify the mission and outcomes",
      fields: [
        {
          key: "mission_statement",
          label: "Mission statement",
          type: "longtext",
          required: true,
          placeholder: "Summarize the community mission",
        },
        {
          key: "impact_area",
          label: "Impact area",
          type: "select",
          options: [
            { value: "education", label: "Education" },
            { value: "health", label: "Health" },
            { value: "environment", label: "Environment" },
          ],
        },
      ],
      required: true,
    },
    {
      id: "stakeholders",
      label: "Stakeholders",
      intent: "Identify key participants and roles",
      fields: [
        {
          key: "lead_contact",
          label: "Lead contact",
          type: "text",
          required: true,
          placeholder: "Primary organizer",
        },
        {
          key: "role_types",
          label: "Role types",
          type: "multiselect",
          options: [
            { value: "volunteer", label: "Volunteer" },
            { value: "partner", label: "Partner" },
            { value: "advisor", label: "Advisor" },
          ],
        },
      ],
    },
    {
      id: "milestones",
      label: "Milestones",
      intent: "Define timeline and deliverables",
      fields: [
        {
          key: "kickoff_date",
          label: "Kickoff date",
          type: "datetime",
          required: true,
        },
        {
          key: "success_metrics",
          label: "Success metrics",
          type: "longtext",
        },
      ],
      repeatable: true,
      minCount: 1,
    },
  ],

  editorGuidance: {
    suggestedOrder: ["mission", "stakeholders", "milestones"],
    optionalStops: ["stakeholders"],
    constraints: [
      { kind: "recommend_at_least_one", stopTypeId: "milestones" },
      { kind: "warn_if_missing_required_field", stopTypeId: "mission", fieldKey: "mission_statement" },
    ],
  },

  sharingModel: {
    defaultAuthority: "owner",
    allowedAuthorities: ["owner", "editor", "viewer"],
  },

  signals: [
    {
      name: "community-org.template_loaded",
      source: "event",
      description: "Community Org template loaded",
    },
    {
      name: "community-org.kickoff_scheduled",
      source: "event",
      description: "Community kickoff scheduled",
    },
  ],
}
