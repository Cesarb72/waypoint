import { notFound } from 'next/navigation';
import SeedBuilderClient from './seedBuilderClient';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SeedBuilderPage({ searchParams }: PageProps) {
  const sp = searchParams ? await searchParams : undefined;
  const debugParam = sp?.debug;
  const debug =
    debugParam === '1' || (Array.isArray(debugParam) && debugParam.includes('1'));

  if (process.env.NODE_ENV === 'production' && !debug) {
    notFound();
  }

  return <SeedBuilderClient />;
}
