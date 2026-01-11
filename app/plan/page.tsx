import { Suspense } from 'react';
import PlanShareClient from './PlanShareClient';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PlanSharePage({ searchParams }: PageProps) {
  if (process.env.NODE_ENV === 'development') {
    try {
      const sp = searchParams ? await searchParams : undefined;
      console.log('[origin2] plan route mounted', {
        pathname: '/plan',
        searchParams: sp ?? null,
      });
    } catch {
      console.log('[origin2] plan route mounted', { pathname: '/plan', searchParams: null });
    }
  }
  return (
    <Suspense fallback={null}>
      <PlanShareClient />
    </Suspense>
  );
}
