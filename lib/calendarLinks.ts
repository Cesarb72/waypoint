// lib/calendarLinks.ts

import type { Plan } from './planTypes';

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
 * Build a Google Calendar event link from a Plan.
 * For now, we assume a 1-hour duration.
 */
export function buildGoogleCalendarLink(plan: Plan): string {
  const start = new Date(plan.dateTime);
  if (Number.isNaN(start.getTime())) {
    // Bad date → no link
    return '';
  }

  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const startStr = formatDateForGoogle(start);
  const endStr = formatDateForGoogle(end);

  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';

  const params = new URLSearchParams({
    text: plan.title,
    details: plan.notes
      ? `${plan.notes}\n\nAttendees: ${plan.attendees}`
      : `Attendees: ${plan.attendees}`,
  });

  if (plan.location) {
    params.set('location', plan.location);
  }

  params.set('dates', `${startStr}/${endStr}`);

  return `${base}&${params.toString()}`;
}
