-- D&D TikTok Ver25.56: 1件単位の入力共有テーブル
create table if not exists public.app_entry_records (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entry_id text not null,
  device_id text,
  entry_data jsonb not null default '{}'::jsonb,
  device_data jsonb,
  deleted boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entry_id)
);

create index if not exists app_entry_records_workspace_updated_idx
  on public.app_entry_records(workspace_id, updated_at);

alter table public.app_entry_records enable row level security;

drop policy if exists app_entry_records_select_approved on public.app_entry_records;
create policy app_entry_records_select_approved on public.app_entry_records
for select to authenticated
using (exists (
  select 1 from public.workspace_members m
  where m.workspace_id=app_entry_records.workspace_id
    and m.user_id=auth.uid()
    and m.status='approved'
));

drop policy if exists app_entry_records_insert_approved on public.app_entry_records;
create policy app_entry_records_insert_approved on public.app_entry_records
for insert to authenticated
with check (exists (
  select 1 from public.workspace_members m
  where m.workspace_id=app_entry_records.workspace_id
    and m.user_id=auth.uid()
    and m.status='approved'
));

drop policy if exists app_entry_records_update_approved on public.app_entry_records;
create policy app_entry_records_update_approved on public.app_entry_records
for update to authenticated
using (exists (
  select 1 from public.workspace_members m
  where m.workspace_id=app_entry_records.workspace_id
    and m.user_id=auth.uid()
    and m.status='approved'
))
with check (exists (
  select 1 from public.workspace_members m
  where m.workspace_id=app_entry_records.workspace_id
    and m.user_id=auth.uid()
    and m.status='approved'
));
