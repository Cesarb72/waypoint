export type StopRole = 'anchor' | 'support' | 'optional';

export type Optionality = 'required' | 'flexible' | 'fallback';

export type ShareMode = 'link' | 'qr' | 'embed';
export type PlanState = 'DRAFT' | 'PUBLISHED';

export interface Constraints {
  timeWindow?: string;
  budgetRange?: string;
  mobility?: string;
  energyLevel?: string;
  accessibility?: string;
}

export interface Signals {
  vibe?: string;
  flexibility?: string;
  commitment?: string;
}

export interface Context {
  occasion?: string;
  season?: string;
  localNote?: string;
  district?: {
    id: string;
    slug: string;
    name: string;
    cityId?: string;
    citySlug?: string;
    cityName?: string;
    label: string;
  };
}

export interface Branding {
  name?: string;
  logoUrl?: string;
  accentColor?: string;
}

export type PresentationAccent = 'slate' | 'blue' | 'emerald' | 'violet' | 'amber';

export interface Presentation {
  templateType?: string;
  branding?: Branding;
  shareModes?: ShareMode[];
  presentedBy?: string;
  logoUrl?: string;
  accent?: PresentationAccent;
}

export interface Metadata {
  createdBy?: string;
  createdFor?: string;
  createdAt?: string;
  lastUpdated?: string;
}

export type PlanOriginKind = 'search' | 'mood' | 'surprise' | 'template' | 'toolkit';

export interface PlanOrigin {
  kind: PlanOriginKind;
  query?: string;
  mood?: string;
  entityId?: string;
  label?: string;
  source?: string;
}

export interface PlanMeta {
  origin?: PlanOrigin;
}

export type TemplateMeta = {
  title: string;
  intent?: string;
  audience?: string;
  tags?: string[];
  packId?: string;
  packTitle?: string;
  packDescription?: string;
  packTags?: string[];
};

export type CreatedFrom = {
  kind: 'template';
  templateId: string;
  templateTitle: string;
  packId?: string;
};

// The doc references Location and Duration but does not define their shapes; keep them flexible.
export type Location = string;
export type Duration = string;

export interface Stop {
  id: string;
  name: string;
  role: StopRole;
  optionality: Optionality;
  location?: string;
  duration?: Duration;
  notes?: string;
}

export interface PlanObject {
  id: string;
  version: string;
  title: string;
  intent: string;
  audience: string;
  stops: Stop[];
  constraints?: Constraints;
  signals?: Signals;
  context?: Context;
  presentation?: Presentation;
  metadata?: Metadata;
  meta?: PlanMeta;
  origin?: PlanOrigin;
  isTemplate?: boolean;
  templateMeta?: TemplateMeta;
  createdFrom?: CreatedFrom;
  ownerId?: string;
  originStarterId?: string;
  state?: PlanState;
}

export const PLAN_VERSION = '2.0';

export type Plan = PlanObject;

export interface ValidationIssue {
  level: 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  isValid: boolean;
}

export type PlanValidationResult = ValidationResult;
