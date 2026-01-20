-- Plan drafts table + RLS for Waypoint cloud autosave

create table if not exists public.plan_drafts (
  id uuid primary key,
  plan_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  draft_json jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists plan_drafts_owner_id_idx on public.plan_drafts (owner_id);
create index if not exists plan_drafts_plan_id_idx on public.plan_drafts (plan_id);

alter table public.plan_drafts enable row level security;

create policy "plan_drafts_select_own" on public.plan_drafts
  for select using (auth.uid() = owner_id);

create policy "plan_drafts_insert_own" on public.plan_drafts
  for insert with check (auth.uid() = owner_id);

create policy "plan_drafts_update_own" on public.plan_drafts
  for update using (auth.uid() = owner_id);

create policy "plan_drafts_delete_own" on public.plan_drafts
  for delete using (auth.uid() = owner_id);

create or replace function public.set_plan_drafts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists plan_drafts_set_updated_at on public.plan_drafts;
create trigger plan_drafts_set_updated_at
before update on public.plan_drafts
for each row execute function public.set_plan_drafts_updated_at();
