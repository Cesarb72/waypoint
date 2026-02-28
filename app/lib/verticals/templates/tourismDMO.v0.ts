import type { VerticalTemplateV0 } from "../schema"

export const TourismDMOTemplateV0: VerticalTemplateV0 = {
  version: "v0",
  id: "tourism-dmo",
  name: "Tourism / DMO",

  intent: {
    primaryOutcome: "Curate a visitor-ready itinerary across districts",
    successSignals: ["Balanced itinerary", "Clear visitor guidance"],
  },

  stopTypes: [
    {
      id: "district",
      label: "District",
      intent: "Define the focus area",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "notes", label: "Notes", type: "longtext" },
      ],
      required: true,
    },
    {
      id: "attraction",
      label: "Attraction",
      intent: "Highlight key attractions",
      fields: [
        { key: "location", label: "Location", type: "location", required: true },
        {
          key: "ticket_url",
          label: "Ticket URL",
          type: "url",
          placeholder: "https://",
        },
        {
          key: "category",
          label: "Category",
          type: "select",
          options: [
            { value: "museum", label: "Museum" },
            { value: "landmark", label: "Landmark" },
            { value: "park", label: "Park" },
          ],
        },
      ],
      repeatable: true,
    },
    {
      id: "meal",
      label: "Meal",
      intent: "Plan dining stops",
      fields: [
        {
          key: "meal_type",
          label: "Meal type",
          type: "select",
          options: [
            { value: "breakfast", label: "Breakfast" },
            { value: "lunch", label: "Lunch" },
            { value: "dinner", label: "Dinner" },
          ],
        },
        { key: "location", label: "Location", type: "location" },
      ],
    },
    {
      id: "transit",
      label: "Transit",
      intent: "Outline transportation",
      fields: [
        {
          key: "mode",
          label: "Mode",
          type: "select",
          options: [
            { value: "walk", label: "Walk" },
            { value: "transit", label: "Public transit" },
            { value: "drive", label: "Drive" },
          ],
        },
        { key: "duration", label: "Duration", type: "duration" },
      ],
    },
  ],

  editorGuidance: {
    suggestedOrder: ["district", "attraction", "meal", "transit"],
    optionalStops: ["meal", "transit"],
    constraints: [{ kind: "recommend_at_least_one", stopTypeId: "attraction" }],
  },

  sharingModel: {
    defaultAuthority: "viewer",
    allowedAuthorities: ["owner", "editor", "viewer"],
  },

  signals: [
    {
      name: "tourism.template_loaded",
      source: "event",
      description: "Tourism / DMO template loaded",
    },
    {
      name: "tourism.district_added",
      source: "event",
      description: "Tourism district added",
    },
  ],
}