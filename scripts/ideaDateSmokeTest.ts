import type { Plan } from '@/app/plan-engine/types';
import { PLAN_VERSION } from '@/app/plan-engine/types';
import { recomputeIdeaDateLive } from '@/lib/engine/idea-date/recompute';
import { generateIdeaDateSuggestionPack } from '@/lib/engine/idea-date/suggestionPack';

function buildMockPlan(): Plan {
  return {
    id: 'idea-date-smoke-plan',
    version: PLAN_VERSION,
    title: 'Smoke Test Date',
    intent: 'Validate idea-date engine outputs',
    audience: 'two adults',
    meta: {
      ideaDate: {
        vibeId: 'first_date_low_pressure',
        travelMode: 'walk',
      },
    },
    stops: [
      {
        id: 's1',
        name: 'Morning Coffee',
        role: 'anchor',
        optionality: 'required',
        placeRef: {
          provider: 'google',
          placeId: 'mock_place_coffee',
          latLng: { lat: 37.7765, lng: -122.4178 },
        },
        placeLite: {
          placeId: 'mock_place_coffee',
          name: 'Morning Coffee',
          types: ['cafe'],
        },
      },
      {
        id: 's2',
        name: 'Art Walk',
        role: 'support',
        optionality: 'required',
        placeRef: {
          provider: 'google',
          placeId: 'mock_place_gallery',
          latLng: { lat: 37.7862, lng: -122.4058 },
        },
        placeLite: {
          placeId: 'mock_place_gallery',
          name: 'Art Walk',
          types: ['art_gallery'],
        },
      },
      {
        id: 's3',
        name: 'Dessert Stop',
        role: 'optional',
        optionality: 'flexible',
        placeRef: {
          provider: 'google',
          placeId: 'mock_place_dessert',
          latLng: { lat: 37.7921, lng: -122.3996 },
        },
        placeLite: {
          placeId: 'mock_place_dessert',
          name: 'Dessert Stop',
          types: ['dessert_shop'],
        },
      },
    ],
  };
}

async function main(): Promise<void> {
  const plan = buildMockPlan();
  const live = await recomputeIdeaDateLive(plan);
  const pack = await generateIdeaDateSuggestionPack(live.plan);
  // eslint-disable-next-line no-console
  console.log('Idea-Date smoke test', {
    journeyScore: live.computed.journeyScore,
    journeyScore100: live.computed.journeyScore100,
    arcPoints: live.arcModel.points.length,
    violations: live.computed.violations.length,
    suggestions: pack.suggestions.length,
  });
}

void main();
