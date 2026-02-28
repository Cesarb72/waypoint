import { Suspense } from 'react';
import PlanWorkspaceClient from '../PlanWorkspaceClient';

export default function NewPlanPage() {
  return (
    <Suspense fallback={null}>
      <PlanWorkspaceClient planId={null} mode="new" />
    </Suspense>
  );
}
