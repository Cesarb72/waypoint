import { Suspense } from 'react';
import PlanWorkspaceClient from '../PlanWorkspaceClient';

type PageProps = {
  params: Promise<{ planId: string }>;
};

export default async function PlanByIdPage({ params }: PageProps) {
  const resolved = await params;
  return (
    <Suspense fallback={null}>
      <PlanWorkspaceClient planId={resolved.planId} mode="existing" />
    </Suspense>
  );
}
