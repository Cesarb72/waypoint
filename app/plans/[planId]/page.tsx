import { Suspense } from 'react';
import PlanPageClient from '../../plan/PlanPageClient';

export default function PlanByIdPage() {
  return (
    <Suspense fallback={null}>
      <PlanPageClient />
    </Suspense>
  );
}
