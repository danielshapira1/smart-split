-- ============================================================================
-- Supabase schema for "shared expenses" (secure by default)
-- ============================================================================

-- Extensions
create extension if not exists pgcrypto  with schema public;
create extension if not exists "uuid-ossp" with schema public;

-- ============================================================================
-- PROFILES
-- ============================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz default now()
);

-- Sync auth.users -> profiles
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ============================================================================
-- GROUPS & MEMBERSHIPS
-- ============================================================================
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now()
);

create table if not exists public.memberships (
  group_id   uuid references public.groups(id) on delete cascade,
  user_id    uuid references auth.users(id)    on delete cascade,
  role       text not null default 'member', -- 'owner' | 'admin' | 'member'
  created_at timestamptz default now(),
  primary key (group_id, user_id)
);

-- ============================================================================
-- INVITES (join by link)
-- ============================================================================
create table if not exists public.invites (
  token        uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  invited_role text not null default 'member',
  inviter      uuid references auth.users(id),
  used_by      uuid references auth.users(id),
  used_at      timestamptz,
  expires_at   timestamptz default now() + interval '14 days',
  created_at   timestamptz default now()
);

create or replace function public.create_invite(p_group_id uuid, p_role text default 'member')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_token uuid;
begin
  -- only admin/owner in the group can create invites
  if not exists (
    select 1
    from public.memberships m
    where m.group_id = p_group_id
      and m.user_id  = auth.uid()
      and m.role in ('owner','admin')
  ) then
    raise exception 'not authorized';
  end if;

  insert into public.invites (group_id, invited_role, inviter)
  values (p_group_id, coalesce(p_role, 'member'), auth.uid())
  returning token into v_token;

  return v_token;
end;
$$;

create or replace function public.accept_invite(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_group uuid; v_role text;
begin
  select group_id, invited_role
    into v_group, v_role
  from public.invites
  where token = p_token
    and used_at is null
    and expires_at > now();

  if v_group is null then
    raise exception 'invalid or expired token';
  end if;

  insert into public.memberships (group_id, user_id, role)
  values (v_group, auth.uid(), coalesce(v_role, 'member'))
  on conflict (group_id, user_id) do update
    set role = excluded.role;

  update public.invites
     set used_by = auth.uid(),
         used_at = now()
   where token = p_token;
end;
$$;

-- ============================================================================
-- EXPENSES
-- ============================================================================
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid not null references auth.users(id)   on delete cascade, -- payer
  amount_cents integer not null check (amount_cents > 0),
  currency     text not null default 'ILS',
  description  text default '',
  category     text default 'אחר',
  occurred_on  date default current_date,
  created_at   timestamptz default now()
);

create index if not exists idx_expenses_group_created  on public.expenses (group_id, created_at desc);
create index if not exists idx_expenses_group_category on public.expenses (group_id, category);
create index if not exists idx_expenses_group_occurred on public.expenses (group_id, occurred_on);

-- ============================================================================
-- TRANSFERS (settle-ups)
-- ============================================================================
create table if not exists public.transfers (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  from_user    uuid not null references auth.users(id),
  to_user      uuid not null references auth.users(id),
  amount_cents integer not null check (amount_cents > 0),
  note         text default '',
  created_at   timestamptz default now()
);

-- ============================================================================
-- VIEWS
-- ============================================================================
-- Payer display name
create or replace view public.expenses_with_names as
select e.*, coalesce(p.display_name, p.email) as payer_name
from public.expenses e
left join public.profiles p on p.id = e.user_id;

