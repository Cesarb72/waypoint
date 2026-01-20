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
    label: 'Plan a date night',
    description: 'Good for evenings with one other person.',
    prefill: {
      title: 'Date night',
      intent: 'A relaxed evening together.',
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
    label: 'Plan a family outing',
    description: 'Good for groups with kids or mixed ages.',
    prefill: {
      title: 'Family outing',
      intent: 'An easy plan that works for everyone.',
      stops: [
        {
          id: 'fo-stop-1',
          name: 'Main activity',
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
    id: 'solo-reset',
    label: 'Plan a solo reset',
    description: 'Good for quiet, personal time.',
    prefill: {
      title: 'Solo reset',
      intent: 'A quiet reset with time to unwind.',
      stops: [
        {
          id: 'sr-stop-1',
          name: 'Calm start',
          role: 'support',
          optionality: 'required',
        },
        {
          id: 'sr-stop-2',
          name: 'Main reset',
          role: 'anchor',
          optionality: 'required',
        },
        {
          id: 'sr-stop-3',
          name: 'Soft landing',
          role: 'optional',
          optionality: 'flexible',
        },
      ],
    },
  },
];
