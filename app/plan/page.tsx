import { Suspense } from 'react';
import PlanPageClient from './PlanPageClient';

export default function PlanSharePage() {
  return (
    <Suspense fallback={null}>
      <PlanPageClient />
    </Suspense>
  );
}
