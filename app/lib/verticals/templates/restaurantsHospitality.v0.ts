import type { VerticalTemplateV0 } from "../schema"

export const RestaurantsHospitalityTemplateV0: VerticalTemplateV0 = {
  version: "v0",
  id: "restaurants-hospitality",
  name: "Restaurants & Hospitality",

  intent: {
    primaryOutcome: "Coordinate dining experiences with shared logistics",
    successSignals: ["Confirmed reservations", "On-time arrivals"],
  },

  stopTypes: [
    {
      id: "meet",
      label: "Meet",
      intent: "Set the meeting time and place",
      fields: [
        { key: "when", label: "Date & time", type: "datetime", required: true },
        { key: "where", label: "Location", type: "location", required: true },
      ],
      required: true,
    },
    {
      id: "venue",
      label: "Venue",
      intent: "Capture restaurant details",
      fields: [
        { key: "place", label: "Location", type: "location", required: true },
        {
          key: "reservation_url",
          label: "Reservation URL",
          type: "url",
          placeholder: "https://",
        },
        {
          key: "booking_status",
          label: "Booking status",
          type: "select",
          options: [
            { value: "pending", label: "Pending" },
            { value: "confirmed", label: "Confirmed" },
            { value: "walkin", label: "Walk-in" },
          ],
        },
      ],
      required: true,
    },
    {
      id: "dish",
      label: "Dish",
      intent: "Highlight dishes to try",
      fields: [
        { key: "name", label: "Dish name", type: "text", required: true },
        { key: "notes", label: "Notes", type: "longtext" },
      ],
      repeatable: true,
    },
    {
      id: "transit",
      label: "Transit",
      intent: "Plan how to get there",
      fields: [
        {
          key: "mode",
          label: "Mode",
          type: "select",
          options: [
            { value: "walk", label: "Walk" },
            { value: "rideshare", label: "Rideshare" },
            { value: "transit", label: "Public transit" },
            { value: "drive", label: "Drive" },
          ],
        },
        { key: "duration", label: "Duration", type: "duration" },
      ],
    },
  ],

  editorGuidance: {
    suggestedOrder: ["meet", "venue", "transit", "dish"],
    optionalStops: ["dish", "transit"],
    constraints: [{ kind: "recommend_at_least_one", stopTypeId: "venue" }],
  },

  sharingModel: {
    defaultAuthority: "editor",
    allowedAuthorities: ["owner", "editor", "viewer"],
  },

  signals: [
    {
      name: "restaurants.template_loaded",
      source: "event",
      description: "Restaurants & Hospitality template loaded",
    },
    {
      name: "restaurants.reservation_added",
      source: "event",
      description: "Reservation details added",
    },
  ],
}