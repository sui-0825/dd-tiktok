-- D&D TikTok Ver25.7
-- Supabase SQL Editorで1回だけ実行してください。
-- 管理者が承認待ち利用者を一覧表示・承認できるようにするRPCです。

create or replace function public.dd_admin_list_members(target_workspace uuid)
returns table (
  user_id uuid,
  role text,
  status text,
  created_at timestamptz,
  approved_at timestamptz,
  display_name text,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace
      and wm.user_id = auth.uid()
      and wm.role in ('owner','admin')
      and wm.status = 'approved'
  ) then
    raise exception '管理者権限が必要です';
  end if;

  return query
  select wm.user_id, wm.role, wm.status, wm.created_at, wm.approved_at,
         coalesce(p.display_name,'名前未登録')::text, p.last_seen_at
  from public.workspace_members wm
  left join public.profiles p
    on p.workspace_id = wm.workspace_id and p.user_id = wm.user_id
  where wm.workspace_id = target_workspace
  order by case wm.status when 'pending' then 0 when 'approved' then 1 when 'suspended' then 2 else 3 end,
           wm.created_at asc;
end;
$$;

create or replace function public.dd_admin_update_member(
  target_workspace uuid,
  target_user uuid,
  new_status text default null,
  new_role text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  target_role text;
begin
  select wm.role into caller_role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace
    and wm.user_id = auth.uid()
    and wm.status = 'approved';

  if caller_role not in ('owner','admin') then
    raise exception '管理者権限が必要です';
  end if;
  if target_user = auth.uid() then
    raise exception '自分自身の権限は変更できません';
  end if;

  select wm.role into target_role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace and wm.user_id = target_user;
  if target_role is null then raise exception '利用者が見つかりません'; end if;
  if target_role = 'owner' then raise exception 'オーナーは変更できません'; end if;
  if new_role is not null and caller_role <> 'owner' then raise exception '管理者任命はオーナーのみです'; end if;
  if new_status is not null and new_status not in ('approved','pending','suspended','rejected') then raise exception '状態が正しくありません'; end if;
  if new_role is not null and new_role not in ('member','admin') then raise exception '役割が正しくありません'; end if;

  update public.workspace_members
  set status = coalesce(new_status,status),
      role = coalesce(new_role,role),
      approved_at = case when new_status='approved' then now() else approved_at end,
      approved_by = case when new_status='approved' then auth.uid() else approved_by end
  where workspace_id = target_workspace and user_id = target_user;
  return true;
end;
$$;

grant execute on function public.dd_admin_list_members(uuid) to authenticated;
grant execute on function public.dd_admin_update_member(uuid,uuid,text,text) to authenticated;
