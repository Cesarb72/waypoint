import { redirect } from 'next/navigation';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function toQueryString(input?: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  if (!input) return '';
  Object.entries(input).forEach(([key, value]) => {
    if (typeof value === 'string') {
      params.set(key, value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (typeof entry === 'string') params.append(key, entry);
      });
    }
  });
  return params.toString();
}

export default async function CreatePage({ searchParams }: PageProps) {
  const sp = searchParams ? await searchParams : undefined;
  const qs = toQueryString(sp);
  redirect(qs ? `/plans/new?${qs}` : '/plans/new');
}
