import { Suspense } from 'react';
import PlanShareClient from './PlanShareClient';

export default function PlanSharePage() {
  return (
    <Suspense fallback={null}>
      <PlanShareClient />
    </Suspense>
  );
}
