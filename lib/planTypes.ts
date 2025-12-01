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

// For now, we'll just use the entity name as the title
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
    location: undefined, // can wire this later when Entity has location
    dateTime: input.dateTime,
    attendees: input.attendees,
    notes: input.notes,
    calendarLink,
  };
}
