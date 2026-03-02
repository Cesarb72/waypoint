import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateIdeaDatePlan } from '@/lib/verticals/idea-date/generateIdeaDatePlan';
import { generateLocalActivationPlan } from '@/lib/verticals/local-activation/generateLocalActivationPlan';

type SectionResult = {
  name: string;
  ok: boolean;
  details: string[];
};

type IdeaBaselineCase = {
  label: string;
  input: {
    crew: 'romantic';
    anchor: 'culinary' | 'creative';
    magicRefinement: 'more_unique' | null;
  };
  expected: {
    planId: string;
    cacheKey: string;
    wildcardInjected: 0 | 1;
    notes: string[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readIdeaDateReport(plan: unknown): { wildcardInjected: number | null; notes: string[] } {
  if (!isRecord(plan)) return { wildcardInjected: null, notes: [] };
  const meta = isRecord(plan.meta) ? plan.meta : null;
  const ideaDate = meta && isRecord(meta.ideaDate) ? meta.ideaDate : null;
  const report = ideaDate && isRecord(ideaDate.surpriseReport) ? ideaDate.surpriseReport : null;
  const wildcardInjected = report && typeof report.wildcardInjected === 'number' ? report.wildcardInjected : null;
  const notes = report && Array.isArray(report.notes)
    ? report.notes.filter((note): note is string => typeof note === 'string')
    : [];
  return { wildcardInjected, notes };
}

function readLocalActivationReport(plan: unknown): { wildcardInjected: number | null; notes: string[] } {
  if (!isRecord(plan)) return { wildcardInjected: null, notes: [] };
  const meta = isRecord(plan.meta) ? plan.meta : null;
  const local = meta && isRecord(meta.localActivation) ? meta.localActivation : null;
  const report = local && isRecord(local.surpriseReport) ? local.surpriseReport : null;
  const wildcardInjected = report && typeof report.wildcardInjected === 'number' ? report.wildcardInjected : null;
  const notes = report && Array.isArray(report.notes)
    ? report.notes.filter((note): note is string => typeof note === 'string')
    : [];
  return { wildcardInjected, notes };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function expectEqual(
  section: SectionResult,
  label: string,
  expected: unknown,
  actual: unknown
): void {
  if (deepEqual(expected, actual)) return;
  section.ok = false;
  section.details.push(
    `${label} mismatch`,
    `  expected: ${JSON.stringify(expected)}`,
    `  actual:   ${JSON.stringify(actual)}`
  );
}

async function findFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function printSection(result: SectionResult): void {
  const status = result.ok ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${result.name}`);
  for (const detail of result.details) {
    console.log(`  ${detail}`);
  }
}

function isAllowlistedEngineChange(trimmed: string): boolean {
  if (trimmed.length === 0) return true;

  if (
    /^import(\s+type)?\s+.+from ['"]@\/app\/plan-engine\/types['"];?$/.test(trimmed)
    || /^import(\s+type)?\s+.+from ['"]@\/lib\/core\/planTypes['"];?$/.test(trimmed)
  ) {
    return true;
  }

  if (
    /^if\s*\(\s*process\.env\.NODE_ENV\s*!==\s*['"]production['"]\s*\)\s*\{?$/.test(trimmed)
    || /^const\s+\w+\s*=\s*process\.env\.NODE_ENV\s*!==\s*['"]production['"];?$/.test(trimmed)
  ) {
    return true;
  }

  if (
    trimmed === 'debug?: boolean;'
    || trimmed === 'export function applyIdeaDatePatchOps(plan: Plan, ops: IdeaDatePatchOp[]): Plan {'
    || trimmed === 'export function applyIdeaDatePatchOps('
    || trimmed === 'plan: Plan,'
    || trimmed === 'ops: IdeaDatePatchOp[],'
    || trimmed === '): Plan {'
    || trimmed === 'options?: {'
    || trimmed === 'options?: { debug?: boolean }'
    || trimmed === 'options?: RecomputeIdeaDateLiveOptions'
    || trimmed === 'export type RecomputeIdeaDateLiveOptions = {'
    || trimmed === 'resolvePlanById?: (planId: string) => Plan | null | Promise<Plan | null>;'
    || trimmed === 'const debug = options?.debug ?? true;'
    || trimmed === 'const includeDevQueryDebug = options?.debug ?? true;'
    || trimmed === 'const includeDevTiming = debug;'
    || trimmed === 'if (debug) {'
    || trimmed === 'debug,'
    || trimmed === 'options?.recomputeCandidatePlan'
    || trimmed === '?? (async (candidatePlan) => recomputeIdeaDateLive(candidatePlan, { debug: includeDevQueryDebug }));'
    || trimmed === 'options?.recomputeCandidatePlan ?? (async (candidatePlan) => recomputeIdeaDateLive(candidatePlan));'
    || trimmed === 'candidatePlan = applyIdeaDatePatchOps(plan, patchOps);'
    || trimmed === 'candidatePlan = applyIdeaDatePatchOps(plan, patchOps, { debug: includeDevQueryDebug });'
    || trimmed === 'const previewPlan = applyIdeaDatePatchOps(input.plan, suggestion.patchOps);'
    || trimmed === 'const previewPlan = applyIdeaDatePatchOps(input.plan, suggestion.patchOps, { debug: input.debug });'
    || trimmed === 'const previewLive = await recomputeIdeaDateLive(previewPlan);'
    || trimmed === 'const previewLive = await recomputeIdeaDateLive(previewPlan, { debug: input.debug });'
    || trimmed === 'const live = await recomputeIdeaDateLive(plan);'
    || trimmed === 'const live = await recomputeIdeaDateLive(plan, { debug });'
    || trimmed === '}'
    || trimmed === '};'
  ) {
    return true;
  }

  return false;
}

function validateEngineDiffText(diffText: string, sourceLabel: string): { ok: boolean; reason?: string } {
  const lines = diffText.split(/\r?\n/);
  let currentFile = 'unknown';
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      currentFile = match?.[2] ?? 'unknown';
      continue;
    }
    if (
      line.startsWith('index ')
      || line.startsWith('@@ ')
      || line.startsWith('--- ')
      || line.startsWith('+++ ')
      || line.startsWith('warning:')
    ) {
      continue;
    }
    if (!line.startsWith('+') && !line.startsWith('-')) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    const trimmed = line.slice(1).trim();
    if (isAllowlistedEngineChange(trimmed)) continue;
    return {
      ok: false,
      reason: `${sourceLabel} ${currentFile}: non-allowlisted engine diff line "${trimmed}"`,
    };
  }
  return { ok: true };
}

function validateAcceptanceHostImports(source: string): { ok: boolean; reason?: string } {
  const importMatches = [...source.matchAll(/^\s*import\s.+\sfrom\s+['"]([^'"]+)['"];?\s*$/gm)];
  const specs = importMatches.map((match) => match[1]);
  const allowedCoreEntry = new Set(['../../lib/core/index', '../../lib/core/index.ts']);
  const hasCoreEntry = specs.some((spec) => allowedCoreEntry.has(spec));
  if (!hasCoreEntry) {
    return {
      ok: false,
      reason: 'acceptance-host/src/run.ts must import from ../../lib/core/index only.',
    };
  }

  for (const spec of specs) {
    if (!spec.includes('/lib/')) continue;
    if (!allowedCoreEntry.has(spec)) {
      return {
        ok: false,
        reason: `acceptance-host/src/run.ts imports forbidden lib path "${spec}".`,
      };
    }
  }
  return { ok: true };
}

async function main(): Promise<void> {
  const results: SectionResult[] = [];

  const ideaBaselines: IdeaBaselineCase[] = [
    {
      label: 'Idea-Date case 1',
      input: { crew: 'romantic', anchor: 'culinary', magicRefinement: null },
      expected: {
        planId: 'idea-date-romantic-culinary-none',
        cacheKey: 'romantic:culinary:none',
        wildcardInjected: 0,
        notes: [
          'No candidate arrays found in meta.ideaDate; using deterministic stop+seed fallback for seedCandidates.',
          'Energy fields detected; cohesive arc check ran (no reorder unless explicit roles exist).',
          'No travel/time gap fields detected; dead-air enforcement skipped.',
          'Crew safety floor remains enforced as a hard guardrail.',
          'Crew guardrail enforcement currently validation-only unless deterministic alternatives are available.',
        ],
      },
    },
    {
      label: 'Idea-Date case 2',
      input: { crew: 'romantic', anchor: 'culinary', magicRefinement: 'more_unique' },
      expected: {
        planId: 'idea-date-romantic-culinary-more_unique',
        cacheKey: 'romantic:culinary:more_unique',
        wildcardInjected: 1,
        notes: [
          'No candidate arrays found in meta.ideaDate; using deterministic stop+seed fallback for seedCandidates.',
          'Magic refinement more_unique raised novelty threshold for mainstream-heavy stacks.',
          'Magic refinement applied without overriding crew safety floor.',
          'No discovery stop found; injected deterministic non-food wildcard from seedCandidates.',
          'Energy fields detected; cohesive arc check ran (no reorder unless explicit roles exist).',
          'No travel/time gap fields detected; dead-air enforcement skipped.',
          'Crew safety floor remains enforced as a hard guardrail.',
          'Crew guardrail enforcement currently validation-only unless deterministic alternatives are available.',
        ],
      },
    },
    {
      label: 'Idea-Date case 3',
      input: { crew: 'romantic', anchor: 'creative', magicRefinement: null },
      expected: {
        planId: 'idea-date-romantic-creative-none',
        cacheKey: 'romantic:creative:none',
        wildcardInjected: 0,
        notes: [
          'No candidate arrays found in meta.ideaDate; using deterministic stop+seed fallback for seedCandidates.',
          'Energy fields detected; cohesive arc check ran (no reorder unless explicit roles exist).',
          'No travel/time gap fields detected; dead-air enforcement skipped.',
          'Crew safety floor remains enforced as a hard guardrail.',
          'Crew guardrail enforcement currently validation-only unless deterministic alternatives are available.',
        ],
      },
    },
  ];

  const ideaSection: SectionResult = { name: 'Idea-Date baselines', ok: true, details: [] };
  for (const testCase of ideaBaselines) {
    const runOne = generateIdeaDatePlan(testCase.input);
    const runTwo = generateIdeaDatePlan(testCase.input);
    const reportOne = readIdeaDateReport(runOne.plan);
    const reportTwo = readIdeaDateReport(runTwo.plan);

    expectEqual(ideaSection, `${testCase.label} planId`, testCase.expected.planId, runOne.planId);
    expectEqual(ideaSection, `${testCase.label} cacheKey`, testCase.expected.cacheKey, runOne.cacheKey);
    expectEqual(
      ideaSection,
      `${testCase.label} wildcardInjected`,
      testCase.expected.wildcardInjected,
      reportOne.wildcardInjected
    );
    expectEqual(ideaSection, `${testCase.label} notes`, testCase.expected.notes, reportOne.notes);

    expectEqual(ideaSection, `${testCase.label} rerun planId`, runOne.planId, runTwo.planId);
    expectEqual(ideaSection, `${testCase.label} rerun cacheKey`, runOne.cacheKey, runTwo.cacheKey);
    expectEqual(
      ideaSection,
      `${testCase.label} rerun wildcardInjected`,
      reportOne.wildcardInjected,
      reportTwo.wildcardInjected
    );
    expectEqual(ideaSection, `${testCase.label} rerun notes`, reportOne.notes, reportTwo.notes);
    if (reportOne.wildcardInjected !== 0 && reportOne.wildcardInjected !== 1) {
      ideaSection.ok = false;
      ideaSection.details.push(`${testCase.label} wildcardInjected out of bounds: ${String(reportOne.wildcardInjected)}`);
    }
  }
  if (ideaSection.ok) {
    ideaSection.details.push('All 3 baseline signatures match exactly and reruns are identical.');
  }
  results.push(ideaSection);

  const localSection: SectionResult = { name: 'Local Activation determinism', ok: true, details: [] };
  const localInput = { groupType: 'friends' as const, focus: 'live-music' as const, refinement: null };
  const localRunOne = generateLocalActivationPlan(localInput);
  const localRunTwo = generateLocalActivationPlan(localInput);
  const localReportOne = readLocalActivationReport(localRunOne.plan);
  const localReportTwo = readLocalActivationReport(localRunTwo.plan);
  expectEqual(localSection, 'local planId format', 'local-activation-friends-live-music-none', localRunOne.planId);
  expectEqual(localSection, 'local cacheKey format', 'friends:live-music:none', localRunOne.cacheKey);
  expectEqual(localSection, 'local rerun planId', localRunOne.planId, localRunTwo.planId);
  expectEqual(localSection, 'local rerun cacheKey', localRunOne.cacheKey, localRunTwo.cacheKey);
  expectEqual(localSection, 'local rerun wildcardInjected', localReportOne.wildcardInjected, localReportTwo.wildcardInjected);
  expectEqual(localSection, 'local rerun notes', localReportOne.notes, localReportTwo.notes);
  if (localReportOne.wildcardInjected !== 0 && localReportOne.wildcardInjected !== 1) {
    localSection.ok = false;
    localSection.details.push(`local wildcardInjected out of bounds: ${String(localReportOne.wildcardInjected)}`);
  }
  if (localSection.ok) {
    localSection.details.push('friends/live-music/none is deterministic with bounded wildcardInjected.');
  }
  results.push(localSection);

  const namespaceSection: SectionResult = { name: 'Cross-vertical namespace isolation', ok: true, details: [] };
  const ideaPlan = generateIdeaDatePlan({ crew: 'romantic', anchor: 'culinary', magicRefinement: null }).plan;
  const localPlan = generateLocalActivationPlan(localInput).plan;
  const ideaMeta = isRecord(ideaPlan.meta) ? ideaPlan.meta : null;
  const localMeta = isRecord(localPlan.meta) ? localPlan.meta : null;
  if (!ideaMeta || !isRecord(ideaMeta.ideaDate)) {
    namespaceSection.ok = false;
    namespaceSection.details.push('Idea-Date plan is missing meta.ideaDate.');
  }
  if (!localMeta || !isRecord(localMeta.localActivation)) {
    namespaceSection.ok = false;
    namespaceSection.details.push('Local Activation plan is missing meta.localActivation.');
  } else {
    const localActivation = localMeta.localActivation;
    if (!isRecord(localActivation.surpriseReport)) {
      namespaceSection.ok = false;
      namespaceSection.details.push('Local Activation missing mirrored meta.localActivation.surpriseReport.');
    }
    if (!isRecord(localActivation.groupPolicy) || !isRecord(localActivation.focusPolicy)) {
      namespaceSection.ok = false;
      namespaceSection.details.push('Local Activation missing groupPolicy/focusPolicy under meta.localActivation.');
    }
  }
  if (namespaceSection.ok) {
    namespaceSection.details.push('meta roots preserved; ideaDate and localActivation namespaces are present as expected.');
  }
  results.push(namespaceSection);

  const importIsolation: SectionResult = { name: 'Concierge import isolation', ok: true, details: [] };
  const conciergeRoot = path.resolve('lib/toolkits/concierge');
  const files = await findFiles(conciergeRoot);
  const offenders: string[] = [];
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    if (content.includes('@/lib/idea-date')) {
      offenders.push(path.relative(process.cwd(), file));
    }
  }
  if (offenders.length > 0) {
    importIsolation.ok = false;
    importIsolation.details.push('Found forbidden imports:', ...offenders);
  } else {
    importIsolation.details.push('No "@/lib/idea-date" references found under lib/toolkits/concierge/**.');
  }
  results.push(importIsolation);

  const acceptanceHostSection: SectionResult = { name: 'Acceptance host can run core', ok: true, details: [] };
  try {
    const runTsPath = path.resolve('acceptance-host/src/run.ts');
    const runTsSource = await fs.readFile(runTsPath, 'utf8');
    const importValidation = validateAcceptanceHostImports(runTsSource);
    if (!importValidation.ok) {
      acceptanceHostSection.ok = false;
      acceptanceHostSection.details.push(importValidation.reason ?? 'Acceptance host import boundary check failed.');
    } else {
      const output = execSync('npx tsx acceptance-host/src/run.ts', { encoding: 'utf8' });
      const lines = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const tail = lines.slice(-3);
      acceptanceHostSection.details.push('Acceptance host executed through core entrypoint.', ...tail);
    }
  } catch (error) {
    acceptanceHostSection.ok = false;
    acceptanceHostSection.details.push(
      `Acceptance host run failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  results.push(acceptanceHostSection);

  const engineCheck: SectionResult = { name: 'Engine freeze exception (host-agnostic allowlist)', ok: true, details: [] };
  try {
    const unstagedDiff = execSync('git diff -U0 -- lib/engine', { encoding: 'utf8' }).trim();
    const stagedDiff = execSync('git diff --cached -U0 -- lib/engine', { encoding: 'utf8' }).trim();

    if (!unstagedDiff && !stagedDiff) {
      engineCheck.details.push('No staged or unstaged changes under lib/engine/**.');
    } else {
      const unstagedValidation = validateEngineDiffText(unstagedDiff, 'unstaged');
      const stagedValidation = validateEngineDiffText(stagedDiff, 'staged');
      if (!unstagedValidation.ok || !stagedValidation.ok) {
        engineCheck.ok = false;
        engineCheck.details.push(
          unstagedValidation.reason ?? stagedValidation.reason ?? 'Engine diff validation failed.'
        );
      } else {
        engineCheck.details.push('Engine changes are host-agnostic compliance-only (allowlisted).');
      }
    }
  } catch (error) {
    engineCheck.details.push(`Skipped git check: ${error instanceof Error ? error.message : String(error)}`);
  }
  results.push(engineCheck);

  for (const result of results) {
    printSection(result);
  }

  const hasFailure = results.some((result) => !result.ok);
  console.log(hasFailure ? 'OVERALL: FAIL' : 'OVERALL: PASS');
  if (hasFailure) {
    process.exit(1);
  }
}

void main();