-- Net balances per user in group (equal split among current members)
create or replace view public.net_balances as
with members as (
  select g.id as group_id, m.user_id
  from public.groups g
  join public.memberships m on m.group_id = g.id
),
member_counts as (
  select group_id, count(*) as cnt from members group by group_id
),
owed as (
  select e.group_id, m.user_id, sum(e.amount_cents / mc.cnt) as share_owed_cents
  from public.expenses e
  join members m on m.group_id = e.group_id
  join member_counts mc on mc.group_id = e.group_id
  group by e.group_id, m.user_id
),
paid as (
  select group_id, user_id, sum(amount_cents) as paid_cents
  from public.expenses
  group by group_id, user_id
),
t_out as (
  select group_id, from_user as user_id, coalesce(sum(amount_cents),0) as transfers_out_cents
  from public.transfers group by group_id, from_user
),
t_in as (
  select group_id, to_user as user_id, coalesce(sum(amount_cents),0) as transfers_in_cents
  from public.transfers group by group_id, to_user
)
select
  m.group_id,
  m.user_id,
  coalesce(paid.paid_cents,0)
  - coalesce(owed.share_owed_cents,0)
  - coalesce(t_out.transfers_out_cents,0)
  + coalesce(t_in.transfers_in_cents,0) as net_cents
from members m
left join paid on paid.group_id = m.group_id and paid.user_id = m.user_id
left join owed on owed.group_id = m.group_id and owed.user_id = m.user_id
left join t_out on t_out.group_id = m.group_id and t_out.user_id = m.user_id
left join t_in on t_in.group_id = m.group_id and t_in.user_id = m.user_id
order by m.group_id, m.user_id;

-- ============================================================================
-- RLS + POLICIES
-- ============================================================================
alter table public.profiles     enable row level security;
alter table public.groups       enable row level security;
alter table public.memberships  enable row level security;
alter table public.invites      enable row level security;
alter table public.expenses     enable row level security;
alter table public.transfers    enable row level security;

-- Profiles
drop policy if exists "read own profile"   on public.profiles;
create policy "read own profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
on public.profiles for update
using (auth.uid() = id);

-- Groups (קריאה: חברים בלבד + היוצר)
drop policy if exists "select groups for members" on public.groups;
create policy "select groups for members"
on public.groups for select
using (
  exists (
    select 1 from public.memberships m
    where m.group_id = id
      and m.user_id  = auth.uid()
  )
);

drop policy if exists "select groups for creator" on public.groups;
create policy "select groups for creator"
on public.groups for select
using (created_by = auth.uid());

-- לא נאפשר Insert/Update/Delete ישיר ל-groups: שימוש דרך RPC בלבד
revoke insert, update, delete on public.groups from anon, authenticated;

-- Memberships
drop policy if exists "select my memberships" on public.memberships;
create policy "select my memberships"
on public.memberships for select
using (user_id = auth.uid());

drop policy if exists "insert my membership" on public.memberships;
create policy "insert my membership"
on public.memberships for insert
with check (user_id = auth.uid());

drop policy if exists "delete membership admin" on public.memberships;
create policy "delete membership admin"
on public.memberships for delete
using (
  exists (
    select 1
    from public.memberships mm
    where mm.group_id = memberships.group_id
      and mm.user_id  = auth.uid()
      and mm.role in ('owner','admin')
  )
);

-- להגביל גם כאן פעולות ישירות: נעדיף RPC
revoke insert, update, delete on public.memberships from anon, authenticated;

-- Invites
drop policy if exists "select invite by token" on public.invites;
create policy "select invite by token"
on public.invites for select
using (true);

drop policy if exists "insert invite admin" on public.invites;
create policy "insert invite admin"
on public.invites for insert
with check (
  exists (
    select 1 from public.memberships m
    where m.group_id = invites.group_id
      and m.user_id  = auth.uid()
      and m.role in ('owner','admin')
  )
);

drop policy if exists "update invite admin" on public.invites;
create policy "update invite admin"
on public.invites for update
using (
  exists (
    select 1 from public.memberships m
    where m.group_id = invites.group_id
      and m.user_id  = auth.uid()
      and m.role in ('owner','admin')
  )
);

-- Expenses
drop policy if exists "select group expenses" on public.expenses;
create policy "select group expenses"
on public.expenses for select
using (
  exists (
    select 1 from public.memberships m
    where m.group_id = expenses.group_id
      and m.user_id  = auth.uid()
  )
);

drop policy if exists "insert my expense" on public.expenses;
create policy "insert my expense"
on public.expenses for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.memberships m
    where m.group_id = expenses.group_id
      and m.user_id  = auth.uid()
  )
);

