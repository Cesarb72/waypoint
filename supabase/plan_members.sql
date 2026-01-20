-- Plan members table + RLS for team access

create table if not exists public.plan_members (
  id uuid primary key,
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now()
);

create unique index if not exists plan_members_plan_user_key on public.plan_members (plan_id, user_id);
create index if not exists plan_members_plan_id_idx on public.plan_members (plan_id);
create index if not exists plan_members_user_id_idx on public.plan_members (user_id);

alter table public.plan_members enable row level security;

create policy "plan_members_select_members" on public.plan_members
  for select using (
    exists (
      select 1
      from public.plans
      where plans.id = plan_members.plan_id
        and (
          plans.owner_id = auth.uid()
          or exists (
            select 1
            from public.plan_members as pm
            where pm.plan_id = plan_members.plan_id
              and pm.user_id = auth.uid()
          )
        )
    )
  );

create policy "plan_members_manage_owner_only" on public.plan_members
  for insert with check (
    exists (
      select 1 from public.plans
      where plans.id = plan_members.plan_id
        and plans.owner_id = auth.uid()
    )
  );

create policy "plan_members_update_owner_only" on public.plan_members
  for update using (
    exists (
      select 1 from public.plans
      where plans.id = plan_members.plan_id
        and plans.owner_id = auth.uid()
    )
  );

create policy "plan_members_delete_owner_only" on public.plan_members
  for delete using (
    exists (
      select 1 from public.plans
      where plans.id = plan_members.plan_id
        and plans.owner_id = auth.uid()
    )
  );

-- Backfill owner membership for existing plans
insert into public.plan_members (id, plan_id, user_id, role)
select gen_random_uuid(), plans.id, plans.owner_id, 'owner'
from public.plans
where plans.owner_id is not null
on conflict (plan_id, user_id) do nothing;
