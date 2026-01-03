import type { Plan, PlanValidationResult, ValidationIssue } from './types';

function addIssue(
  issues: ValidationIssue[],
  issue: ValidationIssue
): ValidationIssue[] {
  issues.push(issue);
  return issues;
}

export function validatePlan(plan: Plan): PlanValidationResult {
  const issues: ValidationIssue[] = [];

  if (!plan.title || plan.title.trim().length === 0) {
    addIssue(issues, {
      level: 'warning',
      code: 'plan.title.missing',
      message: 'Plan title is missing',
      path: 'title',
    });
  }

  if (!plan.intent || plan.intent.trim().length === 0) {
    addIssue(issues, {
      level: 'warning',
      code: 'plan.intent.missing',
      message: 'Plan intent is missing',
      path: 'intent',
    });
  }

  if (!plan.stops || plan.stops.length === 0) {
    addIssue(issues, {
      level: 'warning',
      code: 'plan.stops.empty',
      message: 'Plan must include at least one stop',
      path: 'stops',
    });
  }

  let hasAnchor = false;
  plan.stops.forEach((stop, index) => {
    const stopPath = `stops[${index}]`;

    if (!stop.name || stop.name.trim().length === 0) {
      addIssue(issues, {
        level: 'warning',
        code: 'stop.name.missing',
        message: 'Stop name is missing',
        path: `${stopPath}.name`,
      });
    }

    if (!stop.role) {
      addIssue(issues, {
        level: 'warning',
        code: 'stop.role.missing',
        message: 'Stop role is missing',
        path: `${stopPath}.role`,
      });
    } else if (stop.role === 'anchor') {
      hasAnchor = true;
    }

    if (!stop.optionality) {
      addIssue(issues, {
        level: 'warning',
        code: 'stop.optionality.missing',
        message: 'Stop optionality is missing',
        path: `${stopPath}.optionality`,
      });
    }
  });

  if (plan.stops && plan.stops.length > 0 && !hasAnchor) {
    addIssue(issues, {
      level: 'warning',
      code: 'plan.stops.anchor.missing',
      message: 'At least one stop should have role "anchor"',
      path: 'stops',
    });
  }

  const hasWarning = issues.some((issue) => issue.level === 'warning');

  return {
    issues,
    isValid: !hasWarning,
  };
}
