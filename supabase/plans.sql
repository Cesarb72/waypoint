-- Plans table + RLS for Waypoint cloud plans

create table if not exists public.plans (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  plan_json jsonb not null,
  origin_json jsonb,
  presentation_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plans_owner_id_idx on public.plans (owner_id);

alter table public.plans enable row level security;

create policy "plans_select_own" on public.plans
  for select using (
    auth.uid() = owner_id
    or exists (
      select 1
      from public.plan_members
      where plan_members.plan_id = plans.id
        and plan_members.user_id = auth.uid()
    )
  );

create policy "plans_insert_own" on public.plans
  for insert with check (auth.uid() = owner_id);

create policy "plans_update_own" on public.plans
  for update using (
    auth.uid() = owner_id
    or exists (
      select 1
      from public.plan_members
      where plan_members.plan_id = plans.id
        and plan_members.user_id = auth.uid()
        and plan_members.role in ('owner', 'editor')
    )
  );

create policy "plans_delete_own" on public.plans
  for delete using (auth.uid() = owner_id);

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
