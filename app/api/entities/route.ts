// app/api/entities/route.ts

import { NextResponse } from 'next/server';
import { ENTITIES, type Entity } from '@/data/entities';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim().toLowerCase();

  // We’re ignoring lat/lng for now – they can be wired later.
  let results: Entity[] = ENTITIES;

  if (q) {
    results = results.filter((entity) => {
      const haystack = `${entity.name} ${entity.description} ${entity.location ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  return NextResponse.json({ ENTITIES: results });
}
