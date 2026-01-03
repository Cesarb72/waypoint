import type { Plan } from '../plan-engine';

export type PlanTemplate = {
  id: string;
  label: string;
  description?: string;
  prefill: Partial<Plan>;
};

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: 'date-night',
    label: 'Date Night',
    description: 'Relaxed evening together.',
    prefill: {
      title: 'Date Night',
      intent: 'A relaxed evening together',
      stops: [
        {
          id: 'dn-stop-1',
          name: 'Dinner',
          role: 'support',
          optionality: 'required',
        },
        {
          id: 'dn-stop-2',
          name: 'Main activity',
          role: 'anchor',
          optionality: 'required',
        },
        {
          id: 'dn-stop-3',
          name: 'Dessert or walk',
          role: 'optional',
          optionality: 'flexible',
        },
      ],
    },
  },
  {
    id: 'family-outing',
    label: 'Family Outing',
    description: 'An easy plan that works for everyone.',
    prefill: {
      title: 'Family Outing',
      intent: 'An easy plan that works for everyone',
      stops: [
        {
          id: 'fo-stop-1',
          name: 'Activity',
          role: 'anchor',
          optionality: 'required',
        },
        {
          id: 'fo-stop-2',
          name: 'Food break',
          role: 'support',
          optionality: 'flexible',
        },
      ],
    },
  },
  {
    id: 'venue-pre-show',
    label: 'Venue Pre-Show',
    description: 'A smooth lead-in before an event.',
    prefill: {
      title: 'Pre-Show Plan',
      intent: 'A smooth lead-in before an event',
      stops: [
        {
          id: 'vps-stop-1',
          name: 'Food or drink',
          role: 'support',
          optionality: 'required',
        },
        {
          id: 'vps-stop-2',
          name: 'Event',
          role: 'anchor',
          optionality: 'required',
        },
      ],
    },
  },
];
