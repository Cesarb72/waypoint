# Waypoint Infrastructure Note

## Engine vs App
Waypoint engine does NOT require Supabase to run.

Current Supabase usage in this repo is app-layer only:
- auth
- browser client
- cloud plan persistence

## Important separation rule
Do NOT assume ID.8 should reuse the same Supabase project.

ID.8 is a separate product and should be treated as backend-independent until explicitly decided otherwise.

## Current Waypoint Supabase project
- Project name: Waypoint App host
- Project ref: https://hnzecnwazwyejlwbnhyf.supabase.co
- Region: [fill this in]
- Purpose: Waypoint app host only (not engine core)

## Deletion warning
Do NOT delete this Supabase project until:
- all dependent app-layer features are confirmed unused
- env vars are removed
- any required data is exported or backed up

## Env vars to verify
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- any SUPABASE_* values in local env files
- any Supabase values stored in Vercel project settings

## ID.8 rule
ID.8 should not inherit this Supabase project by default.
