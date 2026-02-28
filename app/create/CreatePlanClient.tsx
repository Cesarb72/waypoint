'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  createEmptyPlan,
  createPlanFromTemplate,
  createPlanFromTemplatePlan,
  deserializePlan,
  serializePlan,
  type Plan,
  type PresentationAccent,
  type PlanOrigin,
  type PlanOriginKind,
  type Stop,
  validatePlan,
} from '../plan-engine';
import {
  getPlansIndex,
  upsertRecentPlan,
  isPlanShared,
  markPlanShared,
  loadOrigin,
  saveOrigin,
} from '../utils/planStorage';
import { PLAN_TEMPLATES } from '../templates/planTemplates';
import { ctaClass } from '../ui/cta';
import { getSupabaseBrowserClient } from '../lib/supabaseBrowserClient';
import type { Origin } from '../plan-engine/origin';
import { loadDiscoverySession, markDiscoveryRestore } from '@/lib/discoveryStorage';
import { clearDraftByKey, loadDraftByKey, saveDraftByKey } from '@/lib/draftStorage';
import { ACCENT_OPTIONS } from '../utils/branding';
import { getTemplateSeedById } from '@/lib/templateSeeds';
import { createPlanFromTemplateSeed } from '@/lib/templatePlan';
import { useSession } from '../auth/SessionProvider';
import { useEntryMode } from '../context/EntryModeContext';
import { withPreservedMode } from '../lib/entryMode';
import { fetchCloudDraft, upsertCloudDraft, clearCloudDraft } from '../lib/cloudDrafts';
import { fetchCloudPlan, upsertCloudPlan } from '../lib/cloudPlans';
import { CLOUD_PLANS_TABLE } from '../lib/cloudTables';
import { getMyRole, type PlanMemberRole } from '../lib/planMembers';
import { logEvent } from '../lib/planEvents';
import {
  DEFAULT_TEMPLATE_V2_ID,
  TEMPLATES_V2,
  getTemplateV2ById,
  type TemplateV2,
} from '../lib/templatesV2';
import { resolvePlanTemplate } from '../lib/verticals/resolvePlanTemplate';
import { buildVerticalGuidance } from '../lib/verticals/guidance/buildVerticalGuidance';
import { setPlanTemplateId } from '../lib/verticals/resolvePlanTemplate';
import { VerticalIdentityHeader } from '../components/VerticalIdentityHeader';
import { resolveStopTypeLabel, StopTypeBadge } from '../components/StopTypeBadge';
import {
  getExperiencePackSummary,
  type ExperiencePackSummary,
} from '../lib/packs/experiencePackQueries';
import {
  buildExperiencePackDraft,
  buildPreviewExperiencePackDraft,
  type ExperiencePackDraft,
} from '../lib/packs/experiencePackDraft';
import { extractCity } from '../lib/geo/extractCity';
import { extractDistrict } from '../lib/geo/extractDistrict';

type Props = {
  fromEncoded?: string;
  sourceTitle?: string;
  sourceEncoded?: string;
  originUrl?: string;
  initialOrigin?: {
    entityId?: string;
    entityName?: string;
    query?: string;
    mood?: string;
    source?: string;
  };
};

type VariationOption = {
  id: string;
  label: string;
  detail: string;
  plan: Plan;
};

type ViewMode = 'editor' | 'preview' | 'readonly';

function formatMoodLabel(mood: string): string {
  if (!mood) return mood;
  return mood.charAt(0).toUpperCase() + mood.slice(1);
}

function generateOriginSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `origin_${Math.random().toString(36).slice(2, 10)}`;
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePresetKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function mapPresetToVerticalTemplateId(input: { id?: string; name?: string }): string | undefined {
  const normalizedId = input.id ? normalizePresetKey(input.id) : '';
  const normalizedName = input.name ? normalizePresetKey(input.name) : '';

  const exactAliases: Record<string, string> = {
    date_night: 'idea-date',
    datenight: 'idea-date',
    romantic: 'idea-date',
    romance: 'idea-date',
    night_out: 'idea-date',
    nightout: 'idea-date',
    quick_hang: 'idea-date',
    quickhang: 'idea-date',
    family_friendly: 'idea-date',
    familyfriendly: 'idea-date',
    family: 'idea-date',
    cozy: 'idea-date',
    dinner: 'idea-date',
    adventure: 'tourism-dmo',
    outdoors: 'tourism-dmo',
    explore: 'tourism-dmo',
    day_trip: 'tourism-dmo',
    daytrip: 'tourism-dmo',
  };

  if (normalizedId && exactAliases[normalizedId]) return exactAliases[normalizedId];
  if (normalizedName && exactAliases[normalizedName]) return exactAliases[normalizedName];

  const containsIdeaDate = (value: string) =>
    value.includes('date') && value.includes('night');
  const containsTourism = (value: string) =>
    value.includes('adventure') ||
    value.includes('outdoor') ||
    value.includes('outdoors') ||
    value.includes('explore') ||
    value.includes('daytrip');

  if (normalizedId && containsIdeaDate(normalizedId)) return 'idea-date';
  if (normalizedName && containsIdeaDate(normalizedName)) return 'idea-date';
  if (normalizedId && containsTourism(normalizedId)) return 'tourism-dmo';
  if (normalizedName && containsTourism(normalizedName)) return 'tourism-dmo';

  return undefined;
}

function applyVerticalFromPreset<T extends Plan>(
  presetIdOrName: string | null | undefined,
  draft: T
): T {
  if (!presetIdOrName) return draft;
  const presetNormalized = normalizePresetKey(presetIdOrName);
  const mappedId = mapPresetToVerticalTemplateId({ id: presetIdOrName, name: presetIdOrName });
  if (!mappedId) return draft;
  const nextPlan = setPlanTemplateId(draft, mappedId);
  if (process.env.NODE_ENV === 'development') {
    console.log('[verticalPreset]', {
      presetRaw: presetIdOrName,
      presetNormalized,
      mappedVerticalId: mappedId,
      resultingTemplateId: nextPlan.template_id ?? null,
    });
  }
  return nextPlan;
}

function applyVerticalFromPresetPair<T extends Plan>(
  presetId: string | null | undefined,
  presetName: string | null | undefined,
  draft: T
): T {
  const mappedId = mapPresetToVerticalTemplateId({ id: presetId ?? undefined, name: presetName ?? undefined });
  if (!mappedId) return draft;
  const nextPlan = setPlanTemplateId(draft, mappedId);
  if (process.env.NODE_ENV === 'development') {
    console.log('[verticalPreset]', {
      presetRaw: presetId ?? presetName ?? null,
      presetNormalized: normalizePresetKey(presetId ?? presetName ?? ''),
      mappedVerticalId: mappedId,
      resultingTemplateId: nextPlan.template_id ?? null,
    });
  }
  return nextPlan;
}

function resolveEncodedPlanParam(value: string | null): string | null {
  if (!value) return null;
  try {
    deserializePlan(value);
    return value;
  } catch {
    return null;
  }
}

