type PlanLike = {
  stops?: unknown[];
  whenText?: unknown;
  date?: unknown;
  time?: unknown;
  constraints?: {
    timeWindow?: unknown;
    startAt?: unknown;
    endAt?: unknown;
  };
};

type StopTypeLike = {
  id: string;
  label: string;
};

type EditorConstraintLike =
  | { kind: 'recommend_at_least_one'; stopTypeId: string }
  | { kind: 'recommend_order'; orderedStopTypeIds: string[] }
  | { kind: 'warn_if_missing_required_field'; stopTypeId: string; fieldKey: string }
  | { kind: 'warn_if_too_many'; stopTypeId: string; max: number };

type TemplateLike = {
  name: string;
  stopTypes: StopTypeLike[];
  editorGuidance: {
    suggestedOrder: string[];
    optionalStops: string[];
    constraints: EditorConstraintLike[];
  };
};

type GuidanceResult = {
  affirmations: string[];
  warnings: string[];
  suggestions: string[];
  hasTemplate: boolean;
  templateName?: string;
};

function getStopTypeId(stop: unknown): string | undefined {
  if (!stop || typeof stop !== 'object') return undefined;
  const record = stop as {
    type?: unknown;
    stopTypeId?: unknown;
    stop_type_id?: unknown;
  };
  const candidate =
    (typeof record.stopTypeId === 'string' && record.stopTypeId.trim()) ||
    (typeof record.stop_type_id === 'string' && record.stop_type_id.trim()) ||
    (typeof record.type === 'string' && record.type.trim()) ||
    '';
  return candidate || undefined;
}

