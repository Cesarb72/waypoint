// data/entities.ts

export type Mood =
  | 'chill'
  | 'focused'
  | 'adventurous'
  | 'reflective'
  | 'playful';

export type Entity = {
  id: string;
  name: string;
  description: string;
  mood: Mood;
};

export const entities: Entity[] = [
  {
    id: 'waypoint-1',
    name: 'Morning Reset',
    description: 'Gentle check-in to plan your day and set realistic intentions.',
    mood: 'chill',
  },
  {
    id: 'waypoint-2',
    name: 'Deep Work Block',
    description:
      'A distraction-free, highly focused work session with a defined start and end.',
    mood: 'focused',
  },
  {
    id: 'waypoint-3',
    name: 'Explore & Wander',
    description: 'Loosely structured time to try new ideas and follow curiosity.',
    mood: 'adventurous',
  },
  {
    id: 'waypoint-4',
    name: 'Evening Decompress',
    description: 'Wind down, reflect on the day, and adjust tomorrow’s plan.',
    mood: 'reflective',
  },
  {
    id: 'waypoint-5',
    name: 'Play Session',
    description: 'Time set aside to experiment, tinker, and follow weird ideas.',
    mood: 'playful',
  },
];
