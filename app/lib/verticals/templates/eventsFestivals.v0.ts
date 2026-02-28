import type { VerticalTemplateV0 } from "../schema"

export const EventsFestivalsTemplateV0: VerticalTemplateV0 = {
  version: "v0",
  id: "events-festivals",
  name: "Events & Festivals",

  intent: {
    primaryOutcome: "Coordinate a festival day across sets and vendors",
    successSignals: ["Shared set schedule", "Smooth group meetups"],
  },

  stopTypes: [
    {
      id: "arrival",
      label: "Arrival",
      intent: "Set arrival time and entry point",
      fields: [
        { key: "when", label: "Date & time", type: "datetime", required: true },
        { key: "where", label: "Location", type: "location", required: true },
      ],
      required: true,
    },
    {
      id: "set",
      label: "Set",
      intent: "Track stages and performance slots",
      fields: [
        {
          key: "stage",
          label: "Stage",
          type: "select",
          options: [
            { value: "main", label: "Main" },
            { value: "second", label: "Second" },
            { value: "tent", label: "Tent" },
          ],
        },
        { key: "when", label: "Date & time", type: "datetime", required: true },
        { key: "duration", label: "Duration", type: "duration" },
      ],
      repeatable: true,
    },
    {
      id: "vendor",
      label: "Vendor",
      intent: "Capture food or merch vendors",
      fields: [
        {
          key: "category",
          label: "Category",
          type: "select",
          options: [
            { value: "food", label: "Food" },
            { value: "drinks", label: "Drinks" },
            { value: "merch", label: "Merch" },
          ],
        },
        { key: "where", label: "Location", type: "location" },
      ],
    },
    {
      id: "transit",
      label: "Transit",
      intent: "Plan transport logistics",
      fields: [
        {
          key: "mode",
          label: "Mode",
          type: "select",
          options: [
            { value: "rideshare", label: "Rideshare" },
            { value: "transit", label: "Public transit" },
            { value: "walk", label: "Walk" },
          ],
        },
        { key: "duration", label: "Duration", type: "duration" },
      ],
    },
  ],

  editorGuidance: {
    suggestedOrder: ["arrival", "set", "vendor", "transit"],
    optionalStops: ["vendor", "transit"],
    constraints: [{ kind: "recommend_at_least_one", stopTypeId: "set" }],
  },

  sharingModel: {
    defaultAuthority: "editor",
    allowedAuthorities: ["owner", "editor", "viewer"],
  },

  signals: [
    {
      name: "events.template_loaded",
      source: "event",
      description: "Events & Festivals template loaded",
    },
    {
      name: "events.stage_selected",
      source: "event",
      description: "Festival stage selected",
    },
  ],
}