function hasStopField(stop: unknown, fieldKey: string): boolean {
  if (!stop || typeof stop !== 'object') return false;
  const record = stop as Record<string, unknown>;
  if (!(fieldKey in record)) return false;
  const value = record[fieldKey];
  if (typeof value === 'string') return value.trim().length > 0;
  return value != null;
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function getDateAnchorStatus(planLike?: PlanLike | null): {
  hasDateField: boolean;
  hasDateValue: boolean;
} {
  if (!planLike || typeof planLike !== 'object') {
    return { hasDateField: false, hasDateValue: false };
  }

  const record = planLike as Record<string, unknown>;
  const constraints =
    record.constraints && typeof record.constraints === 'object'
      ? (record.constraints as Record<string, unknown>)
      : null;

  const hasDateField =
    Object.prototype.hasOwnProperty.call(record, 'whenText') ||
    Object.prototype.hasOwnProperty.call(record, 'date') ||
    Object.prototype.hasOwnProperty.call(record, 'time') ||
    (constraints
      ? Object.prototype.hasOwnProperty.call(constraints, 'timeWindow') ||
        Object.prototype.hasOwnProperty.call(constraints, 'startAt') ||
        Object.prototype.hasOwnProperty.call(constraints, 'endAt')
      : false);

  const candidates = [
    record.whenText,
    record.date,
    record.time,
    constraints?.timeWindow,
    constraints?.startAt,
    constraints?.endAt,
  ];
  const hasDateValue = candidates.some((value) => Boolean(readString(value)));

  return { hasDateField, hasDateValue };
}

export function buildVerticalGuidance(input: {
  template?: TemplateLike;
  planLike?: PlanLike | null;
}): GuidanceResult {
  const template = input.template;
  const stops = input.planLike?.stops ?? [];
  const dateAnchor = getDateAnchorStatus(input.planLike);
  const dateWarningLine = '⚠️ Pick a date/time so the plan has an anchor.';
  const dateSuggestionLine = 'Set a date/time early so the plan has an anchor.';
  const exploreSuggestionLine =
    '💡 Use Explore to collect options, then add the winners as Stops.';

  if (!template) {
    const warnings: string[] = [];
    const suggestions: string[] = [
      'No vertical guidance applied yet. Pick a toolkit when you want focused coaching.',
    ];

    if (dateAnchor.hasDateField && !dateAnchor.hasDateValue) {
      warnings.push(dateWarningLine);
    } else if (!dateAnchor.hasDateField) {
      suggestions.push(dateSuggestionLine);
    }

    suggestions.push(exploreSuggestionLine);

    return {
      affirmations: [],
      warnings,
      suggestions,
      hasTemplate: false,
    };
  }

  const stopTypeLabels = new Map(
    template.stopTypes.map((stopType) => [stopType.id, stopType.label])
  );
  const typedStops = Array.isArray(stops) ? stops : [];
  const stopTypeCounts = new Map<string, number>();
  const stopsByType = new Map<string, unknown[]>();

  typedStops.forEach((stop) => {
    const stopTypeId = getStopTypeId(stop);
    if (!stopTypeId) return;
    stopTypeCounts.set(stopTypeId, (stopTypeCounts.get(stopTypeId) ?? 0) + 1);
    const bucket = stopsByType.get(stopTypeId) ?? [];
    bucket.push(stop);
    stopsByType.set(stopTypeId, bucket);
  });

  const affirmations: string[] = [];
  const suggestions: string[] = [];
  const warnings: string[] = [];
  const pushed = new Set<string>();
  const pushUnique = (bucket: string[], line: string) => {
    if (pushed.has(line)) return;
    pushed.add(line);
    bucket.push(line);
  };
  const humanizeFieldKey = (value: string) =>
    value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const suggestedOrderLabels = template.editorGuidance.suggestedOrder
    .map((id) => stopTypeLabels.get(id))
    .filter(Boolean) as string[];

  if (dateAnchor.hasDateField && !dateAnchor.hasDateValue) {
    warnings.push(dateWarningLine);
  } else if (!dateAnchor.hasDateField) {
    pushUnique(suggestions, dateSuggestionLine);
  }

  pushUnique(suggestions, exploreSuggestionLine);

  if (suggestedOrderLabels.length > 0) {
    pushUnique(
      suggestions,
      `Try this order: ${suggestedOrderLabels.join(' → ')} so the energy builds naturally.`
    );
  }

  const optionalLabels = template.editorGuidance.optionalStops
    .map((id) => stopTypeLabels.get(id))
    .filter(Boolean) as string[];
  if (optionalLabels.length > 0) {
    pushUnique(
      suggestions,
      `Optional add-ons: ${optionalLabels.join(', ')} if you have time for extra variety.`
    );
  }

  template.editorGuidance.constraints.forEach((constraint) => {
    if (constraint.kind === 'recommend_order') {
      const labels = constraint.orderedStopTypeIds
        .map((id) => stopTypeLabels.get(id))
        .filter(Boolean) as string[];
      if (labels.length > 0) {
        pushUnique(
          suggestions,
          `Try this order: ${labels.join(' → ')} so the flow stays smooth.`
        );
      }
      return;
    }
    if (constraint.kind === 'recommend_at_least_one') {
      const label = stopTypeLabels.get(constraint.stopTypeId) ?? 'this stop type';
      const count = stopTypeCounts.get(constraint.stopTypeId) ?? 0;
      if (count === 0) {
        warnings.push(`Add at least one ${label} so the plan has a clear anchor.`);
      }
      return;
    }
    if (constraint.kind === 'warn_if_too_many') {
      const count = stopTypeCounts.get(constraint.stopTypeId);
      if (typeof count === 'number' && count > constraint.max) {
        const label = stopTypeLabels.get(constraint.stopTypeId) ?? 'this stop type';
        warnings.push(
          `You have ${count} ${label} stops. Keeping it to about ${constraint.max} will make the plan feel focused.`
        );
      }
      return;
    }
    if (constraint.kind === 'warn_if_missing_required_field') {
      const stopsForType = stopsByType.get(constraint.stopTypeId);
      if (!stopsForType || stopsForType.length === 0) return;
      const missing = stopsForType.some((stop) => !hasStopField(stop, constraint.fieldKey));
      if (missing) {
        const label = stopTypeLabels.get(constraint.stopTypeId) ?? 'this stop type';
        const fieldLabel = humanizeFieldKey(constraint.fieldKey);
        warnings.push(
          `Add ${fieldLabel} for each ${label} stop so everyone knows the essentials.`
        );
      }
    }
  });

  if (warnings.length === 0) {
    affirmations.push(`On track — this plan fits the ${template.name} toolkit.`);
  }

  if (affirmations.length === 0 && suggestions.length === 0) {
    suggestions.push('Add a few stops and I can shape the flow for you.');
  } else if (suggestions.length === 0) {
    suggestions.push('Once the watch outs are handled, I can suggest a flow.');
  }

  return {
    affirmations,
    warnings,
    suggestions,
    hasTemplate: true,
    templateName: template.name,
  };
}