function sanitizeReturnTo(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    const decoded = decodeParam(raw);
    if (!decoded.startsWith('/')) return null;
    const url = new URL(decoded, 'http://example.com');
    const qs = url.searchParams.toString();
    return `${url.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return null;
  }
}

function deriveOriginFromParams(fromParam: string | null, originSourceParam: string | null): Origin {
  const createdAt = Date.now();
  const sessionId = generateOriginSessionId();

  if (fromParam) {
    return {
      type: 'shared',
      label: 'Shared plan',
      source: fromParam,
      createdAt,
      sessionId,
    };
  }

  if (originSourceParam) {
    const decoded = decodeParam(originSourceParam);
    return {
      type: 'search',
      label: `Search � ${decoded}`,
      source: originSourceParam,
      createdAt,
      sessionId,
    };
  }

  return {
    type: 'create',
    label: 'New plan',
    createdAt,
    sessionId,
  };
}

function isSameOrigin(a: Origin, b: Origin): boolean {
  return (
    a.type === b.type &&
    a.label === b.label &&
    a.source === b.source &&
    a.createdAt === b.createdAt &&
    a.sessionId === b.sessionId
  );
}

function buildOriginFromContext(context: {
  query?: string;
  mood?: string;
  source?: PlanOriginKind;
  entityId?: string;
  label?: string;
}): PlanOrigin | null {
  if (context.source === 'surprise') {
    return { kind: 'surprise' };
  }
  if (context.source === 'template') {
    return { kind: 'template', label: context.label };
  }
  if (context.query) {
    return {
      kind: 'search',
      query: context.query,
      mood: context.mood,
      entityId: context.entityId,
      label: context.label,
    };
  }
  if (context.mood) {
    return {
      kind: 'mood',
      mood: context.mood,
      entityId: context.entityId,
      label: context.label,
    };
  }
  if (context.entityId || context.label) {
    return {
      kind: 'search',
      entityId: context.entityId,
      label: context.label,
    };
  }
  return null;
}

function getHourBinFromTimeInput(timeRaw?: string | null): string | null {
  const value = (timeRaw ?? '').trim();
  if (!value) return null;
  const hourRaw = value.split(':')[0];
  const hour = Number.parseInt(hourRaw ?? '', 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (hour < 6) return '0-6';
  if (hour < 9) return '6-9';
  if (hour < 12) return '9-12';
  if (hour < 15) return '12-15';
  if (hour < 18) return '15-18';
  if (hour < 21) return '18-21';
  return '21-24';
}

function getDayOfWeekFromDateInput(dateRaw?: string | null): number | null {
  const value = (dateRaw ?? '').trim();
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed.getDay();
}

export default function CreatePlanClient({
  fromEncoded,
  sourceTitle,
  sourceEncoded,
  originUrl,
  initialOrigin,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { user } = useSession();
  const { isReadOnly: isEntryReadOnly, mode: entryMode } = useEntryMode();
  const userId = user?.id ?? null;
  const fromParamRaw = searchParams.get('from');
  const fromEncodedParam = searchParams.get('fromEncoded');
  const presetParam = searchParams.get('preset');
  const seedParam = searchParams.get('seed');
  const fromPayloadParam = fromEncodedParam ?? fromParamRaw;
  const fromParam = useMemo(() => resolveEncodedPlanParam(fromPayloadParam), [fromPayloadParam]);
  const fromContextParam = useMemo(() => {
    if (fromEncodedParam) return fromParamRaw ?? null;
    if (fromParam) return null;
    return fromParamRaw ?? null;
  }, [fromEncodedParam, fromParam, fromParamRaw]);
  const originSourceParam = searchParams.get('originSource');
  const planIdParam = searchParams.get('planId');
  const editTemplateParam = searchParams.get('editTemplate');
  const templatePreviewParam = searchParams.get('templatePreview');
  const returnToParam = searchParams.get('returnTo');
  const shouldCheckRole = !!userId && !!planIdParam;
  const isTemplatePreview = templatePreviewParam === '1';
  const [roleStatus, setRoleStatus] = useState<'loading' | 'resolved'>('resolved');
  const [myRole, setMyRole] = useState<PlanMemberRole | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>(() =>
    createEmptyPlan({
      title: 'New plan',
      intent: 'What do we want to accomplish?',
      audience: 'me-and-friends',
    })
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_TEMPLATE_V2_ID);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle');
  const [hasShared, setHasShared] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isCommitted, setIsCommitted] = useState(false);
  const [commitStatus, setCommitStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [cloudCommitError, setCloudCommitError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(() => loadOrigin());
  const [sourceExistsInSupabase, setSourceExistsInSupabase] = useState(false);
  const [sourceOwnedByUser, setSourceOwnedByUser] = useState(false);
  void isSaved;
  void sourceOwnedByUser;
  const [showCopyNotice, setShowCopyNotice] = useState(false);
  const [planHydratedFromSource, setPlanHydratedFromSource] = useState(!fromEncoded);
  const [variationOptions, setVariationOptions] = useState<VariationOption[]>([]);
  const [showVariations, setShowVariations] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [cloudDraftReady, setCloudDraftReady] = useState(false);
  const [allowTemplateEdit, setAllowTemplateEdit] = useState(false);
  const [showTemplateConfirmation, setShowTemplateConfirmation] = useState(false);
  const [showReadOnlyHint, setShowReadOnlyHint] = useState(false);
  const [invalidFromError, setInvalidFromError] = useState(false);
  const [planOwnerId, setPlanOwnerId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [packSummary, setPackSummary] = useState<ExperiencePackSummary | null>(null);
  const [packStatus, setPackStatus] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>(
    'idle'
  );
  const [packPreviewReason, setPackPreviewReason] = useState<
    'no_city' | 'below_threshold' | 'no_data'
  >('no_data');
  const [isPackDraftDismissed, setIsPackDraftDismissed] = useState(false);
  const [packCoachNudge, setPackCoachNudge] = useState<string | null>(null);
  const SHARE_ENABLED = false;
  const viewModeRef = useRef<{ mode: ViewMode; planId: string | null } | null>(null);
  const hasPrefilledFromSource = useRef(false);
  const originInitRef = useRef(false);
  const originStableRef = useRef<Origin | null>(origin);
  const hasRestoredDraftRef = useRef(false);
  const hasCheckedCloudDraftRef = useRef(false);
  const cloudDraftUserIdRef = useRef<string | null>(null);
  const hasLoadedSavedPlanRef = useRef(false);
  const draftSaveTimeoutRef = useRef<number | null>(null);
  const lastDraftJsonRef = useRef<string | null>(null);
  const cloudDraftSaveTimeoutRef = useRef<number | null>(null);
  const lastCloudDraftJsonRef = useRef<string | null>(null);
  const lastCloudDraftUpdatedAtRef = useRef<number>(0);
  const cloudSaveGenerationRef = useRef(0);
  const readOnlyHintShownRef = useRef(false);
  const hasPrefilledFromParamsRef = useRef(false);
  const lastTemplateIdRef = useRef<string | undefined>(undefined);
  const lastAppliedTemplateIdRef = useRef<string | undefined>(undefined);
  const planUpdateMetaRef = useRef<{
    presetId?: string;
    presetName?: string;
    resolvedVerticalId?: string;
  } | null>(null);
  const isRoleLoading = shouldCheckRole && roleStatus === 'loading';
  const isEditorReady =
    !shouldCheckRole || (roleStatus === 'resolved' && (myRole === 'owner' || myRole === 'editor'));
  const roleReadOnly = shouldCheckRole && roleStatus === 'resolved' && !isEditorReady;
  const isTemplateReadOnly = !!planIdParam && !!plan.isTemplate && !allowTemplateEdit;
  const isReadOnlySurface = roleReadOnly || isTemplateReadOnly || isTemplatePreview;
  const canEdit = entryMode === 'plan' && !isEntryReadOnly && !isReadOnlySurface;
  const isReadOnly = !canEdit;
  const viewMode = useMemo<ViewMode>(() => {
    if (roleReadOnly) return 'readonly';
    if (isTemplateReadOnly || isTemplatePreview) return 'preview';
    return 'editor';
  }, [roleReadOnly, isTemplatePreview, isTemplateReadOnly]);


  const discoveryContext = useMemo<{
    query?: string;
    mood?: string;
    source?: PlanOriginKind;
    entityId?: string;
    label?: string;
  }>(() => {
    const query = searchParams.get('q')?.trim() || undefined;
    const mood = searchParams.get('mood')?.trim() || undefined;
    const sourceRaw = searchParams.get('source')?.trim() || undefined;
    const source: PlanOriginKind | undefined =
      sourceRaw === 'search' ||
      sourceRaw === 'surprise' ||
      sourceRaw === 'template' ||
      sourceRaw === 'mood'
        ? sourceRaw
        : undefined;
    const entityId = searchParams.get('entityId')?.trim() || undefined;
    const label = searchParams.get('name')?.trim() || undefined;
    return {
      query,
      mood: mood && mood !== 'all' ? mood : undefined,
      source,
      entityId,
      label,
    };
  }, [searchParams]);
  const verticalToolkits = useMemo(
    () => [
      { id: 'idea-date', label: 'Idea-Date' },
      { id: 'restaurants-hospitality', label: 'Restaurants & Hospitality' },
      { id: 'events-festivals', label: 'Events & Festivals' },
      { id: 'tourism-dmo', label: 'Tourism / DMO' },
      { id: 'community-org', label: 'Community Org' },
    ],
    []
  );
  const verticalToolkitIds = useMemo(
    () => new Set(verticalToolkits.map((toolkit) => toolkit.id)),
    [verticalToolkits]
  );
  const toolkitOptions = useMemo(
    () => [{ id: 'generic', label: 'Generic' }, ...verticalToolkits],
    [verticalToolkits]
  );
  const [selectedToolkitId, setSelectedToolkitId] = useState<string>(() => {
    if (plan.template_id && verticalToolkitIds.has(plan.template_id)) {
      return plan.template_id;
    }
    return 'generic';
  });
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  useEffect(() => {
    if (plan.template_id && verticalToolkitIds.has(plan.template_id)) {
      setSelectedToolkitId(plan.template_id);
    } else if (!plan.template_id) {
      setSelectedToolkitId('generic');
    }
  }, [plan.template_id, verticalToolkitIds]);

  const selectedTemplateName = getTemplateV2ById(selectedTemplateId)?.name ?? null;
  const renderBranch = roleReadOnly
    ? 'role_readonly'
    : isTemplateReadOnly
      ? 'template_readonly'
      : invalidFromError
        ? 'invalid'
        : 'editor';
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[mount_or_state_sync] check', {
        selectedTemplateId,
        selectedTemplateName,
        planTemplateId: plan?.template_id,
        lastApplied: lastAppliedTemplateIdRef.current,
        branch: renderBranch,
      });
    }
    if (!selectedTemplateId) return;
    if (plan.template_id) return;
    if (lastAppliedTemplateIdRef.current === selectedTemplateId) return;
    lastAppliedTemplateIdRef.current = selectedTemplateId;
    if (process.env.NODE_ENV === 'development') {
      console.log('[mount_or_state_sync] applying', { selectedTemplateId });
    }
    handleTemplatePresetSelection({
      templateId: selectedTemplateId,
      templateName: selectedTemplateName ?? selectedTemplateId,
      applyToPlan: true,
      allowVertical: true,
      source: 'mount_or_state_sync',
    });
    if (process.env.NODE_ENV === 'development') {
      console.log('[mount_or_state_sync] done', {
        selectedTemplateId,
        planTemplateId: plan?.template_id,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/state sync relies on guarded refs and should not depend on unstable callbacks
  }, [plan.template_id, selectedTemplateId, selectedTemplateName]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const prev = lastTemplateIdRef.current;
    const next = plan.template_id;
    if (prev && !next) {
      console.warn('[template_id cleared]', {
        prev,
        next,
        selectedTemplateId,
        selectedTemplateName,
      });
      console.trace('[template_id cleared trace]');
    } else if (next && prev !== next) {
      console.log('[template_id set/change]', {
        prev,
        next,
        selectedTemplateId,
        selectedTemplateName,
      });
    }
    lastTemplateIdRef.current = next;
  }, [plan.template_id, selectedTemplateId, selectedTemplateName]);
  function handleTemplatePresetSelection(input: {
    templateId: string;
    templateName?: string;
    applyToPlan: boolean;
    allowVertical: boolean;
    source: 'dropdown' | 'url' | 'button' | 'mount_or_state_sync';
  }) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[handleTemplatePresetSelection] start', {
        source: input.source,
        templateId: input.templateId,
        templateName: input.templateName ?? null,
      });
    }
    setSelectedTemplateId(input.templateId);
    if (process.env.NODE_ENV === 'development') {
      const normalizedId = normalizePresetKey(input.templateId);
      const normalizedName = input.templateName ? normalizePresetKey(input.templateName) : '';
      console.log('[presetSelect]', {
        source: input.source,
        presetId: input.templateId,
        presetName: input.templateName ?? null,
        normalizedId,
        normalizedName,
      });
    }
    if (!input.applyToPlan) {
      if (input.allowVertical) {
        applyPlanUpdate('template:vertical', (prev) =>
          applyVerticalFromPresetPair(input.templateId, input.templateName ?? null, prev)
        );
      }
      return;
    }
    applyPlanUpdate('template:select', (prev) => {
      const nextPlan = createTemplateSeedPlan({
        templateId: input.templateId,
        origin: buildSeedOrigin(),
        baseTitle: 'New plan',
        baseIntent: 'What do we want to accomplish?',
        baseAudience: 'me-and-friends',
        applyVerticalPreset: false,
      });
      if (!input.allowVertical) return nextPlan;
      const resolvedVerticalId = mapPresetToVerticalTemplateId({
        id: input.templateId,
        name: input.templateName,
      });
      const finalPlan = resolvedVerticalId
        ? setPlanTemplateId(nextPlan, resolvedVerticalId)
        : nextPlan;
      if (process.env.NODE_ENV === 'development') {
        console.log('[template:select] mutate', {
          prevTemplateId: prev.template_id ?? null,
          nextTemplateId: finalPlan.template_id ?? null,
        });
      }
      planUpdateMetaRef.current = {
        presetId: input.templateId,
        presetName: input.templateName,
        resolvedVerticalId,
      };
      if (process.env.NODE_ENV === 'development') {
        console.log('[verticalPresetFinal]', {
          presetId: input.templateId,
          resolvedVerticalId: resolvedVerticalId ?? null,
          finalPlanTemplateId: finalPlan.template_id ?? null,
        });
      }
      return finalPlan;
    });
  }

  function buildSeedOrigin(): PlanOrigin | null {
    const hasOriginSource =
      initialOrigin?.entityId ||
      initialOrigin?.entityName ||
      initialOrigin?.query ||
      initialOrigin?.mood ||
      initialOrigin?.source;
    if (initialOrigin && hasOriginSource) {
      return buildOriginFromContext({
        entityId: initialOrigin.entityId,
        label: initialOrigin.entityName,
        query: initialOrigin.query,
        mood: initialOrigin.mood,
        source:
          initialOrigin.source === 'home_search'
            ? 'search'
            : (initialOrigin.source as PlanOriginKind | undefined),
      });
    }
    return buildOriginFromContext(discoveryContext);
  }

  const setOriginOnce = useCallback((nextOrigin: Origin) => {
    if (loadOrigin()) return;
    saveOrigin(nextOrigin);
  }, []);

  const backToSearchHref = useMemo(() => {
    const session = loadDiscoverySession();
    if (session) {
      return `${session.path}${session.queryString}`;
    }
    if (initialOrigin?.source === 'home_search') {
      return '/';
    }
    return null;
  }, [initialOrigin?.source]);

  const planOriginKind = plan.meta?.origin?.kind ?? plan.origin?.kind;
  const { uiModeLabel, isTemplateUi } = useMemo(() => {
    const templateUi =
      plan.isTemplate ||
      planOriginKind === 'template' ||
      editTemplateParam === '1' ||
      isTemplatePreview;
    if (entryMode === 'publish') {
      return { uiModeLabel: 'Publish (Read-only)', isTemplateUi: false };
    }
    if (entryMode === 'curate') {
      return { uiModeLabel: 'Curate (Read-only)', isTemplateUi: false };
    }
    if (!canEdit) {
      return { uiModeLabel: 'Plan (Read-only)', isTemplateUi: templateUi };
    }
    return { uiModeLabel: 'Plan (Editable)', isTemplateUi: templateUi };
  }, [
    canEdit,
    editTemplateParam,
    entryMode,
    isTemplatePreview,
    plan.isTemplate,
    planOriginKind,
  ]);
  const isTemplatePrimary = isTemplateUi && !!userId && !isReadOnly;
  const hasFrom = Boolean(fromParam || fromEncoded);
  const withPlanMode = useCallback((href: string) => {
    const url = new URL(href, 'http://example.com');
    url.searchParams.set('mode', 'plan');
    const qs = url.searchParams.toString();
    return `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`;
  }, []);
  const openEditorHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('templatePreview');
    const qs = params.toString();
    return withPlanMode(`/create${qs ? `?${qs}` : ''}`);
  }, [searchParams, withPlanMode]);
  const handleReadOnlyHint = useCallback(() => {
    if (!isReadOnly) return;
    if (readOnlyHintShownRef.current) return;
    readOnlyHintShownRef.current = true;
    setShowReadOnlyHint(true);
  }, [isReadOnly]);
  const backToTemplatesHref = useMemo(() => {
    if (!plan.isTemplate && planOriginKind !== 'template') return null;
    const safeReturnTo = sanitizeReturnTo(returnToParam);
    if (safeReturnTo) {
      try {
        const url = new URL(safeReturnTo, 'http://example.com');
        if (url.pathname === '/' && url.searchParams.get('templates') === '1') {
          return safeReturnTo;
        }
      } catch {
        // ignore invalid returnTo
      }
    }
    return originUrl ?? '/?templates=1';
  }, [originUrl, plan.isTemplate, planOriginKind, returnToParam]);

  const editorReturnTo = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('returnTo');
    params.delete('templatePreview');
    const qs = params.toString();
    return `/create${qs ? `?${qs}` : ''}`;
  }, [searchParams]);

  const handleBackToSearch = useCallback(() => {
    markDiscoveryRestore();
  }, []);

  const modePreservedBackToSearchHref = useMemo(() => {
    return backToSearchHref ? withPreservedMode(backToSearchHref, searchParams) : null;
  }, [backToSearchHref, searchParams]);

  const modePreservedBackToTemplatesHref = useMemo(() => {
    return backToTemplatesHref ? withPreservedMode(backToTemplatesHref, searchParams) : null;
  }, [backToTemplatesHref, searchParams]);

  const defaultBackHomeHref = useMemo(
    () => withPreservedMode('/', searchParams),
    [searchParams]
  );

  const backAction = useMemo(() => {
    if (planOriginKind === 'search') {
      return {
        href: modePreservedBackToSearchHref ?? defaultBackHomeHref,
        label: 'Back to browsing',
        onClick: handleBackToSearch,
      };
    }
    if (planOriginKind === 'template') {
      return {
        href:
          modePreservedBackToTemplatesHref ??
          withPreservedMode('/?templates=1', searchParams),
        label: 'Back to browsing',
      };
    }
    return {
      href: defaultBackHomeHref,
      label: 'Back to browsing',
    };
  }, [
    defaultBackHomeHref,
    handleBackToSearch,
    modePreservedBackToSearchHref,
    modePreservedBackToTemplatesHref,
    planOriginKind,
    searchParams,
  ]);

  const originLabel = hasMounted ? origin?.label ?? 'This plan' : 'This plan';
  const originMeta = plan.meta?.origin ?? plan.origin;
  const sourceLabel =
    originMeta?.kind === 'toolkit'
      ? `Source: ${originMeta.label ?? 'Toolkit'}`
      : originMeta?.kind === 'template'
        ? `Source: ${originMeta.label ?? 'Template'}`
        : null;

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEBUG_ENTRYMODE !== '1') return;
    console.log('[entrymode]', {
      uiModeLabel,
      entryMode,
      canEdit,
      isTemplateUi,
      hasFrom,
    });
  }, [canEdit, entryMode, hasFrom, isTemplateUi, uiModeLabel]);

  useEffect(() => {
    if (originInitRef.current) return;
    originInitRef.current = true;
    if (origin) return;
    const nextOrigin = deriveOriginFromParams(fromParam, originSourceParam);
    setOriginOnce(nextOrigin);
    setOrigin(loadOrigin());
  }, [fromParam, origin, originSourceParam, setOriginOnce]);

  useEffect(() => {
    if (hasPrefilledFromParamsRef.current) return;
    if (planIdParam || fromParam || fromEncoded) return;
    const preset = presetParam?.trim() || null;
    const seed = seedParam?.trim() || null;
    if (!preset && !seed) return;
    hasPrefilledFromParamsRef.current = true;

    if (preset) {
      const template = getTemplateV2ById(preset);
        if (template) {
          handleTemplatePresetSelection({
            templateId: template.id,
            templateName: template.name,
            applyToPlan: true,
            allowVertical: true,
            source: 'url',
          });
          return;
        }
      const templateSeed = getTemplateSeedById(preset);
      if (templateSeed) {
        applyPlanUpdate('template:seed', () => createPlanFromTemplateSeed(templateSeed));
      }
      return;
    }

    if (seed) {
      const templateSeed = getTemplateSeedById(seed);
      if (!templateSeed) return;
      applyPlanUpdate('template:seed', () => createPlanFromTemplateSeed(templateSeed));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- URL-driven seed/preset init intentionally ignores unstable callbacks
  }, [fromEncoded, fromParam, planIdParam, presetParam, seedParam]);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (!planIdParam) {
      setPlanOwnerId(null);
    }
  }, [planIdParam]);

  useEffect(() => {
    if (!shouldCheckRole || !planIdParam || !userId) {
      setRoleStatus('resolved');
      setMyRole(null);
      setRoleError(null);
      return;
    }
    if (planOwnerId && planOwnerId === userId) {
      setRoleStatus('resolved');
      setMyRole('owner');
      setRoleError(null);
      return;
    }
    let cancelled = false;
    setRoleStatus('loading');
    getMyRole(planIdParam, userId)
      .then((result) => {
        if (cancelled) return;
        setMyRole(result.role ?? null);
        setRoleError(result.error ?? null);
        setRoleStatus('resolved');
      })
      .catch(() => {
        if (cancelled) return;
        setMyRole(null);
        setRoleError('Role check unavailable.');
        setRoleStatus('resolved');
      });
    return () => {
      cancelled = true;
    };
  }, [planIdParam, planOwnerId, shouldCheckRole, userId]);

  useEffect(() => {
    if (cloudDraftUserIdRef.current !== userId) {
      cloudDraftUserIdRef.current = userId;
      hasCheckedCloudDraftRef.current = false;
      lastCloudDraftJsonRef.current = null;
      lastCloudDraftUpdatedAtRef.current = 0;
      setCloudDraftReady(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!planIdParam) {
      setAllowTemplateEdit(false);
      return;
    }
    if (isTemplatePreview) {
      setAllowTemplateEdit(false);
      return;
    }
    if (!plan.isTemplate) {
      setAllowTemplateEdit(false);
    }
    if (editTemplateParam === '1' && plan.isTemplate) {
      setAllowTemplateEdit(true);
    }
  }, [editTemplateParam, isTemplatePreview, plan.isTemplate, planIdParam]);

  useEffect(() => {
    if (!origin) return;
    if (!originStableRef.current) {
      originStableRef.current = origin;
      return;
    }
    if (!isSameOrigin(originStableRef.current, origin)) {
      console.warn('[Origin] Unexpected change post-init', {
        previous: originStableRef.current,
        next: origin,
      });
    }
  }, [origin]);

  useEffect(() => {
    const nextPlanId = plan.id || planIdParam || null;
    const previous = viewModeRef.current;
    if (previous && previous.mode === viewMode && previous.planId === nextPlanId) {
      return;
    }
    if (
      previous &&
      process.env.NODE_ENV === 'development' &&
      process.env.NEXT_PUBLIC_DEBUG_ORIGINS === '1'
    ) {
      console.log('[nav] transition', {
        from: previous.mode,
        to: viewMode,
        planId: nextPlanId,
      });
    }
    viewModeRef.current = { mode: viewMode, planId: nextPlanId };
  }, [plan.id, planIdParam, viewMode]);

  const discoveryContextLine = useMemo(() => {
    const origin = plan.meta?.origin ?? plan.origin;
    if (!origin) return null;
    if (origin.kind === 'surprise') {
      return 'Generated via Surprise Me';
    }
    if (origin.kind === 'curated') {
      return 'Started from curated experience';
    }
    if (origin.kind === 'template') {
      return 'Started from template';
    }
    if (origin.kind === 'search' && origin.label) {
      return `From search: ${origin.label}`;
    }
    if (origin.kind === 'search' && origin.query) {
      return `Started from search: "${origin.query}"`;
    }
    if (origin.kind === 'mood' && origin.mood) {
      return `Started from mood: ${formatMoodLabel(origin.mood)}`;
    }
    if (origin.label) {
      return `Started from: ${origin.label}`;
    }
    if (origin.kind === 'unknown') {
      return 'Started from Waypoint';
    }
    return null;
  }, [plan.meta, plan.origin]);

  const districtContext = useMemo(() => {
    const context = plan.context?.district;
    if (!context) return null;
    const name = context.name?.trim();
    const cityLabel = context.cityName?.trim() || context.citySlug?.trim() || context.cityId?.trim();
    const label = context.label?.trim() || (name && cityLabel ? `${name} (${cityLabel})` : name);
    if (!name || !label) return null;
    return {
      id: context.id,
      slug: context.slug,
      name,
      cityId: context.cityId,
      citySlug: context.citySlug,
      cityName: context.cityName,
      label,
    };
  }, [plan.context?.district]);

  const districtLine = useMemo(() => {
    if (!districtContext) return null;
    const cityLabel =
      districtContext.cityName || districtContext.citySlug || districtContext.cityId;
    return `District: ${districtContext.name}${
      cityLabel ? ` (${cityLabel})` : ''
    }`;
  }, [districtContext]);

  const districtIndicator = districtLine ? (
    <p className="text-xs text-slate-500">{districtLine}</p>
  ) : null;

  const lastLoggedDistrictRef = useRef<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (!districtContext) return;
    const logKey = `${districtContext.id}:${districtContext.cityId ?? districtContext.citySlug ?? ''}`;
    if (lastLoggedDistrictRef.current === logKey) return;
    lastLoggedDistrictRef.current = logKey;
    console.log('[district] parsed district context', {
      id: districtContext.id,
      slug: districtContext.slug,
      name: districtContext.name,
      cityId: districtContext.cityId,
      citySlug: districtContext.citySlug,
      cityName: districtContext.cityName,
      label: districtContext.label,
    });
  }, [districtContext]);

  const waysToBeginContext = useMemo(() => {
    if (discoveryContext.query) {
      return `Suggestions based on "${discoveryContext.query}"`;
    }
    if (discoveryContext.mood) {
      return `Suggestions for a ${formatMoodLabel(discoveryContext.mood)} mood`;
    }
    return null;
  }, [discoveryContext.mood, discoveryContext.query]);

  useEffect(() => {
    setHasShared(isPlanShared(plan.id));
  }, [plan.id]);

  useEffect(() => {
    if (fromParam) return;
    if (fromEncoded) return;

    const hasOriginSource =
      initialOrigin?.entityId ||
      initialOrigin?.entityName ||
      initialOrigin?.query ||
      initialOrigin?.mood ||
      initialOrigin?.source;
    const hasDiscoverySource =
      discoveryContext.query ||
      discoveryContext.mood ||
      discoveryContext.source ||
      discoveryContext.entityId ||
      discoveryContext.label;

    if (!hasOriginSource && !hasDiscoverySource) return;

    setPlan((prev) => {
      if (prev.meta?.origin || prev.origin) {
        return prev;
      }

      const origin =
        initialOrigin && hasOriginSource
          ? buildOriginFromContext({
              entityId: initialOrigin.entityId,
              label: initialOrigin.entityName,
              query: initialOrigin.query,
              mood: initialOrigin.mood,
              source:
                initialOrigin.source === 'home_search'
                  ? 'search'
                  : (initialOrigin.source as PlanOriginKind | undefined),
            })
          : buildOriginFromContext(discoveryContext);

      if (!origin) return prev;

      const isDefaultTitle = !prev.title || prev.title.trim() === '' || prev.title === 'New plan';
      const nextTitle = isDefaultTitle
        ? initialOrigin?.entityName || origin.label || prev.title
        : prev.title;

      const nextPlan = {
        ...prev,
        title: nextTitle,
        meta: {
          ...(prev.meta ?? {}),
          origin,
        },
        origin,
      };
      const preserved = preserveTemplateId(prev, nextPlan);
      logPlanUpdate('origin:prefill', preserved);
      return preserved;
    });
  }, [
    discoveryContext,
    discoveryContext.entityId,
    discoveryContext.label,
    discoveryContext.mood,
    discoveryContext.query,
    discoveryContext.source,
    fromEncoded,
    initialOrigin,
    fromParam,
  ]);

  const sourcePlanId = useMemo(() => {
    if (!sourceEncoded) return null;
    try {
      return deserializePlan(sourceEncoded).id || null;
    } catch {
      return null;
    }
  }, [sourceEncoded]);

  const draftKey = useMemo(() => {
    if (fromEncoded && sourcePlanId) {
      return `waypoint:draft:source:${sourcePlanId}`;
    }
    if (planIdParam) {
      return `waypoint:draft:plan:${planIdParam}`;
    }
    return null;
  }, [fromEncoded, planIdParam, sourcePlanId]);

  useEffect(() => {
    if (!hasMounted) return;
    if (userId && !cloudDraftReady) return;
    if (!planIdParam) return;
    if (hasLoadedSavedPlanRef.current) return;
    if (hasRestoredDraftRef.current) return;
    if (draftKey && !isReadOnly && loadDraftByKey(draftKey)) return;
    let cancelled = false;
    (async () => {
      if (userId) {
        const cloud = await fetchCloudPlan(planIdParam, userId);
        if (cancelled) return;
        if (cloud.ok) {
          setPlan((prev) => {
            const preserved = preserveTemplateId(prev, cloud.plan);
            logPlanUpdate('load:cloud-plan', preserved);
            return preserved;
          });
          setPlanOwnerId(cloud.ownerId ?? null);
          setPlanHydratedFromSource(true);
          hasPrefilledFromSource.current = true;
          hasLoadedSavedPlanRef.current = true;
          return;
        }
      }
      if (cancelled) return;
      const saved = getPlansIndex().find((item) => item.id === planIdParam);
      if (!saved?.encoded) return;
      try {
        const decoded = deserializePlan(saved.encoded);
        setPlan((prev) => {
          const preserved = preserveTemplateId(prev, decoded);
          logPlanUpdate('load:saved-plan', preserved);
          return preserved;
        });
        setPlanOwnerId(null);
        setPlanHydratedFromSource(true);
        hasPrefilledFromSource.current = true;
        hasRestoredDraftRef.current = true;
        hasLoadedSavedPlanRef.current = true;
      } catch {
        // ignore invalid payloads
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasMounted, planIdParam, cloudDraftReady, draftKey, isReadOnly, userId]);

  useEffect(() => {
    if (!fromParam) return;
    if (hasLoadedSavedPlanRef.current) return;
    if (hasRestoredDraftRef.current) return;
    if (originSourceParam !== 'home_search') return;
    if (draftKey && loadDraftByKey(draftKey)) return;
    try {
      const decoded = deserializePlan(fromParam);
      setPlan((prev) => {
        const preserved = preserveTemplateId(prev, decoded);
        logPlanUpdate('load:fromParam', preserved);
        return preserved;
      });
      setPlanHydratedFromSource(true);
      hasPrefilledFromSource.current = false;
    } catch {
      setInvalidFromError(true);
    }
  }, [fromParam, originSourceParam, draftKey]);

  function clonePlanForVariation(base: Plan): Plan {
    const cloned = createPlanFromTemplate(base);
    cloned.stops = cloned.stops.map((stop) => ({ ...stop }));
    cloned.constraints = cloned.constraints ? { ...cloned.constraints } : undefined;
    cloned.signals = cloned.signals ? { ...cloned.signals } : undefined;
    cloned.context = cloned.context ? { ...cloned.context } : undefined;
    cloned.metadata = cloned.metadata ? { ...cloned.metadata } : undefined;
    cloned.meta = cloned.meta ? { ...cloned.meta } : undefined;
    cloned.origin = cloned.origin ? { ...cloned.origin } : undefined;
    return cloned;
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- generateVariationOptions is intentionally defined inline
  function generateVariationOptions(base: Plan): VariationOption[] {
    const options: VariationOption[] = [];
    const anchorName = base.stops.find((s) => s.role === 'anchor')?.name || 'anchor stop';
    const audience = base.audience || 'your crew';

    const timestamp = new Date().toISOString();

    const addOption = (
      id: string,
      label: string,
      detail: string,
      mutate: (draft: Plan) => void
    ) => {
      const draft = clonePlanForVariation(base);
      mutate(draft);
      draft.metadata = {
        ...draft.metadata,
        lastUpdated: timestamp,
      };
      options.push({ id, label, detail, plan: draft });
    };

    addOption(
      'budget-friendly',
      'Budget-friendly',
      'Keep it wallet-light while staying together.',
      (draft) => {
        draft.constraints = { ...draft.constraints, budgetRange: 'Keep it affordable' };
        draft.context = { ...draft.context, localNote: 'Choose budget-friendly options.' };
      }
    );

    addOption(
      'earlier-start',
      'Earlier start',
      `Start earlier so ${audience} has buffer.`,
      (draft) => {
        draft.constraints = { ...draft.constraints, timeWindow: 'Start 45-60 minutes earlier' };
        draft.signals = { ...draft.signals, flexibility: 'tight' };
      }
    );

    addOption(
      'outdoor-shift',
      'Outdoor shift',
      `Lean outdoors for the ${anchorName}.`,
      (draft) => {
        if (draft.stops.length > 0) {
          draft.stops[0] = {
            ...draft.stops[0],
            notes: `${draft.stops[0].notes ?? ''} Try an outdoor-friendly version.`.trim(),
          };
        }
        draft.constraints = { ...draft.constraints, mobility: draft.constraints?.mobility ?? 'easy' };
        draft.context = { ...draft.context, localNote: 'If weather is decent, pick an outdoor spot.' };
      }
    );

    return options.slice(0, 3);
  }

  const getVariationKeys = useCallback(
    (planId: string) => ({
      seen: `variation_seen_${planId}`,
      dismissed: `variation_dismissed_${planId}`,
    }),
    []
  );

  useEffect(() => {
    if (!hasMounted) return;
    if (!userId) {
      hasCheckedCloudDraftRef.current = true;
      setCloudDraftReady(true);
      return;
    }
    if (isRoleLoading) return;
    if (isReadOnly) {
      hasCheckedCloudDraftRef.current = true;
      setCloudDraftReady(true);
      return;
    }
    if (!draftKey) {
      hasCheckedCloudDraftRef.current = true;
      setCloudDraftReady(true);
      return;
    }
    if (hasRestoredDraftRef.current) {
      hasCheckedCloudDraftRef.current = true;
      setCloudDraftReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await fetchCloudDraft(draftKey, userId);
      if (cancelled) return;
      hasCheckedCloudDraftRef.current = true;
      setCloudDraftReady(true);
      if (!result.ok) return;
      hasRestoredDraftRef.current = true;
      hasPrefilledFromSource.current = true;
      lastCloudDraftJsonRef.current = JSON.stringify(result.draft);
      lastCloudDraftUpdatedAtRef.current = result.updatedAt;
      setPlan((prev) => {
        const preserved = preserveTemplateId(prev, result.draft);
        logPlanUpdate('draft:cloud', preserved);
        return preserved;
      });
      setPlanHydratedFromSource(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [draftKey, hasMounted, isReadOnly, isRoleLoading, userId]);

  useEffect(() => {
    const existing = getPlansIndex().find((item) => item.id === plan.id);
    setIsSaved(existing?.isSaved ?? false);
    setIsCommitted(!!existing);
  }, [plan.id]);
  useEffect(() => {
    if (!fromEncoded) return;
    if (hasLoadedSavedPlanRef.current) return;
    if (hasRestoredDraftRef.current) return;
    if (userId && !cloudDraftReady) return;
    if (originSourceParam === 'home_search') return;
    if (draftKey && isEditorReady && loadDraftByKey(draftKey)) return;
    setSourceExistsInSupabase(false);
    setSourceOwnedByUser(false);
    let cancelled = false;

    (async () => {
      try {
        const decoded = deserializePlan(fromEncoded);
        const isTemplateSource = !!decoded.isTemplate;
        if (sourcePlanId) {
          const { data: existing } = await supabase
            .from(CLOUD_PLANS_TABLE)
            .select('id,owner_id')
            .eq('id', sourcePlanId)
            .limit(1);
          if (cancelled) return;
          const exists = !!existing && existing.length > 0;
          const owned = exists && existing?.[0]?.owner_id === userId;
          setSourceExistsInSupabase(exists);
          setSourceOwnedByUser(owned);
          if (owned && !isTemplateSource) {
            setPlan((prev) => {
              const preserved = preserveTemplateId(prev, decoded);
              logPlanUpdate('load:fromEncoded:owned', preserved);
              return preserved;
            });
            setPlanHydratedFromSource(true);
            return;
          }
        }
        if (cancelled) return;
        const nextPlan = isTemplateSource
          ? createPlanFromTemplatePlan(decoded)
          : createPlanFromTemplate(decoded);
        setPlan((prev) => {
          const preserved = preserveTemplateId(prev, nextPlan);
          logPlanUpdate('load:fromEncoded:clone', preserved);
          return preserved;
        });
        setPlanHydratedFromSource(true);
      } catch {
        setInvalidFromError(true);
        setPlanHydratedFromSource(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    fromEncoded,
    originSourceParam,
    sourcePlanId,
    supabase,
    userId,
    cloudDraftReady,
    draftKey,
    isEditorReady,
  ]);

  useEffect(() => {
    if (!fromEncoded) {
      setPlanHydratedFromSource(true);
    }
  }, [fromEncoded]);

  useEffect(() => {
    if (!hasMounted) return;
    if (fromParam || fromEncoded || planIdParam) return;
    const nextPlan = createEmptyPlan({
      title: 'New plan',
      intent: 'What do we want to accomplish?',
      audience: 'me-and-friends',
    });
    setPlan((prev) => {
      const preserved = preserveTemplateId(prev, nextPlan);
      logPlanUpdate('init:empty', preserved);
      return preserved;
    });
    setPlanHydratedFromSource(true);
    setInvalidFromError(false);
    setSourceExistsInSupabase(false);
    setSourceOwnedByUser(false);
    setShowCopyNotice(false);
    hasLoadedSavedPlanRef.current = false;
    hasRestoredDraftRef.current = false;
    hasPrefilledFromSource.current = false;
  }, [fromEncoded, fromParam, hasMounted, planIdParam]);


  useEffect(() => {
    if (!hasMounted) return;
    if (!draftKey) return;
    if (!isEditorReady) return;
    if (hasLoadedSavedPlanRef.current) return;
    if (hasRestoredDraftRef.current) return;
    if (userId && !cloudDraftReady) return;
    const committed = plan.id ? getPlansIndex().some((item) => item.id === plan.id) : false;
    if (committed) return;
    const draft = loadDraftByKey(draftKey);
    if (!draft) return;
    hasRestoredDraftRef.current = true;
    hasPrefilledFromSource.current = true;
    setPlan((prev) => {
      const preserved = preserveTemplateId(prev, draft);
      logPlanUpdate('draft:local', preserved);
      return preserved;
    });
    setPlanHydratedFromSource(true);
  }, [draftKey, hasMounted, isEditorReady, plan.id, userId, cloudDraftReady]);

  const validation = useMemo(() => validatePlan(plan), [plan]);

  const encodedPath = useMemo(() => {
    try {
      const href = `/plan?p=${encodeURIComponent(serializePlan(plan))}`;
      return withPreservedMode(href, searchParams);
    } catch {
      return '';
    }
  }, [plan, searchParams]);

  const encodedFullUrl = useMemo(() => {
    if (!encodedPath) return '';
    return typeof window !== 'undefined'
      ? `${window.location.origin}${encodedPath}`
      : encodedPath;
  }, [encodedPath]);

  const sourceLink = useMemo(() => {
    if (!sourceEncoded) return '';
    try {
      const href = `/plan?p=${encodeURIComponent(sourceEncoded)}`;
      return withPreservedMode(href, searchParams);
    } catch {
      return '';
    }
  }, [searchParams, sourceEncoded]);

  useEffect(() => {
    if (!fromEncoded) return;
    setShowCopyNotice(true);
  }, [fromEncoded]);

  function generateStopId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `stop_${Math.random().toString(36).slice(2, 8)}`;
  }

  const PLACEHOLDER_NOTE = 'Pick from search results.';

  function storeTemplateIdForPlan(planId: string, templateId: string) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(`plan-template:${planId}`, templateId);
    } catch {
      // ignore storage failures; createdFrom still carries templateId
    }
  }

  function buildTemplateStops(template: TemplateV2): Stop[] {
    const count = Math.max(1, template.defaultStopCount);
    const stops: Stop[] = [];
    for (let index = 0; index < count; index += 1) {
      stops.push({
        id: generateStopId(),
        name: `Stop ${index + 1}`,
        role: index === 0 ? 'anchor' : 'support',
        optionality: 'required',
        notes: PLACEHOLDER_NOTE,
      });
    }
    return stops;
  }

  function createTemplateSeedPlan(input?: {
    templateId?: string | null;
    origin?: PlanOrigin | null;
    baseTitle?: string;
    baseIntent?: string;
    baseAudience?: string;
    applyVerticalPreset?: boolean;
  }): Plan {
    const template =
      getTemplateV2ById(input?.templateId) ?? getTemplateV2ById(DEFAULT_TEMPLATE_V2_ID);
    const safeTemplate =
      template ?? TEMPLATES_V2.find((item) => item.id === DEFAULT_TEMPLATE_V2_ID) ?? TEMPLATES_V2[0];
    const next = createEmptyPlan({
      title: input?.baseTitle ?? 'New plan',
      intent: input?.baseIntent ?? 'What do we want to accomplish?',
      audience: input?.baseAudience ?? 'me-and-friends',
    });
    const nextPlan =
      input?.applyVerticalPreset === false
        ? setPlanTemplateId(next, undefined)
        : applyVerticalFromPreset(safeTemplate.id, next);
    nextPlan.stops = buildTemplateStops(safeTemplate);
    nextPlan.createdFrom = {
      kind: 'template',
      templateId: safeTemplate.id,
      templateTitle: safeTemplate.name,
    };
    if (input?.origin) {
      const nextTitle =
        nextPlan.title === 'New plan' && input.origin.label ? input.origin.label : nextPlan.title;
      nextPlan.title = nextTitle;
      nextPlan.meta = {
        ...nextPlan.meta,
        origin: input.origin,
      };
      nextPlan.origin = input.origin;
    }
    storeTemplateIdForPlan(nextPlan.id, safeTemplate.id);
    return nextPlan;
  }

  useEffect(() => {
    // Ensure source-driven plans have a meaningful title/anchor stop when they arrive
    if (!planHydratedFromSource || hasPrefilledFromSource.current) return;
    let nextPlan = plan;
    let updated = false;
    const hasTitle = (nextPlan.title ?? '').trim().length > 0;
    if (!hasTitle) {
      nextPlan = {
        ...nextPlan,
        title: 'Waypoint idea',
        intent: nextPlan.intent || 'Start with this setup.',
      };
      updated = true;
    }
    if (!nextPlan.stops || nextPlan.stops.length === 0) {
      const anchorStop: Stop = {
        id: generateStopId(),
        name: nextPlan.title || 'Anchor stop',
        role: 'anchor',
        optionality: 'required',
        notes: nextPlan.intent || 'Kick things off here.',
      };
      nextPlan = { ...nextPlan, stops: [anchorStop] };
      updated = true;
    }
    if (updated) {
      setPlan((prev) => {
        const preserved = preserveTemplateId(prev, nextPlan);
        logPlanUpdate('source:prefill', preserved);
        return preserved;
      });
    }
    hasPrefilledFromSource.current = true;
  }, [plan, planHydratedFromSource]);

  useEffect(() => {
    hasPrefilledFromSource.current = false;
  }, [plan.id]);

  function isMeaningfulDraft(nextPlan: Plan) {
    const hasStops = (nextPlan.stops ?? []).length > 0;
    const hasTitle = (nextPlan.title ?? '').trim().length > 0;
    const hasIntent = (nextPlan.intent ?? '').trim().length > 0;
    return hasStops || hasTitle || hasIntent;
  }

  function queueLocalDraftSave(nextPlan: Plan) {
    if (!hasMounted) return;
    if (!draftKey) return;
    if (isCommitted) return;
    if (!isMeaningfulDraft(nextPlan)) return;
    if (draftSaveTimeoutRef.current) {
      window.clearTimeout(draftSaveTimeoutRef.current);
    }
    draftSaveTimeoutRef.current = window.setTimeout(() => {
      const nextJson = JSON.stringify(nextPlan);
      if (nextJson === lastDraftJsonRef.current) return;
      saveDraftByKey(draftKey, nextPlan);
      lastDraftJsonRef.current = nextJson;
    }, 500);
  }

  function queueCloudDraftSave(nextPlan: Plan) {
    if (!hasMounted) return;
    if (!userId) return;
    if (!cloudDraftReady) return;
    if (!draftKey) return;
    if (isCommitted) return;
    if (!isMeaningfulDraft(nextPlan)) return;
    if (cloudDraftSaveTimeoutRef.current) {
      window.clearTimeout(cloudDraftSaveTimeoutRef.current);
    }
    cloudSaveGenerationRef.current += 1;
    const generation = cloudSaveGenerationRef.current;
    const scheduledAt = Date.now();
    cloudDraftSaveTimeoutRef.current = window.setTimeout(() => {
      if (generation !== cloudSaveGenerationRef.current) return;
      const nextJson = JSON.stringify(nextPlan);
      if (nextJson === lastCloudDraftJsonRef.current) return;
      if (scheduledAt < lastCloudDraftUpdatedAtRef.current) return;
      void upsertCloudDraft(draftKey, nextPlan, userId).then((result) => {
        if (!result.ok) return;
        lastCloudDraftJsonRef.current = nextJson;
        lastCloudDraftUpdatedAtRef.current = Date.now();
      });
    }, 900);
  }

  function queueDraftSave(nextPlan: Plan) {
    if (isReadOnly) return;
    queueLocalDraftSave(nextPlan);
    queueCloudDraftSave(nextPlan);
  }

  function logPlanUpdate(
    label: string,
    nextPlan: Plan,
    meta?: { presetId?: string; presetName?: string; resolvedVerticalId?: string } | null
  ) {
    if (process.env.NODE_ENV !== 'development') return;
    console.log('[plan update]', {
      label,
      presetId: meta?.presetId,
      presetName: meta?.presetName,
      resolvedVerticalId: meta?.resolvedVerticalId,
      template_id: nextPlan.template_id,
    });
  }

  function preserveTemplateId(prev: Plan, next: Plan): Plan {
    if (Object.prototype.hasOwnProperty.call(next, 'template_id')) return next;
    if (!next.template_id && prev.template_id) {
      return { ...next, template_id: prev.template_id };
    }
    return next;
  }

  function applyPlanUpdate(
    reason: string,
    recipe: (prev: Plan) => Plan,
    onAfter?: (prev: Plan, next: Plan) => void
  ) {
    if (isReadOnly) return;
    setPlan((prev) => {
      const nextPlan = recipe(prev);
      if (nextPlan === prev) return prev;
      const preserved = preserveTemplateId(prev, nextPlan);
      const meta = planUpdateMetaRef.current;
      planUpdateMetaRef.current = null;
      logPlanUpdate(reason, preserved, meta);
      queueDraftSave(preserved);
      onAfter?.(prev, preserved);
      return preserved;
    });
  }

  function getStopTypeIdForEvent(stop: Stop | undefined | null): string | null {
    if (!stop) return null;
    return stop.stop_type_id ?? null;
  }

  function getDefaultStopTypeIdForNewStop(): string | undefined {
    if (!verticalTemplate) return undefined;
    const stopTypeIds = verticalTemplate.stopTypes.map((stopType) => stopType.id);
    if (stopTypeIds.includes('support')) return 'support';
    return (
      verticalTemplate.editorGuidance?.suggestedOrder?.[0] ??
      verticalTemplate.stopTypes[0]?.id
    );
  }

  function logStopEvent(eventType: string, nextPlan: Plan, stopTypeId: string | null) {
    if (!nextPlan.id) return;
    void logEvent(eventType, {
      planId: nextPlan.id,
      templateId: nextPlan.template_id ?? null,
      stopTypeId: stopTypeId ?? null,
    });
  }

  function updateStop(id: string, updater: (stop: Stop) => Stop) {
    let beforeType: string | null = null;
    let afterType: string | null = null;
    applyPlanUpdate(
      'stop:update',
      (prev) => ({
        ...prev,
        stops: prev.stops.map((stop) => {
          if (stop.id !== id) return stop;
          beforeType = getStopTypeIdForEvent(stop);
          const nextStop = updater(stop);
          afterType = getStopTypeIdForEvent(nextStop);
          return nextStop;
        }),
      }),
      (_prev, next) => {
        if (beforeType === afterType) return;
        const stopTypeId = afterType ?? beforeType;
        logStopEvent('stop_type_changed', next, stopTypeId ?? null);
      }
    );
  }

  function removeStop(id: string) {
    let removedType: string | null = null;
    applyPlanUpdate(
      'stop:remove',
      (prev) => ({
        ...prev,
        stops: prev.stops.filter((stop) => {
          if (stop.id !== id) return true;
          removedType = getStopTypeIdForEvent(stop);
          return false;
        }),
      }),
      (_prev, next) => {
        logStopEvent('stop_removed', next, removedType);
      }
    );
  }

  function addStop() {
    let newStopType: string | null = null;
    applyPlanUpdate(
      'stop:add',
      (prev) => {
        const stopTypeId = getDefaultStopTypeIdForNewStop();
        const newStop: Stop = {
          id: generateStopId(),
          name: 'New stop',
          role: 'support',
          optionality: 'flexible',
          stop_type_id: stopTypeId,
        };
        newStopType = getStopTypeIdForEvent(newStop);
        return {
          ...prev,
          stops: [...prev.stops, newStop],
        };
      },
      (_prev, next) => {
        logStopEvent('stop_added', next, newStopType);
      }
    );
  }

  function buildPackPlaceholderStop(
    index: number,
    stopTypeId?: string,
    forceAnchor?: boolean
  ): Stop {
    return {
      id: generateStopId(),
      name: `Suggested stop ${index + 1}`,
      role: forceAnchor ? 'anchor' : 'support',
      optionality: 'flexible',
      stop_type_id: stopTypeId,
      notes: PLACEHOLDER_NOTE,
      resolve: { placeholder: true },
    };
  }

  function applyExperiencePackDraft(draft: ExperiencePackDraft) {
    let nextCoachNudge: string | null = null;
    applyPlanUpdate('pack:draft_apply', (prev) => {
      const sequence = draft.commonStopSequence ?? [];
      const nextStops = [...(prev.stops ?? [])];
      const startedEmpty = nextStops.length === 0;

      if (startedEmpty && sequence.length > 0) {
        sequence.forEach((stopTypeId, index) => {
          nextStops.push(
            buildPackPlaceholderStop(index, stopTypeId || undefined, index === 0)
          );
        });
      }

      const targetCount =
        typeof draft.typicalStopsCount === 'number' && draft.typicalStopsCount > 0
          ? draft.typicalStopsCount
          : 0;
      while (nextStops.length < targetCount) {
        const seqType = sequence[nextStops.length] ?? undefined;
        nextStops.push(buildPackPlaceholderStop(nextStops.length, seqType, false));
      }

      if (nextStops.length === prev.stops.length) {
        return prev;
      }

      const hasAnchorStop = prev.stops.some((stop) => stop.role === 'anchor');
      if (!hasAnchorStop && draft.typicalHourBin) {
        nextCoachNudge = `Packs often work best in ${draft.typicalHourBin}. Add a time anchor if you want.`;
      } else {
        nextCoachNudge = null;
      }

      return {
        ...prev,
        stops: nextStops,
      };
    });
    setPackCoachNudge(nextCoachNudge);
  }

  function updatePresentation(next: Partial<NonNullable<Plan['presentation']>>) {
    applyPlanUpdate('presentation:update', (prev) => ({
      ...prev,
      presentation: {
        ...prev.presentation,
        ...next,
      },
    }));
  }

  async function handleOpenShare() {
    if (!encodedPath) return;
    await syncIfCommitted(plan);
    const params = new URLSearchParams();
    params.set('fromEdit', 'true');
    if (editorReturnTo) {
      params.set('returnTo', editorReturnTo);
    }
    const url = `${encodedPath}&${params.toString()}`;
    router.push(url);
  }

  function handleReturnToOriginal() {
    if (originUrl) {
      router.push(originUrl);
      return;
    }
    if (sourceLink) {
      router.push(sourceLink);
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/');
  }

  async function handleCopyShare() {
    if (!encodedFullUrl || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await syncIfCommitted(plan);
      await navigator.clipboard.writeText(encodedFullUrl);
      markPlanShared(plan.id);
      setShareStatus('copied');
      setHasShared(true);
      setTimeout(() => setShareStatus('idle'), 1500);
    } catch {
      // ignore copy errors in this lightweight UI
    }
  }

  function moveStopUp(index: number) {
    let movedType: string | null = null;
    let didMove = false;
    applyPlanUpdate(
      'stop:move-up',
      (prev) => {
        if (index <= 0) return prev;
        const nextStops = [...prev.stops];
        movedType = getStopTypeIdForEvent(nextStops[index]);
        const temp = nextStops[index - 1];
        nextStops[index - 1] = nextStops[index];
        nextStops[index] = temp;
        didMove = true;
        return { ...prev, stops: nextStops };
      },
      (_prev, next) => {
        if (!didMove) return;
        logStopEvent('stop_reordered', next, movedType);
      }
    );
  }

  function moveStopDown(index: number) {
    let movedType: string | null = null;
    let didMove = false;
    applyPlanUpdate(
      'stop:move-down',
      (prev) => {
        if (index >= prev.stops.length - 1) return prev;
        const nextStops = [...prev.stops];
        movedType = getStopTypeIdForEvent(nextStops[index]);
        const temp = nextStops[index + 1];
        nextStops[index + 1] = nextStops[index];
        nextStops[index] = temp;
        didMove = true;
        return { ...prev, stops: nextStops };
      },
      (_prev, next) => {
        if (!didMove) return;
        logStopEvent('stop_reordered', next, movedType);
      }
    );
  }

  const syncIfCommitted = useCallback(
    async (nextPlan: Plan) => {
      if (!isEditorReady) return;
      if (!isCommitted) return;
      const saved = upsertRecentPlan(nextPlan);
      setIsSaved(saved.isSaved);
      if (!userId) return;
        try {
          const parentId =
            sourceExistsInSupabase && sourcePlanId && sourcePlanId !== nextPlan.id
              ? sourcePlanId
              : null;
          const { data: sessionData } = await supabase.auth.getSession();
          if (!sessionData.session?.user) return;
          await upsertCloudPlan(
            {
              ...nextPlan,
              owner: nextPlan.owner ?? { type: 'user', id: userId },
              editPolicy:
                nextPlan.editPolicy ??
                ((nextPlan.origin?.kind ?? nextPlan.meta?.origin?.kind) === 'curated'
                  ? 'fork_required'
                  : 'owner_only'),
            },
            userId,
            { parentId }
          );
        } catch {
          // ignore persistence errors to keep UI lightweight
        }
      },
    [isCommitted, isEditorReady, sourceExistsInSupabase, sourcePlanId, supabase, userId]
  );

  const commitPlan = useCallback(
      async (nextPlan: Plan) => {
        if (isReadOnly) return false;
        setCommitStatus('saving');
        setCloudCommitError(null);
        let didCommit = false;
        try {
          const originKind = nextPlan.origin?.kind ?? nextPlan.meta?.origin?.kind;
          const editPolicy =
            nextPlan.editPolicy ?? (originKind === 'curated' ? 'fork_required' : 'owner_only');
          const planWithOwner: Plan = {
            ...nextPlan,
            owner: nextPlan.owner ?? (userId ? { type: 'user', id: userId } : undefined),
            editPolicy,
          };
          if (planWithOwner !== plan) {
            setPlan((prev) => {
              const preserved = preserveTemplateId(prev, planWithOwner);
              logPlanUpdate('commit:owner', preserved);
              return preserved;
            });
          }
          const saved = upsertRecentPlan(planWithOwner);
          setIsSaved(saved.isSaved);
          setIsCommitted(true);
          didCommit = true;
          clearDraftByKey(draftKey);
          if (userId && draftKey) {
            await clearCloudDraft(draftKey, userId);
          }
          const nextHref = withPreservedMode(
            `/plans/${encodeURIComponent(planWithOwner.id)}`,
            searchParams
          );
          router.replace(nextHref);
          setCommitStatus('done');
          setTimeout(() => setCommitStatus('idle'), 1200);
        } catch {
        setCommitStatus('error');
        setTimeout(() => setCommitStatus('idle'), 1500);
      }
        if (!didCommit) return false;
        if (!userId) return didCommit;
        const parentId =
          sourceExistsInSupabase && sourcePlanId && sourcePlanId !== nextPlan.id
            ? sourcePlanId
            : null;
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          if (!sessionData.session?.user) return;
          const result = await upsertCloudPlan(
            {
              ...nextPlan,
              owner: nextPlan.owner ?? { type: 'user', id: userId },
              editPolicy:
                nextPlan.editPolicy ??
                ((nextPlan.origin?.kind ?? nextPlan.meta?.origin?.kind) === 'curated'
                  ? 'fork_required'
                  : 'owner_only'),
            },
            userId,
            { parentId }
          );
          if (!result.ok) {
            setCloudCommitError('Saved locally; cloud save failed.');
          }
            if (result.ok) {
              void logEvent('plan_created', {
                planId: nextPlan.id,
                templateId: nextPlan.template_id ?? null,
                payload: {
                  originKind: nextPlan.origin?.kind ?? nextPlan.meta?.origin?.kind ?? null,
                  source: 'cloud',
                  from: fromContextParam ?? null,
                },
              });
            }
        } catch {
          setCloudCommitError('Saved locally; cloud save failed.');
        }
        return didCommit;
    },
    [
      draftKey,
      fromContextParam,
      isReadOnly,
      plan,
      router,
      searchParams,
      sourceExistsInSupabase,
      sourcePlanId,
      supabase,
      userId,
    ]
  );

  const handleCommitPlan = useCallback(async () => {
    if (isReadOnly) return;
    await commitPlan(plan);
  }, [commitPlan, isReadOnly, plan]);

  useEffect(() => {
    if (!isCommitted) return;
    void syncIfCommitted(plan);
  }, [isCommitted, plan, syncIfCommitted]);

  useEffect(() => {
    if (!isCommitted) return;
    clearDraftByKey(draftKey);
    if (userId && draftKey) {
      void clearCloudDraft(draftKey, userId);
    }
  }, [draftKey, isCommitted, userId]);

  useEffect(() => {
    if (!fromEncoded) return;
    if (!planHydratedFromSource) return;
    if (!plan.id) return;
    if (typeof window === 'undefined') return;
    const { seen, dismissed } = getVariationKeys(plan.id);
    if (window.localStorage.getItem(dismissed) === '1') return;
    if (window.localStorage.getItem(seen) === '1') return;

    const options = generateVariationOptions(plan);
      if (options.length === 0) return;
    setVariationOptions(options);
    setShowVariations(true);
    window.localStorage.setItem(seen, '1');
  }, [fromEncoded, generateVariationOptions, getVariationKeys, plan, planHydratedFromSource]);

  const handleDismissVariations = useCallback(() => {
    if (typeof window !== 'undefined' && plan.id) {
      const { dismissed } = getVariationKeys(plan.id);
      window.localStorage.setItem(dismissed, '1');
    }
    setShowVariations(false);
    setVariationOptions([]);
  }, [getVariationKeys, plan.id]);

  const handleUseVariation = useCallback(
    async (option: VariationOption) => {
      if (isReadOnly) return;
      handleDismissVariations();
      const nextPlan = createPlanFromTemplate(option.plan);
      nextPlan.stops = nextPlan.stops.map((stop) => ({ ...stop }));
      nextPlan.constraints = nextPlan.constraints ? { ...nextPlan.constraints } : undefined;
      nextPlan.signals = nextPlan.signals ? { ...nextPlan.signals } : undefined;
      nextPlan.context = nextPlan.context ? { ...nextPlan.context } : undefined;
      nextPlan.metadata = nextPlan.metadata ? { ...nextPlan.metadata } : undefined;
      nextPlan.meta = nextPlan.meta ? { ...nextPlan.meta } : undefined;
      nextPlan.origin = nextPlan.origin ? { ...nextPlan.origin } : undefined;
      setIsCommitted(false);
      setIsSaved(false);
      const encoded = serializePlan(nextPlan);
      router.push(withPreservedMode(`/create?from=${encodeURIComponent(encoded)}`, searchParams));
    },
    [handleDismissVariations, isReadOnly, router, searchParams]
  );

  const handleConvertToTemplate = useCallback(async () => {
    if (isReadOnly) return;
    const wasTemplate = plan.isTemplate;
    setAllowTemplateEdit(true);
    const nextTemplateMeta = {
      title: (plan.templateMeta?.title || plan.title || 'Template').trim() || 'Template',
      intent: plan.intent || undefined,
      audience: plan.audience || undefined,
      tags: plan.templateMeta?.tags,
      packId: plan.templateMeta?.packId || 'custom',
      packTitle: plan.templateMeta?.packTitle || 'My templates',
      packDescription: plan.templateMeta?.packDescription,
      packTags: plan.templateMeta?.packTags,
    };
    const nextPlan: Plan = {
      ...plan,
      isTemplate: true,
      templateMeta: nextTemplateMeta,
      createdFrom: undefined,
    };
    const didCommit = await commitPlan(nextPlan);
    if (didCommit && !wasTemplate) {
      setShowTemplateConfirmation(true);
    }
  }, [commitPlan, isReadOnly, plan]);

  const isTemplatePlan = !!plan.isTemplate;
  const readOnlyTitle = (plan.title ?? '').trim() || 'Untitled plan';
  const readOnlyIntent = (plan.intent ?? '').trim() || 'No intent set.';
  const readOnlyStops = plan.stops ?? [];
  const templateBadge = plan.isTemplate
    ? 'Template'
    : plan.createdFrom?.kind === 'template'
      ? 'From template'
      : null;
  const templateHelper = plan.isTemplate
    ? "You&apos;re viewing a template. Start from it to author a plan."
    : plan.createdFrom?.kind === 'template'
      ? `Started from template: ${plan.createdFrom.templateTitle ?? 'Template'}`
      : null;

  const templateEditorHref = useMemo(() => {
    if (!plan.isTemplate) return null;
    const next = createPlanFromTemplatePlan(plan);
    const createdFromTitle =
      next.createdFrom?.kind === 'template' ? next.createdFrom.templateTitle : undefined;
    const origin = {
      kind: 'template' as const,
      label: createdFromTitle ?? plan.title,
      entityId: plan.id,
    };
    next.meta = {
      ...next.meta,
      origin,
    };
    next.origin = origin;
    const params = new URLSearchParams();
    params.set('from', serializePlan(next));
    const originHref = backToTemplatesHref ?? '/?templates=1';
    params.set('origin', originHref);
    params.set('returnTo', originHref);
    return withPlanMode(`/create?${params.toString()}`);
  }, [backToTemplatesHref, plan, withPlanMode]);

  const openEditorAction = useMemo(() => {
    if (!hasFrom && (isTemplateReadOnly || isTemplatePreview) && templateEditorHref) {
      return { href: templateEditorHref, label: 'Start from template' };
    }
    return { href: openEditorHref, label: 'Open plan editor' };
  }, [
    hasFrom,
    isTemplateReadOnly,
    isTemplatePreview,
    openEditorHref,
    templateEditorHref,
  ]);

  const readOnlyActionStrip = (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={openEditorAction.href} className={`${ctaClass('primary')} text-[11px]`}>
        {openEditorAction.label}
      </Link>
      <Link
        href={backAction.href}
        scroll={false}
        onClick={backAction.onClick}
        className={`${ctaClass('chip')} text-[11px]`}
      >
        {backAction.label}
      </Link>
    </div>
  );
  const invalidFromNotice = invalidFromError ? (
    <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100 space-y-2">
      <div>This link is invalid or incomplete.</div>
    </div>
  ) : null;

  const templatePreviewHref = useMemo(() => {
    if (!plan.id) return null;
    const params = new URLSearchParams();
    params.set('planId', plan.id);
    params.set('templatePreview', '1');
    params.set('returnTo', editorReturnTo);
    return withPreservedMode(`/create?${params.toString()}`, searchParams);
  }, [editorReturnTo, plan.id, searchParams]);

  const verticalTemplate = resolvePlanTemplate(plan);
  const guidance = buildVerticalGuidance({ template: verticalTemplate, planLike: plan });
  const experiencePackTemplateId = plan.template_id?.trim() || '';
  const experiencePackDistrict = useMemo(() => {
    for (const stop of plan.stops ?? []) {
      const formattedAddress = stop.placeLite?.formattedAddress;
      if (typeof formattedAddress !== 'string' || !formattedAddress.trim()) continue;
      const derivedDistrict = extractDistrict(formattedAddress);
      if (derivedDistrict) return derivedDistrict;
    }
    return '';
  }, [plan.stops]);
  const experiencePackCity = useMemo(() => {
    for (const stop of plan.stops ?? []) {
      const formattedAddress = stop.placeLite?.formattedAddress;
      if (typeof formattedAddress !== 'string' || !formattedAddress.trim()) continue;
      const derivedCity = extractCity(formattedAddress);
      if (derivedCity) return derivedCity;
    }
    return '';
  }, [plan.stops]);
  const experiencePackLocation = experiencePackDistrict || experiencePackCity || 'Unknown';
  const experiencePackDayOfWeek = useMemo(() => {
    const planRecord = plan as unknown as Record<string, unknown>;
    const dateRaw = typeof planRecord.date === 'string' ? planRecord.date : null;
    const dayOfWeek = getDayOfWeekFromDateInput(dateRaw);
    return typeof dayOfWeek === 'number' ? dayOfWeek : undefined;
  }, [plan]);
  const experiencePackHourBin = useMemo(() => {
    const planRecord = plan as unknown as Record<string, unknown>;
    const timeRaw = typeof planRecord.time === 'string' ? planRecord.time : null;
    const hourBin = getHourBinFromTimeInput(timeRaw);
    return hourBin ?? undefined;
  }, [plan]);
  const experiencePackMinDistinctPlans = process.env.NODE_ENV === 'development' ? 1 : 3;
  const shouldLogVerticalDebug = process.env.NEXT_PUBLIC_VERTICAL_DEBUG === '1';
  const experiencePackLocationKnown =
    experiencePackLocation.trim().length > 0 &&
    experiencePackLocation.trim().toLowerCase() !== 'unknown';
  const templateStopTypeIds = useMemo(
    () =>
      (verticalTemplate?.stopTypes ?? [])
        .map((stopType) => stopType.id)
        .filter((stopTypeId): stopTypeId is string => Boolean(stopTypeId?.trim())),
    [verticalTemplate]
  );
  const earnedExperiencePackDraft = useMemo<ExperiencePackDraft | null>(() => {
    if (!packSummary || !experiencePackTemplateId) return null;
    return buildExperiencePackDraft(packSummary, {
      templateId: experiencePackTemplateId,
      city: experiencePackLocation || null,
    });
  }, [experiencePackLocation, experiencePackTemplateId, packSummary]);
  const previewExperiencePackDraft = useMemo<ExperiencePackDraft | null>(() => {
    if (!experiencePackTemplateId) return null;
    return buildPreviewExperiencePackDraft({
      templateId: experiencePackTemplateId,
      city: experiencePackLocation || null,
      templateStopTypeIds,
    });
  }, [experiencePackLocation, experiencePackTemplateId, templateStopTypeIds]);
  const packMode: 'earned' | 'preview' = earnedExperiencePackDraft ? 'earned' : 'preview';
  const experiencePackDraft =
    packMode === 'earned' ? earnedExperiencePackDraft : previewExperiencePackDraft;
  const experienceSequenceLabels = useMemo(() => {
    if (!experiencePackDraft || (experiencePackDraft.commonStopSequence ?? []).length === 0) {
      return 'No common flow yet.';
    }
    const stopTypeById = new Map<string, string>();
    (verticalTemplate?.stopTypes ?? []).forEach((stopType) => {
      if (!stopType?.id) return;
      stopTypeById.set(stopType.id, stopType.label ?? stopType.id);
    });
    return (experiencePackDraft.commonStopSequence ?? [])
      .map((stopTypeId) => stopTypeById.get(stopTypeId) ?? stopTypeId)
      .join(' -> ');
  }, [experiencePackDraft, verticalTemplate]);
  useEffect(() => {
    setIsPackDraftDismissed(false);
    setPackCoachNudge(null);
  }, [experiencePackLocation, experiencePackTemplateId]);
  const shouldShowExperiencePack = Boolean(experiencePackTemplateId);
  const shouldRenderExperiencePackCard = shouldShowExperiencePack && !isPackDraftDismissed;
  const experiencePackCard = shouldRenderExperiencePackCard ? (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
      <h2 className="text-sm font-semibold text-slate-200">
        {packMode === 'preview'
          ? 'Experience Pack Draft (Preview)'
          : 'Experience pack draft'}
      </h2>
      {packMode === 'earned' && experiencePackLocationKnown ? (
        <p className="text-xs text-slate-400">
          Based on recently completed plans of this toolkit in {experiencePackLocation}.
        </p>
      ) : null}
      {packMode === 'preview' ? (
        <div className="space-y-1 text-xs text-slate-400">
          <p>Not enough completed plans yet to assemble a reliable pack.</p>
          <p>
            This starter structure is based on the toolkit template and will improve as more plans
            are completed.
          </p>
        </div>
      ) : null}
      {packStatus === 'loading' && packMode === 'preview' && experiencePackLocationKnown ? (
        <p className="text-xs text-slate-500">Loading...</p>
      ) : null}
      {!experiencePackDraft ? (
        <p className="text-xs text-slate-400">
          Pack draft is unavailable for this toolkit.
        </p>
      ) : (
        <div className="space-y-2 text-sm text-slate-300">
          <p>Usually {experiencePackDraft.typicalStopsCount ?? 0} stops</p>
          <p>Common flow: {experienceSequenceLabels}</p>
          {experiencePackDraft.typicalHourBin ? (
            <p>Often {experiencePackDraft.typicalHourBin}</p>
          ) : null}
          {packMode === 'earned' ? (
            <p className="text-xs text-slate-400">
              Based on {experiencePackDraft.evidence.distinctPlans} completed plan(s) in{' '}
              {experiencePackDraft.city ?? experiencePackLocation}.
            </p>
          ) : null}
          <ul className="space-y-1 text-xs text-slate-400">
            {experiencePackDraft.notes.map((note, index) => (
              <li key={`pack-note-${index}`}>• {note}</li>
            ))}
          </ul>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => applyExperiencePackDraft(experiencePackDraft)}
              disabled={isReadOnly}
              className={`${ctaClass('chip')} text-[11px] disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              Apply draft
            </button>
            <button
              type="button"
              onClick={() => setIsPackDraftDismissed(true)}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
            >
              Dismiss
            </button>
          </div>
          {experiencePackDraft.typicalHourBin ? (
            <p className="text-[11px] text-slate-500">
              Time guidance is optional and remains editable.
            </p>
          ) : null}
          {shouldLogVerticalDebug ? (
            <p className="text-[10px] text-slate-500">
              pack_mode: '{packMode}' | reason: '{packPreviewReason}' | flip_condition:
              'distinctCompletedPlans &gt;= 3 AND cityKnown'
            </p>
          ) : null}
        </div>
      )}
    </section>
  ) : null;
  if (process.env.NODE_ENV === 'development') {
    console.log('[create render]', {
      template_id: plan.template_id,
      selectedTemplateId,
      selectedTemplateName,
      verticalTemplateId: verticalTemplate?.id ?? null,
      verticalTemplateName: verticalTemplate?.name ?? null,
      planIdentity:
        plan.id ||
        JSON.stringify({
          title: plan.title ?? null,
          intent: plan.intent ?? null,
          stops: plan.stops?.length ?? 0,
        }),
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function loadExperiencePack() {
      if (!hasMounted) return;
      if (!experiencePackTemplateId) {
        if (!cancelled) {
          setPackSummary(null);
          setPackStatus('idle');
          setPackPreviewReason('no_data');
          if (shouldLogVerticalDebug) {
            console.log('[experience-pack:create]', {
              templateId: experiencePackTemplateId || null,
              derivedLocation: experiencePackLocation || null,
              minDistinctPlans: experiencePackMinDistinctPlans,
              evidence: null,
            });
          }
        }
        return;
      }
      if (!experiencePackLocationKnown) {
        if (!cancelled) {
          setPackSummary(null);
          setPackStatus('ready');
          setPackPreviewReason('no_city');
          if (shouldLogVerticalDebug) {
            console.log('[experience-pack:create]', {
              templateId: experiencePackTemplateId || null,
              derivedLocation: experiencePackLocation || null,
              minDistinctPlans: experiencePackMinDistinctPlans,
              evidence: null,
              mode: 'preview',
              reason: 'no_city',
            });
          }
        }
        return;
      }
      if (!cancelled) {
        setPackStatus('loading');
      }
      const earnedResult = await getExperiencePackSummary({
        templateId: experiencePackTemplateId,
        location: experiencePackLocation,
        dayOfWeek: experiencePackDayOfWeek,
        hourBin: experiencePackHourBin,
        limitPlans: 50,
        minDistinctPlans: experiencePackMinDistinctPlans,
      });
      if (cancelled) return;
      if (shouldLogVerticalDebug) {
        const evidence =
          earnedResult.data?.evidence
            ? {
                distinctPlans: earnedResult.data.evidence.count ?? null,
                totalSignals:
                  (earnedResult.data.evidence as { totalSignals?: number | null }).totalSignals ??
                  null,
              }
            : null;
        console.log('[experience-pack:create]', {
          templateId: experiencePackTemplateId || null,
          derivedLocation: experiencePackLocation || null,
          minDistinctPlans: experiencePackMinDistinctPlans,
          evidence,
        });
      }
      if (earnedResult.error) {
        setPackSummary(null);
        setPackStatus('error');
        setPackPreviewReason('no_data');
        return;
      }
      if (earnedResult.data) {
        setPackSummary(earnedResult.data);
        setPackStatus('ready');
        setPackPreviewReason('no_data');
        return;
      }

      const probeResult = await getExperiencePackSummary({
        templateId: experiencePackTemplateId,
        location: experiencePackLocation,
        dayOfWeek: experiencePackDayOfWeek,
        hourBin: experiencePackHourBin,
        limitPlans: 50,
        minDistinctPlans: 1,
      });
      if (cancelled) return;
      if (probeResult.error) {
        setPackSummary(null);
        setPackStatus('error');
        setPackPreviewReason('no_data');
        return;
      }
      const probeDistinctPlans = probeResult.data?.evidence?.count ?? 0;
      const reason =
        probeResult.data && probeDistinctPlans < experiencePackMinDistinctPlans
          ? 'below_threshold'
          : 'no_data';
      setPackSummary(null);
      setPackStatus('empty');
      setPackPreviewReason(reason);
    }
    void loadExperiencePack();
    return () => {
      cancelled = true;
    };
  }, [
    experiencePackLocation,
    experiencePackDayOfWeek,
    experiencePackHourBin,
    experiencePackTemplateId,
    experiencePackLocationKnown,
    experiencePackMinDistinctPlans,
    hasMounted,
    shouldLogVerticalDebug,
  ]);

  if (!hasMounted) {
    return null;
  }

  const onTrackLines =
    guidance.affirmations.length > 0
      ? guidance.affirmations
      : ['Open canvas — add a few stops and I’ll help shape the flow.'];
  const baseIdeaLines =
    guidance.suggestions.length > 0
      ? guidance.suggestions
      : ['I can suggest a flow once there are a few stops.'];
  const ideaLines = packCoachNudge ? [...baseIdeaLines, packCoachNudge] : baseIdeaLines;
  const summaryLine = onTrackLines[0] ?? ideaLines[0] ?? 'Your plan is ready to shape.';
  const warningCount = guidance.warnings.length;
  const warningLabel = warningCount === 1 ? '1 watch out' : `${warningCount} watch outs`;
  const guidanceBlock = (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
          <span>Coach: {summaryLine}</span>
          {warningCount > 0 ? (
            <span className="rounded-full border border-amber-400/60 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">
              {warningLabel}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setShowSuggestions((prev) => !prev)}
          className="text-[11px] text-slate-400 hover:text-slate-200"
        >
          {showSuggestions ? 'Hide' : 'Show'}
        </button>
      </div>
      {showSuggestions ? (
        <div className="space-y-3">
          <div className="space-y-1 text-[11px] text-slate-300">
            <div className="font-semibold text-slate-200">✅ On track</div>
            <ul className="space-y-1 text-[11px] text-slate-300">
              {onTrackLines.map((line, index) => (
                <li key={`guidance-affirmation-${index}`}>• {line}</li>
              ))}
            </ul>
          </div>
          {guidance.warnings.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-amber-200">⚠️ Watch outs</div>
              <ul className="space-y-1 text-[11px] text-amber-200">
                {guidance.warnings.map((warning, index) => (
                  <li key={`guidance-warning-${index}`}>• {warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-slate-200">💡 Ideas</div>
            <ul className="space-y-1 text-[11px] text-slate-300">
              {ideaLines.map((tip, index) => (
                <li key={`guidance-suggestion-${index}`}>• {tip}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );

  if (isRoleLoading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <header className="space-y-2">
            {backAction ? (
              <Link
                href={backAction.href}
                scroll={false}
                onClick={backAction.onClick}
                className="inline-flex items-center gap-1 rounded-full border border-slate-700/80 bg-slate-900/70 px-2 py-1 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-slate-50"
              >
                {backAction.label}
              </Link>
            ) : null}
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold">{readOnlyTitle}</h1>
              {templateBadge ? (
                <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[11px] text-slate-200">
                  {templateBadge}
                </span>
              ) : null}
            </div>
            <div className="text-[11px] text-slate-400">Mode: {uiModeLabel}</div>
            {sourceLabel ? (
              <div className="text-[11px] text-slate-500">{sourceLabel}</div>
            ) : null}
            {templateHelper ? (
              <p className="text-xs text-slate-400">{templateHelper}</p>
            ) : null}
            {districtIndicator}
            <p className="text-xs text-slate-500">From: {originLabel}</p>
            {discoveryContextLine ? (
              <p className="text-xs text-slate-500">{discoveryContextLine}</p>
            ) : null}
          </header>
          <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200">
            Checking access...
          </div>
        </div>
      </main>
    );
  }

  if (roleReadOnly) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-8">
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold">{readOnlyTitle}</h1>
            <div className="text-[11px] text-slate-400">Mode: {uiModeLabel}</div>
            {sourceLabel ? (
              <div className="text-[11px] text-slate-500">{sourceLabel}</div>
            ) : null}
            {templateBadge ? (
              <span className="inline-flex w-fit rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[11px] text-slate-200">
                {templateBadge}
              </span>
            ) : null}
            {templateHelper ? (
              <p className="text-xs text-slate-400">{templateHelper}</p>
            ) : null}
            {districtIndicator}
            <p className="text-xs text-slate-500">From: {originLabel}</p>
            {discoveryContextLine ? (
              <p className="text-xs text-slate-500">{discoveryContextLine}</p>
            ) : null}
          </header>

          {invalidFromNotice}

          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100 space-y-2">
            <div>Read-only mode. Editing is disabled.</div>
            {readOnlyActionStrip}
            {showReadOnlyHint ? (
              <div className="text-[11px] text-amber-100/90">
                Read-only here. Use {openEditorAction.label} to edit.
              </div>
            ) : null}
          </div>

          <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 space-y-1">
            <div className="text-slate-300">Read-only preview</div>
            <div className="font-semibold text-slate-100">Read-only access</div>
            <p className="text-slate-400">Ask the owner for edit access.</p>
            {roleError ? (
              <p className="text-[11px] text-slate-500">
                We couldn&apos;t verify edit access. Viewing as read-only.
              </p>
            ) : null}
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-200">Intent</h2>
            <p className="text-sm text-slate-200">{readOnlyIntent}</p>
          </section>

          {guidanceBlock}

          {experiencePackCard}

          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-200">Plan stops</h2>
            {readOnlyStops.length === 0 ? (
              <p className="text-sm text-slate-400">No stops yet.</p>
            ) : (
              <ol className="space-y-4">
                {readOnlyStops.map((stop, index) => (
                  <li
                    key={stop.id}
                    className={`rounded-lg border border-slate-800 px-3 py-3 space-y-2 ${
                      stop.role === 'anchor'
                        ? 'bg-slate-900/80 border-sky-700/60'
                        : 'bg-slate-900/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs uppercase tracking-wide text-slate-400">
                          Stop {index + 1}
                        </span>
                        <StopTypeBadge
                          label={resolveStopTypeLabel(
                            verticalTemplate,
                            stop,
                            'Unclassified'
                          )}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-slate-100">{stop.name}</div>
                      {stop.location ? (
                        <div className="text-xs text-slate-400">Location: {stop.location}</div>
                      ) : null}
                      {stop.duration ? (
                        <div className="text-xs text-slate-400">Duration: {stop.duration}</div>
                      ) : null}
                      {stop.optionality ? (
                        <div className="text-xs text-slate-400">
                          Flexibility: {stop.optionality}
                        </div>
                      ) : null}
                      {stop.notes ? (
                        <div className="text-xs text-slate-400">Notes: {stop.notes}</div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </main>
    );
  }

  if (isTemplateReadOnly) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-8">
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold">{readOnlyTitle}</h1>
            <div className="text-[11px] text-slate-400">Mode: {uiModeLabel}</div>
            {sourceLabel ? (
              <div className="text-[11px] text-slate-500">{sourceLabel}</div>
            ) : null}
            {templateBadge ? (
              <span className="inline-flex w-fit rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[11px] text-slate-200">
                {templateBadge}
              </span>
            ) : null}
            {templateHelper ? (
              <p className="text-xs text-slate-400">{templateHelper}</p>
            ) : null}
            {districtIndicator}
            <p className="text-xs text-slate-500">From: {originLabel}</p>
            {discoveryContextLine ? (
              <p className="text-xs text-slate-500">{discoveryContextLine}</p>
            ) : null}
          </header>

          {invalidFromNotice}

          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100 space-y-2">
            <div>Read-only mode. Editing is disabled.</div>
            {readOnlyActionStrip}
            {showReadOnlyHint ? (
              <div className="text-[11px] text-amber-100/90">
                Read-only here. Use {openEditorAction.label} to edit.
              </div>
            ) : null}
          </div>

          <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 space-y-1">
            <div className="text-slate-300">Read-only preview</div>
            <div className="font-semibold text-slate-100">This is a template</div>
            <p className="text-slate-400">Start from this template to author a plan.</p>
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-200">Intent</h2>
            <p className="text-sm text-slate-200">{readOnlyIntent}</p>
          </section>

          {guidanceBlock}

          {experiencePackCard}

          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-200">Plan stops</h2>
            {readOnlyStops.length === 0 ? (
              <p className="text-sm text-slate-400">No stops yet.</p>
            ) : (
              <ol className="space-y-4">
                {readOnlyStops.map((stop, index) => (
                  <li
                    key={stop.id}
                    className={`rounded-lg border border-slate-800 px-3 py-3 space-y-2 ${
                      stop.role === 'anchor'
                        ? 'bg-slate-900/80 border-sky-700/60'
                        : 'bg-slate-900/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs uppercase tracking-wide text-slate-400">
                          Stop {index + 1}
                        </span>
                        <StopTypeBadge
                          label={resolveStopTypeLabel(
                            verticalTemplate,
                            stop,
                            'Unclassified'
                          )}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-slate-100">{stop.name}</div>
                      {stop.location ? (
                        <div className="text-xs text-slate-400">Location: {stop.location}</div>
                      ) : null}
                      {stop.duration ? (
                        <div className="text-xs text-slate-400">Duration: {stop.duration}</div>
                      ) : null}
                      {stop.optionality ? (
                        <div className="text-xs text-slate-400">
                          Flexibility: {stop.optionality}
                        </div>
                      ) : null}
                      {stop.notes ? (
                        <div className="text-xs text-slate-400">Notes: {stop.notes}</div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </main>
    );
  }

  const hasAnchor = plan.stops.some((stop) => stop.role === 'anchor');

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <header className="space-y-1">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
              Plan editor
            </p>
            <p className="text-[11px] text-slate-400">Draft / private</p>
            <p className="text-xs text-slate-400">
              You&apos;re planning now. Drafts stay private unless you choose to share.
            </p>
          </div>
          <h1 className="text-2xl font-semibold">Create a plan</h1>
          <div className="text-[11px] text-slate-400">Mode: {uiModeLabel}</div>
          {sourceLabel ? (
            <div className="text-[11px] text-slate-500">{sourceLabel}</div>
          ) : null}
          {templateBadge ? (
            <span className="inline-flex w-fit rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[11px] text-slate-200">
              {templateBadge}
            </span>
          ) : null}
          <p className="text-sm text-slate-400">
            Add a few stops, then save when it feels right.
          </p>
          {districtIndicator}
          <p className="text-xs text-slate-500">From: {originLabel}</p>
          {templateHelper ? <p className="text-xs text-slate-400">{templateHelper}</p> : null}
          {showCopyNotice ? (
            <p className="text-xs text-slate-400">
              You&apos;re editing your version of this plan.
            </p>
          ) : null}
          {discoveryContextLine ? (
            <p className="text-xs text-slate-500">{discoveryContextLine}</p>
          ) : null}
          {!fromEncoded ? (
            <p className="text-xs text-slate-500">You&apos;re editing your Waypoint.</p>
          ) : null}
          {!isReadOnly && backAction && !(fromEncoded && canEdit) ? (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={backAction.href}
                scroll={false}
                onClick={backAction.onClick}
                className="text-xs font-semibold text-slate-300 hover:text-slate-100"
              >
                {backAction.label}
              </Link>
              <span className="text-[11px] text-slate-500">Returns to browsing.</span>
            </div>
          ) : null}
        </header>

        {invalidFromNotice}

        <VerticalIdentityHeader verticalTemplate={verticalTemplate} />

        {guidanceBlock}

        {experiencePackCard}

        {isReadOnly ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100 space-y-2">
            <div>Read-only mode. Editing is disabled.</div>
            {readOnlyActionStrip}
            {showReadOnlyHint ? (
              <div className="text-[11px] text-amber-100/90">
                Read-only here. Use {openEditorAction.label} to edit.
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="relative">
          {isReadOnly ? (
            <div
              className="absolute inset-0 z-10"
              onClick={handleReadOnlyHint}
              aria-hidden="true"
            />
          ) : null}

        {showTemplateConfirmation && canEdit ? (
          <div className="rounded-md border border-emerald-700/60 bg-emerald-900/40 px-3 py-3 text-xs text-emerald-100 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-emerald-50">Template saved</p>
                <p className="text-[11px] text-emerald-100/80">
                  Pick your next step.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTemplateConfirmation(false)}
                className="text-[11px] text-emerald-100/70 hover:text-emerald-50"
              >
                Dismiss
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTemplateConfirmation(false)}
                className={`${ctaClass('primary')} text-[11px]`}
              >
                Keep editing
              </button>
              {templatePreviewHref ? (
                <Link href={templatePreviewHref} className={`${ctaClass('chip')} text-[11px]`}>
                  View template
                </Link>
              ) : null}
              {SHARE_ENABLED ? (
                <button
                  type="button"
                  onClick={handleCopyShare}
                  className={`${ctaClass('chip')} text-[11px]`}
                  disabled={!encodedFullUrl}
                >
                  Copy link
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {fromEncoded && canEdit ? (
          <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                You&apos;re editing your version of{' '}
                <span className="font-semibold text-slate-50">
                  {sourceTitle ?? 'Unknown plan'}
                </span>
                . Changes here won&apos;t affect the original.
              </span>
              <div className="flex items-center gap-3 text-[11px]">
                <button
                  type="button"
                  onClick={handleReturnToOriginal}
                  className="text-slate-300 hover:text-slate-100"
                >
                  Back to original
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-200">Start from...</h2>
            <p className="text-[11px] text-slate-500">
              {waysToBeginContext ?? 'Choose a starting point. You can change anything.'}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-col gap-3 sm:max-w-xs">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Toolkit
                </label>
                <select
                  value={selectedToolkitId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedToolkitId(nextId);
                    applyPlanUpdate('template:vertical_toolkit', (prev) =>
                      setPlanTemplateId(prev, nextId === 'generic' ? undefined : nextId)
                    );
                  }}
                  disabled={isReadOnly}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {toolkitOptions.map((toolkit) => (
                    <option key={toolkit.id} value={toolkit.id}>
                      {toolkit.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">Sets stop types + guidance.</p>
              </div>

              {selectedToolkitId === 'idea-date' || selectedPackId ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Starter pack
                    </label>
                    <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-400">
                      Optional
                    </span>
                  </div>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedPackId(nextId);
                      handleTemplatePresetSelection({
                        templateId: nextId,
                        templateName: getTemplateV2ById(nextId)?.name,
                        applyToPlan: false,
                        allowVertical: true,
                        source: 'dropdown',
                      });
                    }}
                    disabled={isReadOnly}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {TEMPLATES_V2.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500">Prefills a draft (optional).</p>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const hasOriginSource =
                    initialOrigin?.entityId ||
                    initialOrigin?.entityName ||
                    initialOrigin?.query ||
                    initialOrigin?.mood ||
                    initialOrigin?.source;
                  const origin =
                    initialOrigin && hasOriginSource
                      ? buildOriginFromContext({
                          entityId: initialOrigin.entityId,
                          label: initialOrigin.entityName,
                          query: initialOrigin.query,
                          mood: initialOrigin.mood,
                          source:
                            initialOrigin.source === 'home_search'
                              ? 'search'
                              : (initialOrigin.source as PlanOriginKind | undefined),
                        })
                      : buildOriginFromContext(discoveryContext);
                    const next = createTemplateSeedPlan({
                      templateId: selectedTemplateId,
                      origin,
                      baseTitle: 'New plan',
                      baseIntent: 'What do we want to accomplish?',
                      baseAudience: 'me-and-friends',
                      applyVerticalPreset: false,
                    });
                    applyPlanUpdate('template:blank', () => next);
                  }}
                disabled={isReadOnly}
                className={`${ctaClass(
                  'chip'
                )} min-w-[220px] text-left text-xs bg-slate-900/80 border-slate-600 disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <div className="font-semibold text-slate-100">Start from scratch</div>
                <p className="text-[11px] text-slate-400">
                  No guidance, just the default blank plan.
                </p>
              </button>
              {PLAN_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    handleTemplatePresetSelection({
                      templateId: tpl.id,
                      templateName: tpl.label,
                      applyToPlan: true,
                      allowVertical: true,
                      source: 'button',
                    });
                  }}
                  disabled={isReadOnly}
                  className={`${ctaClass(
                    'chip'
                  )} min-w-[200px] text-left text-xs disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <div className="font-semibold text-slate-100">{tpl.label}</div>
                  {tpl.description ? (
                    <p className="text-[11px] text-slate-400">{tpl.description}</p>
                  ) : null}
                </button>
              ))}
            </div>
            {PLAN_TEMPLATES.length === 0 ? (
              <div className="text-[11px] text-slate-500">
                No templates yet — save a plan as a template to reuse later.
              </div>
            ) : null}
          </div>

          {!showVariations && fromEncoded ? (
            <div className="text-[11px] text-slate-500">
              Starter ideas will appear here when available.
            </div>
          ) : null}

          {showVariations && variationOptions.length > 0 && (
            <div className="space-y-2 rounded-md border border-slate-800 bg-slate-900/70 px-3 py-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-300">Starter ideas</p>
                <button
                  type="button"
                  onClick={handleDismissVariations}
                  className={`${ctaClass('chip')} text-[11px]`}
                >
                  Dismiss
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {variationOptions.map((option) => (
                  <div
                    key={option.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2 space-y-2"
                  >
                    <p className="text-sm font-semibold text-slate-100">{option.label}</p>
                    <p className="text-[11px] text-slate-400">{option.detail}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleUseVariation(option)}
                        disabled={isReadOnly}
                        className={`${ctaClass(
                          'primary'
                        )} text-[11px] disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        Start from this idea
                      </button>
                      <button
                        type="button"
                        onClick={handleDismissVariations}
                        className={`${ctaClass('chip')} text-[11px]`}
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm text-slate-200" htmlFor="plan-title">
              Title
            </label>
            <input
              id="plan-title"
              type="text"
              value={plan.title}
              readOnly={isReadOnly}
              onChange={(e) =>
                applyPlanUpdate('field:title', (prev) => ({
                  ...prev,
                  title: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-slate-200" htmlFor="plan-intent">
              Intent
            </label>
            <p className="text-xs text-slate-500">One clear sentence about what this plan is for.</p>
            <input
              id="plan-intent"
              type="text"
              value={plan.intent}
              readOnly={isReadOnly}
              onChange={(e) =>
                applyPlanUpdate('field:intent', (prev) => ({
                  ...prev,
                  intent: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-slate-200" htmlFor="plan-audience">
              Audience
            </label>
            <input
              id="plan-audience"
              type="text"
              value={plan.audience}
              readOnly={isReadOnly}
              onChange={(e) =>
                applyPlanUpdate('field:audience', (prev) => ({
                  ...prev,
                  audience: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Plan stops</h2>
            <button
              type="button"
              onClick={addStop}
              disabled={isReadOnly}
              className={`rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-750 ${
                isReadOnly ? 'opacity-60 cursor-not-allowed' : ''
              }`}
            >
              Add stop
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Anchor is the must-do stop; Support fills in around it. Optional stops are nice-to-haves.
          </p>
          {!hasAnchor && plan.stops.length > 0 && (
            <p className="text-xs text-amber-300">
              Add one anchor: the main stop everything else is planned around.
            </p>
          )}

          {plan.stops.length === 0 ? (
            <p className="text-sm text-slate-400">No stops yet. Add one to get started.</p>
          ) : (
            <ol className="space-y-4">
              {plan.stops.map((stop, index) => (
                <li
                  key={stop.id}
                  className={`rounded-lg border border-slate-800 px-3 py-3 space-y-3 ${
                    stop.role === 'anchor' ? 'bg-slate-900/80 border-sky-700/60' : 'bg-slate-900/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        Stop {index + 1}
                      </span>
                      <StopTypeBadge
                        label={resolveStopTypeLabel(
                          verticalTemplate,
                          stop,
                          'Unclassified'
                        )}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeStop(stop.id)}
                      disabled={isReadOnly}
                      className={`text-[11px] text-rose-300 hover:text-rose-100 ${
                        isReadOnly ? 'opacity-60 cursor-not-allowed' : ''
                      }`}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="flex gap-2 text-[11px] text-slate-200">
                    <button
                      type="button"
                      onClick={() => moveStopUp(index)}
                      disabled={isReadOnly || index === 0}
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 disabled:opacity-40"
                    >
                      ? Move up
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStopDown(index)}
                      disabled={isReadOnly || index === plan.stops.length - 1}
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 disabled:opacity-40"
                    >
                      ? Move down
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm text-slate-200" htmlFor={`stop-name-${stop.id}`}>
                        Name
                      </label>
                      <input
                        id={`stop-name-${stop.id}`}
                        type="text"
                        value={stop.name}
                        readOnly={isReadOnly}
                        onChange={(e) =>
                          updateStop(stop.id, (prev) => ({ ...prev, name: e.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-sm text-slate-200" htmlFor={`stop-location-${stop.id}`}>
                        Location
                      </label>
                      <input
                        id={`stop-location-${stop.id}`}
                        type="text"
                        value={stop.location ?? ''}
                        readOnly={isReadOnly}
                        onChange={(e) =>
                          updateStop(stop.id, (prev) => {
                            const raw = e.target.value;
                            const trimmed = raw.trim();
                            return { ...prev, location: trimmed === '' ? undefined : raw };
                          })
                        }
                        placeholder="e.g. 123 Main St, San Jose or Dolores Park"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-sm text-slate-200" htmlFor={`stop-duration-${stop.id}`}>
                        Duration (optional)
                      </label>
                      <input
                        id={`stop-duration-${stop.id}`}
                        type="text"
                        value={stop.duration ?? ''}
                        readOnly={isReadOnly}
                        onChange={(e) =>
                          updateStop(stop.id, (prev) => ({ ...prev, duration: e.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm text-slate-200" htmlFor={`stop-role-${stop.id}`}>
                        Role
                      </label>
                      <p className="text-[11px] text-slate-500">
                        How this stop supports the plan: Anchor = must-hit, Support = nice-to-have.
                      </p>
                      <select
                        id={`stop-role-${stop.id}`}
                        value={stop.role}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updateStop(stop.id, (prev) => {
                            const nextRole = e.target.value as Stop['role'];
                            const canSetStopType =
                              verticalTemplate?.stopTypes.some(
                                (stopType) => stopType.id === nextRole
                              ) ?? false;
                            return {
                              ...prev,
                              role: nextRole,
                              stop_type_id: canSetStopType ? nextRole : prev.stop_type_id,
                            };
                          })
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      >
                        <option value="anchor">anchor</option>
                        <option value="support">support</option>
                        <option value="optional">optional</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label
                        className="text-sm text-slate-200"
                        htmlFor={`stop-optionality-${stop.id}`}
                      >
                        Flexibility
                      </label>
                      <p className="text-[11px] text-slate-500">
                        How easy this stop is to swap or skip if needed.
                      </p>
                      <select
                        id={`stop-optionality-${stop.id}`}
                        value={stop.optionality}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updateStop(stop.id, (prev) => ({
                            ...prev,
                            optionality: e.target.value as Stop['optionality'],
                          }))
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      >
                        <option value="required">required</option>
                        <option value="flexible">flexible</option>
                      <option value="fallback">fallback</option>
                    </select>
                    <p className="text-[11px] text-slate-500">
                      Your backup move if this stop doesn�t work out.
                    </p>
                  </div>
                </div>

                  <div className="space-y-1">
                    <label className="text-sm text-slate-200" htmlFor={`stop-notes-${stop.id}`}>
                      Notes (optional)
                    </label>
                    <textarea
                      id={`stop-notes-${stop.id}`}
                      value={stop.notes ?? ''}
                      readOnly={isReadOnly}
                      onChange={(e) =>
                        updateStop(stop.id, (prev) => ({ ...prev, notes: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      rows={3}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
          {plan.stops.length > 0 ? (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={addStop}
                disabled={isReadOnly}
                className={`${ctaClass(
                  'chip'
                )} text-[11px] disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                Add another stop
              </button>
            </div>
          ) : null}
        </section>

        <section className="space-y-3">
          <div className="space-y-2">
            {!isReadOnly && !isCommitted && (
              <div className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[11px] text-slate-300">
                Draft (private)
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {!isReadOnly ? (
                <button
                  type="button"
                  onClick={() => void handleCommitPlan()}
                  disabled={isReadOnly || isCommitted || commitStatus === 'saving'}
                  className={`${ctaClass(
                    isTemplatePrimary ? 'chip' : 'primary'
                  )} text-[11px] disabled:opacity-60`}
                >
                  {isCommitted ? 'Saved' : 'Save plan'}
                </button>
              ) : null}
              {!isReadOnly && userId ? (
                <button
                  type="button"
                  onClick={() => void handleConvertToTemplate()}
                  disabled={isReadOnly || commitStatus === 'saving'}
                  className={`${ctaClass(
                    isTemplatePrimary ? 'primary' : 'chip'
                  )} text-[11px] disabled:opacity-60`}
                >
                  {isTemplatePlan ? 'Update template' : 'Save as template'}
                </button>
              ) : null}
              {SHARE_ENABLED ? (
                <button
                  type="button"
                  onClick={handleOpenShare}
                  className={`${ctaClass('chip')} text-[11px]`}
                  disabled={!encodedPath}
                >
                  Preview link
                </button>
              ) : null}
              {SHARE_ENABLED ? (
                <button
                  type="button"
                  onClick={handleCopyShare}
                  className={`${ctaClass(isReadOnly ? 'primary' : 'chip')} text-[11px]`}
                  disabled={!encodedFullUrl}
                >
                  Copy link
                </button>
              ) : null}
              {SHARE_ENABLED && hasShared ? (
                <span className="inline-flex items-center rounded-full border border-emerald-500/60 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                  Shared
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              {commitStatus === 'error' && <span className="text-rose-200">Save failed. Try again.</span>}
              {commitStatus === 'done' && <span className="text-emerald-200">Saved.</span>}
              {cloudCommitError && <span className="text-amber-200">{cloudCommitError}</span>}
              {shareStatus === 'copied' && <span className="text-emerald-200">Link copied.</span>}
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Save creates a Waypoint you can reopen later.
          </p>
          <p className="text-xs text-slate-400">
            Saved plans can be edited anytime.
          </p>
          <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-3 space-y-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Presentation</div>
            <div className="grid gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-200" htmlFor="presentation-presentedBy">
                  Presented by
                </label>
                <input
                  id="presentation-presentedBy"
                  type="text"
                  value={plan.presentation?.presentedBy ?? ''}
                  readOnly={isReadOnly}
                  onChange={(e) => updatePresentation({ presentedBy: e.target.value })}
                  placeholder="Your name or org"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                />
                <p className="text-[11px] text-slate-500">Shown on read-only views.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200" htmlFor="presentation-logoUrl">
                  Logo image URL
                </label>
                <input
                  id="presentation-logoUrl"
                  type="text"
                  value={plan.presentation?.logoUrl ?? ''}
                  readOnly={isReadOnly}
                  onChange={(e) => updatePresentation({ logoUrl: e.target.value })}
                  placeholder="https://example.com/logo.png"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                />
                <p className="text-[11px] text-slate-500">
                  Must be a direct image link (png/svg/jpg). Website URLs won�t display.
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200" htmlFor="presentation-accent">
                  Accent{plan.presentation?.accent ? `: ${plan.presentation.accent}` : ''}
                </label>
                <select
                  id="presentation-accent"
                  value={plan.presentation?.accent ?? ''}
                  disabled={isReadOnly}
                  onChange={(e) =>
                    updatePresentation({
                      accent: e.target.value ? (e.target.value as PresentationAccent) : undefined,
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                >
                  <option value="">No accent</option>
                  {ACCENT_OPTIONS.map((accent) => (
                    <option key={accent} value={accent}>
                      {accent}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">Subtle highlight color for read-only views.</p>
              </div>
            </div>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs space-y-1">
            {validation.issues.length === 0 ? (
              <div className="text-emerald-200 font-semibold">Plan ready</div>
            ) : (
              <>
                <div className="text-amber-200 font-semibold">
                  {validation.issues.length} thing{validation.issues.length === 1 ? '' : 's'} to
                  consider
                </div>
                <ul className="space-y-1 text-slate-200">
                  {validation.issues.slice(0, 2).map((issue) => (
                    <li key={issue.code}>
                      � {issue.message}
                      {issue.path ? ` (${issue.path})` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
        </div>
      </div>
    </main>
  );
}




