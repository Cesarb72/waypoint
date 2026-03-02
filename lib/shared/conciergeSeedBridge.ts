import {
  buildSurpriseMePlan,
  buildSurpriseMePlanGoogle,
  toSeedResolverError,
  withIdeaDateSeedResolverTelemetry,
} from '@/lib/idea-date/seeds';

// TODO(portability): Move seed implementation out of idea-date into a neutral module.
export const buildSeedPlan = buildSurpriseMePlan;
export const buildSeedPlanGoogle = buildSurpriseMePlanGoogle;
export { toSeedResolverError };
export const withSeedResolverTelemetry = withIdeaDateSeedResolverTelemetry;
