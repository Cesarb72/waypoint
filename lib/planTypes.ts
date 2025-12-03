// lib/planTypes.ts

import type { Entity } from '@/data/entities';

export type Plan = {
  id: string;
  entityId: string;
  title: string;
  location?: string;
  dateTime: string; // ISO string
  attendees: string;
  notes?: string;
  calendarLink?: string;
};

export function buildPlanFromEntity(
  entity: Entity,
  input: {
    dateTime: string;
    attendees: string;
    notes?: string;
  },
  calendarLink?: string
): Plan {
  return {
    id: `${entity.id}-${Date.now()}`,
    entityId: entity.id,
    title: entity.name,
    location: undefined, // can add later if Entity gets a location field
    dateTime: input.dateTime,
    attendees: input.attendees,
    notes: input.notes,
    calendarLink,
  };
}
