import * as WaypointCore from '../../lib/core/index';

type Scenario = {
  label: string;
  input: {
    crew: 'romantic';
    anchor: 'culinary';
    magicRefinement: 'more_unique' | 'more_energy' | 'closer_together' | 'more_curated' | 'more_affordable' | null;
  };
};

type Signature = {
  planId: string;
  cacheKey: string;
  wildcardInjected: number | null;
  notes: string[];
};

const scenarios: Scenario[] = [
  {
    label: 'romantic+culinary+none',
    input: { crew: 'romantic', anchor: 'culinary', magicRefinement: null },
  },
  {
    label: 'romantic+culinary+more_unique',
    input: { crew: 'romantic', anchor: 'culinary', magicRefinement: 'more_unique' },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveGenerateIdeaDatePlan(): (args: Scenario['input']) => {
  planId: string;
  cacheKey: string;
  plan: Record<string, unknown>;
} {
  const root = WaypointCore as Record<string, unknown>;
  const fromRoot = root.generateIdeaDatePlan;
  if (typeof fromRoot === 'function') {
    return fromRoot as (args: Scenario['input']) => {
      planId: string;
      cacheKey: string;
      plan: Record<string, unknown>;
    };
  }
  const fromDefault = isRecord(root.default) ? root.default.generateIdeaDatePlan : null;
  if (typeof fromDefault === 'function') {
    return fromDefault as (args: Scenario['input']) => {
      planId: string;
      cacheKey: string;
      plan: Record<string, unknown>;
    };
  }
  throw new Error('Core entrypoint missing generateIdeaDatePlan export.');
}

const generateIdeaDatePlan = resolveGenerateIdeaDatePlan();

function readSignature(input: Scenario['input']): Signature {
  const output = generateIdeaDatePlan(input);
  const meta = isRecord(output.plan.meta) ? output.plan.meta : null;
  const ideaDate = meta && isRecord(meta.ideaDate) ? meta.ideaDate : null;
  const report = ideaDate && isRecord(ideaDate.surpriseReport) ? ideaDate.surpriseReport : null;
  const wildcardInjected = report && typeof report.wildcardInjected === 'number' ? report.wildcardInjected : null;
  const notes = report && Array.isArray(report.notes)
    ? report.notes.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    planId: output.planId,
    cacheKey: output.cacheKey,
    wildcardInjected,
    notes,
  };
}

function assertEqual(label: string, left: Signature, right: Signature): void {
  const fields: Array<keyof Signature> = ['planId', 'cacheKey', 'wildcardInjected', 'notes'];
  for (const field of fields) {
    const leftValue = left[field];
    const rightValue = right[field];
    if (JSON.stringify(leftValue) === JSON.stringify(rightValue)) continue;
    throw new Error(
      `${label} deterministic mismatch for ${field}: run1=${JSON.stringify(leftValue)} run2=${JSON.stringify(rightValue)}`
    );
  }
}

function main(): void {
  for (const scenario of scenarios) {
    const runOne = readSignature(scenario.input);
    const runTwo = readSignature(scenario.input);
    assertEqual(scenario.label, runOne, runTwo);
    console.log(
      `${scenario.label}: planId=${runOne.planId} cacheKey=${runOne.cacheKey} wildcardInjected=${String(runOne.wildcardInjected)}`
    );
  }
  console.log('ACCEPTANCE HOST: PASS');
}

main();
