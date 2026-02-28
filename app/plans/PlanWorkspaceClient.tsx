'use client';

import PlanPageClient from '../plan/PlanPageClient';

type PlanWorkspaceClientProps = {
  planId?: string | null;
  mode?: 'new' | 'existing';
};

export default function PlanWorkspaceClient(props: PlanWorkspaceClientProps) {
  return <PlanPageClient planId={props.planId ?? null} mode={props.mode} />;
}
