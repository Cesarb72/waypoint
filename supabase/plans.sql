-- V3.1 cloud plans + events

create extension if not exists pgcrypto;

create table if not exists public.plans (
  id uuid primary key,
  owner_type text not null check (owner_type in ('user', 'org')),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  intent text,
  audience text,
  origin_kind text check (origin_kind in ('manual', 'search', 'template', 'curated', 'generated')),
  edit_policy text not null check (edit_policy in ('owner_only', 'fork_required')),
  created_from jsonb,
  share_token text,
  plan jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plans_owner_id_idx on public.plans (owner_id);
create index if not exists plans_share_token_idx on public.plans (share_token);

alter table public.plans enable row level security;

create policy "plans_select_owner" on public.plans
  for select using (auth.uid() = owner_id);

create policy "plans_insert_owner" on public.plans
  for insert with check (auth.uid() = owner_id);

create policy "plans_update_owner" on public.plans
  for update using (auth.uid() = owner_id);

create policy "plans_delete_owner" on public.plans
  for delete using (auth.uid() = owner_id);

create or replace function public.get_shared_plan(
  p_plan_id uuid,
  p_token text
)
returns table (
  id uuid,
  title text,
  intent text,
  audience text,
  stops jsonb,
  presentation jsonb,
  brand jsonb,
  origin jsonb,
  created_from jsonb,
  metadata jsonb,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    id,
    title,
    intent,
    audience,
    plan -> 'stops' as stops,
    plan -> 'presentation' as presentation,
    plan -> 'brand' as brand,
    plan -> 'origin' as origin,
    created_from as created_from,
    plan -> 'metadata' as metadata,
    updated_at
  from public.plans
  where id = p_plan_id
    and share_token = p_token
  limit 1;
$$;

grant execute on function public.get_shared_plan(uuid, text) to anon, authenticated;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at
before update on public.plans
for each row execute function public.set_updated_at();

create table if not exists public.plan_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  plan_id uuid references public.plans(id) on delete set null,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists plan_events_user_id_idx on public.plan_events (user_id);
create index if not exists plan_events_plan_id_idx on public.plan_events (plan_id);

alter table public.plan_events enable row level security;

create policy "plan_events_insert" on public.plan_events
  for insert with check (auth.uid() = user_id or user_id is null);

create policy "plan_events_select_own" on public.plan_events
  for select using (auth.uid() = user_id);
