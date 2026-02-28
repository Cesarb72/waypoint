import type { VerticalTemplateV0 } from "../schema"

export const IdeaDateTemplateV0: VerticalTemplateV0 = {
  version: "v0",
  id: "idea-date",
  name: "Idea-Date",

  intent: {
    primaryOutcome: "Validate a startup idea with quick, lightweight feedback",
    successSignals: ["Clear problem fit", "Actionable next step"],
  },

  stopTypes: [
    {
      id: "anchor",
      label: "Anchor",
      intent: "The must-do stop that defines the date",
      fields: [
        {
          key: "name",
          label: "Anchor stop",
          type: "text",
          required: true,
          placeholder: "e.g., Sunset picnic at Dolores Park",
        },
        {
          key: "location",
          label: "Location",
          type: "location",
        },
        {
          key: "reason",
          label: "Why it fits",
          type: "longtext",
          placeholder: "What makes this perfect for the plan",
        },
      ],
      required: true,
    },
    {
      id: "support",
      label: "Support",
      intent: "Great add-ons that round out the night",
      fields: [
        {
          key: "name",
          label: "Support stop",
          type: "text",
          required: true,
          placeholder: "e.g., Dessert crawl in Mission",
        },
        {
          key: "location",
          label: "Location",
          type: "location",
        },
        {
          key: "role",
          label: "Role",
          type: "select",
          options: [
            { value: "food", label: "Food + drinks" },
            { value: "activity", label: "Activity" },
            { value: "view", label: "View / vibe" },
          ],
        },
      ],
      repeatable: true,
    },
    {
      id: "logistics",
      label: "Logistics",
      intent: "Helpful details to make the plan smooth",
      fields: [
        {
          key: "timing",
          label: "Timing notes",
          type: "longtext",
          placeholder: "Best arrival time, reservation window, etc.",
        },
        {
          key: "budget",
          label: "Budget",
          type: "select",
          options: [
            { value: "budget", label: "Budget" },
            { value: "mid", label: "Mid" },
            { value: "splurge", label: "Splurge" },
          ],
        },
        {
          key: "prep",
          label: "Prep / reminders",
          type: "longtext",
          placeholder: "What to bring, tickets, weather notes",
        },
      ],
    },
  ],

  editorGuidance: {
    suggestedOrder: ["anchor", "support", "logistics"],
    optionalStops: ["logistics"],
    constraints: [
      { kind: "recommend_at_least_one", stopTypeId: "support" },
      { kind: "warn_if_too_many", stopTypeId: "anchor", max: 1 },
    ],
  },

  sharingModel: {
    defaultAuthority: "owner",
    allowedAuthorities: ["owner", "editor"],
  },

  signals: [
    {
      name: "idea-date.template_loaded",
      source: "event",
      description: "Idea-Date template loaded",
    },
    {
      name: "idea-date.interview_scheduled",
      source: "event",
      description: "Customer interview scheduled",
    },
  ],
}
