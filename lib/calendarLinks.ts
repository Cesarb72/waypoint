// lib/calendarLinks.ts

import type { StoredPlan } from './planStorage';

/**
 * Format a Date as YYYYMMDDTHHmmssZ for Google Calendar.
 */
function formatDateForGoogle(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Safely build a JS Date from StoredPlan.date + StoredPlan.time.
 */
function getPlanStartDate(plan: StoredPlan): Date | null {
  if (!plan.date || !plan.time) return null;

  const isoString = `${plan.date}T${plan.time}`;
  const d = new Date(isoString);

  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Build a Google Calendar event link from a StoredPlan.
 * For now, we assume a 1-hour duration.
 */
export function buildGoogleCalendarLink(plan: StoredPlan): string {
  const start = getPlanStartDate(plan);
  if (!start) {
    return '';
  }

  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const startStr = formatDateForGoogle(start);
  const endStr = formatDateForGoogle(end);

  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';

  const detailsParts: string[] = [];

  if (plan.notes) {
    detailsParts.push(plan.notes);
  }

  if (plan.attendees) {
    detailsParts.push(`Attendees: ${plan.attendees}`);
  }

  if (plan.stops && plan.stops.length > 0) {
    const stopsSummary = plan.stops
      .map((stop, index) => {
        const timePart = stop.time ? ` @ ${stop.time}` : '';
        const notesPart = stop.notes ? ` — ${stop.notes}` : '';
        return `${index + 1}. ${stop.label}${timePart}${notesPart}`;
      })
      .join('\n');

    detailsParts.push(`Stops:\n${stopsSummary}`);
  }

  const params = new URLSearchParams({
    text: plan.title || 'Waypoint plan',
    details: detailsParts.join('\n\n'),
  });

  // If you later add a location field to StoredPlan you can hook it here:
  // if (plan.location) params.set('location', plan.location);

  params.set('dates', `${startStr}/${endStr}`);

  return `${base}&${params.toString()}`;
}