drop policy if exists "update my expense or admin" on public.expenses;
create policy "update my expense or admin"
on public.expenses for update
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.memberships m
    where m.group_id = expenses.group_id
      and m.user_id  = auth.uid()
      and m.role in ('owner','admin')
  )
);

drop policy if exists "delete my expense or admin" on public.expenses;
create policy "delete my expense or admin"
on public.expenses for delete
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.memberships m
    where m.group_id = expenses.group_id
      and m.user_id  = auth.uid()
      and m.role in ('owner','admin')
  )
);

-- Transfers
drop policy if exists "select group transfers" on public.transfers;
create policy "select group transfers"
on public.transfers for select
using (
  exists (
    select 1 from public.memberships m
    where m.group_id = transfers.group_id
      and m.user_id  = auth.uid()
  )
);

drop policy if exists "insert my transfer or admin" on public.transfers;
create policy "insert my transfer or admin"
on public.transfers for insert
with check (
  from_user = auth.uid()
  or exists (
    select 1 from public.memberships m
    where m.group_id = transfers.group_id
      and m.user_id  = auth.uid()
      and m.role in ('owner','admin')
  )
);

drop policy if exists "delete transfer admin" on public.transfers;
create policy "delete transfer admin"
on public.transfers for delete
using (
  exists (
    select 1 from public.memberships m
    where m.group_id = transfers.group_id
      and m.user_id  = auth.uid()
      and m.role in ('owner','admin')
  )
);

-- ============================================================================
-- BASE GRANTS (RLS still controls row access)
-- ============================================================================
grant select on table public.groups       to anon, authenticated;
grant select on table public.memberships  to anon, authenticated;
grant select on table public.profiles     to anon, authenticated;
grant select on table public.expenses     to anon, authenticated;
grant select on table public.transfers    to anon, authenticated;
grant select on table public.invites      to anon, authenticated;
grant usage  on schema public             to anon, authenticated;

-- ============================================================================
-- RPC: create_group(p_name text) → מחזיר את השורה המלאה של הקבוצה
-- ============================================================================
create or replace function public.create_group(p_name text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gid uuid;
  v_row public.groups;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Group name is required';
  end if;

  insert into public.groups (id, name, created_by, created_at)
  values (gen_random_uuid(), trim(p_name), v_uid, now())
  returning id into v_gid;

  -- לצרף את היוצר כבעלים (Idempotent הודות ל-PK (group_id,user_id))
  insert into public.memberships (group_id, user_id, role, created_at)
  values (v_gid, v_uid, 'owner', now())
  on conflict (group_id, user_id) do update
    set role = excluded.role;

  select * into v_row from public.groups where id = v_gid;
  return v_row;
end;
$$;

grant execute on function public.create_group(text) to anon, authenticated;

-- פונקציית הצטרפות שמחזירה תשובה מפורטת
create or replace function public.join_group_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv   public.invites%rowtype;
  v_gname text;
begin
  -- מאתרים הזמנה תקפה
  select * into v_inv
  from public.invites
  where token = p_token
    and used_by is null
    and expires_at > now();

  if not found then
    return jsonb_build_object('joined', false, 'reason', 'invalid_or_expired');
  end if;

  -- מצרפים כחבר (Idempotent)
  insert into public.memberships (group_id, user_id, role)
  values (v_inv.group_id, auth.uid(), v_inv.invited_role)
  on conflict (group_id, user_id) do nothing;

  -- מסמנים שהוזמן נוצל
  update public.invites
     set used_by = auth.uid(), used_at = now()
   where token = p_token and used_by is null;

  select name into v_gname from public.groups where id = v_inv.group_id;

  return jsonb_build_object(
    'joined', true,
    'group_id', v_inv.group_id,
    'group_name', v_gname
  );

exception when others then
  -- לא לבלוע בשקט – נחזיר reason מפורט לקליינט
  return jsonb_build_object('joined', false, 'reason', sqlerrm);
end $$;

grant execute on function public.join_group_token(uuid) to anon, authenticated;

