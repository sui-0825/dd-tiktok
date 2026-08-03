-- D&D TikTok Ver25.81 incremental sharing setup
-- Run once in Supabase SQL Editor.

create table if not exists public.app_entry_records (
  workspace_id uuid not null,
  entry_id text not null,
  device_id text,
  entry_data jsonb,
  device_data jsonb,
  deleted boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entry_id)
);

alter table public.app_entry_records add column if not exists device_id text;
alter table public.app_entry_records add column if not exists entry_data jsonb;
alter table public.app_entry_records add column if not exists device_data jsonb;
alter table public.app_entry_records add column if not exists deleted boolean not null default false;
alter table public.app_entry_records add column if not exists updated_by uuid;
alter table public.app_entry_records add column if not exists updated_at timestamptz not null default now();
create index if not exists app_entry_records_workspace_updated_idx on public.app_entry_records(workspace_id, updated_at);

create table if not exists public.app_meta_state (
  workspace_id uuid primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.app_meta_state add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.app_meta_state add column if not exists updated_by uuid;
alter table public.app_meta_state add column if not exists updated_at timestamptz not null default now();

alter table public.app_entry_records enable row level security;
alter table public.app_meta_state enable row level security;

drop policy if exists app_entry_records_select on public.app_entry_records;
drop policy if exists app_entry_records_insert on public.app_entry_records;
drop policy if exists app_entry_records_update on public.app_entry_records;
drop policy if exists app_entry_records_delete on public.app_entry_records;

drop policy if exists app_meta_state_select on public.app_meta_state;
drop policy if exists app_meta_state_insert on public.app_meta_state;
drop policy if exists app_meta_state_update on public.app_meta_state;
drop policy if exists app_meta_state_delete on public.app_meta_state;

create policy app_entry_records_select on public.app_entry_records
for select to authenticated
using (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = app_entry_records.workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'approved'
));

create policy app_entry_records_insert on public.app_entry_records
for insert to authenticated
with check (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = app_entry_records.workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'approved'
));

create policy app_entry_records_update on public.app_entry_records
for update to authenticated
using (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = app_entry_records.workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'approved'
))
with check (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = app_entry_records.workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'approved'
));

create policy app_entry_records_delete on public.app_entry_records
for delete to authenticated
using (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = app_entry_records.workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'approved'
));

create policy app_meta_state_select on public.app_meta_state
for select to authenticated
using (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = app_meta_state.workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'approved'
));

create policy app_meta_state_insert on public.app_meta_state
for insert to authenticated
with check (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = app_meta_state.workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'approved'
));

create policy app_meta_state_update on public.app_meta_state
for update to authenticated
using (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = app_meta_state.workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'approved'
))
with check (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = app_meta_state.workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'approved'
));

create policy app_meta_state_delete on public.app_meta_state
for delete to authenticated
using (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = app_meta_state.workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'approved'
));

grant select, insert, update, delete on public.app_entry_records to authenticated;
grant select, insert, update, delete on public.app_meta_state to authenticated;

notify pgrst, 'reload schema';
