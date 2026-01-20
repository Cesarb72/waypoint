import { Suspense } from 'react';
import EmbedPlanClient from './EmbedPlanClient';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EmbedPage({ searchParams }: PageProps) {
  if (process.env.NODE_ENV === 'development') {
    try {
      const sp = searchParams ? await searchParams : undefined;
      console.log('[origin2] embed route mounted', {
        pathname: '/embed',
        searchParams: sp ?? null,
      });
    } catch {
      console.log('[origin2] embed route mounted', { pathname: '/embed', searchParams: null });
    }
  }
  return (
    <Suspense fallback={null}>
      <EmbedPlanClient />
    </Suspense>
  );
}
