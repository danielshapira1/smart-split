-- ============================================================================
-- Supabase schema for "shared expenses" (secure by default)
-- CLEAN SLATE VERSION: DROPS EVERYTHING FIRST!
-- ============================================================================

-- ============================================================================
-- SAFEGUARDED: Destructive DROP commands are commented out to prevent accidents.
-- ============================================================================

-- -- 1. DROP EXISTING VIEWS
-- drop view if exists public.net_balances cascade;
-- drop view if exists public.expenses_with_names cascade;

-- -- 2. DROP EXISTING TABLES (Reverse dependency order to avoid FK errors)
-- drop table if exists public.expense_splits cascade; -- NEW
-- drop table if exists public.transfers cascade;
-- drop table if exists public.recurring_expenses cascade; -- Safety add
-- drop table if exists public.expenses cascade;
-- drop table if exists public.invites cascade;
-- drop table if exists public.memberships cascade;
-- drop table if exists public.groups cascade;
-- -- We can drop profiles, but remember this deletes user profile data!
-- drop table if exists public.profiles cascade;

-- -- 3. DROP FUNCTIONS & TRIGGERS
-- drop trigger if exists on_auth_user_created on auth.users cascade;
-- drop function if exists public.handle_new_user() cascade;
-- drop function if exists public.create_group(text) cascade;
-- drop function if exists public.create_invite(uuid, text) cascade;
-- drop function if exists public.accept_invite(uuid) cascade;
-- drop function if exists public.join_group_token(uuid) cascade;
-- drop function if exists public.get_group_members(uuid) cascade; -- NEW

-- ============================================================================
-- RE-CREATE EVERYTHING
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

-- Sync auth.users -> profiles (Improved Trigger)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Try to get name from metadata, fallback to email prefix
  insert into public.profiles (id, email, display_name)
  values (
    new.id, 
    new.email, 
    coalesce(
       new.raw_user_meta_data->>'full_name', 
       new.raw_user_meta_data->>'name', 
       new.raw_user_meta_data->>'display_name',
       split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do update
  set 
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name);
    
  return new;
end;
$$;

-- Drop trigger if exists to allow re-creation
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- BACKFILL: Ensure all existing users have a profile
insert into public.profiles (id, email, display_name)
select 
  id, 
  email, 
  coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', raw_user_meta_data->>'display_name', split_part(email, '@', 1))
from auth.users
on conflict (id) do nothing;

-- ============================================================================
-- GROUPS & MEMBERSHIPS
-- ============================================================================
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid, 
  created_at  timestamptz default now(),
  constraint groups_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create table if not exists public.memberships (
  group_id   uuid references public.groups(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
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
  inviter      uuid references public.profiles(id),
  used_by      uuid references public.profiles(id),
  used_at      timestamptz,
  expires_at   timestamptz default now() + interval '14 days',
  created_at   timestamptz default now()
);

-- ============================================================================
-- EXPENSES
-- ============================================================================
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade, 
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
-- EXPENSE SPLITS (NEW: Custom Splits)
-- ============================================================================
create table if not exists public.expense_splits (
  id             uuid primary key default gen_random_uuid(),
  expense_id     uuid not null references public.expenses(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  amount_cents   integer not null check (amount_cents >= 0),
  percentage     numeric(5,2), -- optional
  created_at     timestamptz default now(),
  unique(expense_id, user_id)
);

-- ============================================================================
-- TRANSFERS (settle-ups)
-- ============================================================================
create table if not exists public.transfers (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  from_user    uuid not null references public.profiles(id),
  to_user      uuid not null references public.profiles(id),
  amount_cents integer not null check (amount_cents > 0),
  note         text default '',
  created_at   timestamptz default now()
);

-- ============================================================================
-- RECURRING EXPENSES (Restored for App Compatibility)
-- ============================================================================
create table if not exists public.recurring_expenses (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency     text not null default 'ILS',
  description  text default '',
  category     text default 'אחר',
  frequency    text not null check (frequency in ('monthly', 'weekly')),
  last_run     timestamptz,
  next_run     date not null default current_date,
  active       boolean default true,
  created_at   timestamptz default now()
);

-- ============================================================================
-- VIEWS
-- ============================================================================

-- 1. Expenses with Payer Name (Fallback to Email/Unknown)
create or replace view public.expenses_with_names
with (security_invoker = true)
as
select e.*, coalesce(p.display_name, p.email, 'Unknown') as payer_name
from public.expenses e
left join public.profiles p on p.id = e.user_id;

-- 2. Net Balances (The Core Logic View - Updated for Splits)
create or replace view public.net_balances
with (security_invoker = true)
as
with 
-- All members of a group
members as (
  select g.id as group_id, m.user_id
  from public.groups g
  join public.memberships m on m.group_id = g.id
),
-- Count of members per group (for equal split fallback)
member_counts as (
  select group_id, count(*) as cnt 
  from members 
  group by group_id
),
-- Unsplit expenses (No entry in expense_splits) -> Split Equally
unsplit_expenses as (
  select e.group_id, e.id, e.amount_cents
  from public.expenses e
  where not exists (select 1 from public.expense_splits s where s.expense_id = e.id)
),
owed_equal as (
  select 
    e.group_id, 
    m.user_id, 
    sum(e.amount_cents / greatest(mc.cnt, 1)) as share_owed_cents
  from unsplit_expenses e
  join member_counts mc on mc.group_id = e.group_id
  join members m on m.group_id = e.group_id
  group by e.group_id, m.user_id
),
-- Custom split expenses
owed_custom as (
  select 
    e.group_id, 
    s.user_id, 
    sum(s.amount_cents) as share_owed_cents
  from public.expenses e
  join public.expense_splits s on s.expense_id = e.id
  group by e.group_id, s.user_id
),
-- Total paid by each user
paid as (
  select group_id, user_id, sum(amount_cents) as paid_cents
  from public.expenses
  group by group_id, user_id
),
-- Transfers Out
t_out as (
  select group_id, from_user as user_id, sum(amount_cents) as transfers_out_cents
  from public.transfers group by group_id, from_user
),
-- Transfers In
t_in as (
  select group_id, to_user as user_id, sum(amount_cents) as transfers_in_cents
  from public.transfers group by group_id, to_user
)
select
  m.group_id,
  m.user_id,
  (coalesce(paid.paid_cents,0) + coalesce(t_in.transfers_in_cents,0)) -- Total Inputs (Paid + Received)
  - 
  (coalesce(owed_equal.share_owed_cents,0) + coalesce(owed_custom.share_owed_cents,0) + coalesce(t_out.transfers_out_cents,0)) -- Total Outputs (Owed + Sent)
  as net_cents
from members m
left join paid on paid.group_id = m.group_id and paid.user_id = m.user_id
left join owed_equal on owed_equal.group_id = m.group_id and owed_equal.user_id = m.user_id
left join owed_custom on owed_custom.group_id = m.group_id and owed_custom.user_id = m.user_id
left join t_out on t_out.group_id = m.group_id and t_out.user_id = m.user_id
left join t_in on t_in.group_id = m.group_id and t_in.user_id = m.user_id
order by m.group_id, m.user_id;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================
alter table public.profiles     enable row level security;
alter table public.groups       enable row level security;
alter table public.memberships  enable row level security;
alter table public.invites      enable row level security;
alter table public.expenses     enable row level security;
alter table public.expense_splits enable row level security;
alter table public.transfers    enable row level security;
alter table public.recurring_expenses enable row level security;

-- Profiles
-- Profiles
drop policy if exists "read own profile"   on public.profiles;
drop policy if exists "read_all_profiles"  on public.profiles;
create policy "read_all_profiles" on public.profiles for select using (true);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update using (auth.uid() = id);

-- Groups
drop policy if exists "select groups for members" on public.groups;
create policy "select groups for members" on public.groups for select
using (exists (select 1 from public.memberships m where m.group_id = id and m.user_id = auth.uid()));

drop policy if exists "select groups for creator" on public.groups;
create policy "select groups for creator" on public.groups for select using (created_by = auth.uid());

revoke insert, update, delete on public.groups from anon, authenticated;

-- Memberships
-- Memberships
-- Helper to avoid recursion in policies
-- Helper to avoid recursion in policies
drop function if exists public.get_my_group_ids() cascade;
create or replace function public.get_my_group_ids()
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  gids uuid[];
begin
  -- Prevent infinite recursion by disabling RLS for this lookups
  set local row_security = off;
  select array_agg(group_id) into gids from public.memberships where user_id = auth.uid();
  return coalesce(gids, '{}'::uuid[]);
end;
$$;

drop policy if exists "select my memberships" on public.memberships;
drop policy if exists "read members of my groups" on public.memberships;
-- Allow reading any membership if it belongs to a group I am in (Active user can see who is in their groups)
create policy "read members of my groups" on public.memberships for select
using ( group_id = ANY(public.get_my_group_ids()) );

drop policy if exists "insert my membership" on public.memberships;
create policy "insert my membership" on public.memberships for insert with check (user_id = auth.uid());

drop policy if exists "delete membership admin" on public.memberships;
create policy "delete membership admin" on public.memberships for delete
using (
  exists (
    select 1 from public.memberships mm
    where mm.group_id = memberships.group_id
      and mm.user_id  = auth.uid()
      and mm.role in ('owner','admin')
  )
);

revoke insert, update, delete on public.memberships from anon, authenticated;

-- Invites
drop policy if exists "select invite by token" on public.invites;
create policy "select invite by token" on public.invites for select using (true);

drop policy if exists "insert invite admin" on public.invites;
create policy "insert invite admin" on public.invites for insert with check (
  exists (select 1 from public.memberships m where m.group_id = invites.group_id and m.user_id = auth.uid() and m.role in ('owner','admin'))
);

drop policy if exists "update invite admin" on public.invites;
create policy "update invite admin" on public.invites for update using (
  exists (select 1 from public.memberships m where m.group_id = invites.group_id and m.user_id = auth.uid() and m.role in ('owner','admin'))
);

-- Expenses
drop policy if exists "select group expenses" on public.expenses;
create policy "select group expenses" on public.expenses for select
using (exists (select 1 from public.memberships m where m.group_id = expenses.group_id and m.user_id = auth.uid()));

drop policy if exists "insert my expense" on public.expenses;
create policy "insert my expense" on public.expenses for insert with check (
  user_id = auth.uid() and 
  exists (select 1 from public.memberships m where m.group_id = expenses.group_id and m.user_id = auth.uid())
);

drop policy if exists "update my expense or admin" on public.expenses;
create policy "update my expense or admin" on public.expenses for update using (
  user_id = auth.uid() or
  exists (select 1 from public.memberships m where m.group_id = expenses.group_id and m.user_id = auth.uid() and m.role in ('owner','admin'))
);

drop policy if exists "delete my expense or admin" on public.expenses;
create policy "delete my expense or admin" on public.expenses for delete using (
  user_id = auth.uid() or
  exists (select 1 from public.memberships m where m.group_id = expenses.group_id and m.user_id = auth.uid() and m.role in ('owner','admin'))
);

-- Expense Splits (Visibility matches expenses)
-- Expense Splits (Visibility matches expenses)
drop policy if exists "expense splits visibility" on public.expense_splits;
create policy "expense splits visibility" on public.expense_splits for select
using (exists (select 1 from public.expenses e where e.id = expense_id and exists (select 1 from public.memberships m where m.group_id = e.group_id and m.user_id = auth.uid())));

drop policy if exists "expense splits insert" on public.expense_splits;
create policy "expense splits insert" on public.expense_splits for insert with check (true); -- Handled by expense insert logic usually

-- Transfers
drop policy if exists "select group transfers" on public.transfers;
create policy "select group transfers" on public.transfers for select
using (exists (select 1 from public.memberships m where m.group_id = transfers.group_id and m.user_id = auth.uid()));

drop policy if exists "insert my transfer or admin" on public.transfers;
create policy "insert my transfer or admin" on public.transfers for insert with check (
  from_user = auth.uid() or to_user = auth.uid() or
  exists (select 1 from public.memberships m where m.group_id = transfers.group_id and m.user_id = auth.uid() and m.role in ('owner','admin'))
);

drop policy if exists "delete transfer admin" on public.transfers;
create policy "delete transfer admin" on public.transfers for delete
using (
  exists (select 1 from public.memberships m where m.group_id = transfers.group_id and m.user_id = auth.uid() and m.role in ('owner','admin'))
);

-- Recurring Expenses
drop policy if exists "select group recurring" on public.recurring_expenses;
create policy "select group recurring" on public.recurring_expenses for select
using (exists (select 1 from public.memberships m where m.group_id = recurring_expenses.group_id and m.user_id = auth.uid()));
-- (Additional policies could be added here similar to expenses)
grant select, insert, update, delete on public.recurring_expenses to authenticated;

-- ============================================================================
-- BASE GRANTS
-- ============================================================================
grant select on table public.groups       to anon, authenticated;
grant select on table public.memberships  to anon, authenticated;
grant select on table public.profiles     to anon, authenticated;
grant select on table public.expenses     to anon, authenticated;
grant select on table public.transfers    to anon, authenticated;
grant select on table public.invites      to anon, authenticated;
grant select on table public.expense_splits to anon, authenticated;
grant usage  on schema public             to anon, authenticated;

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- Secure Member Fetch (Bypasses RLS to ensure names are shown)
create or replace function public.get_group_members(p_group_id uuid)
returns table (
  user_id uuid,
  display_name text,
  email text,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    m.user_id,
    coalesce(p.display_name, split_part(p.email, '@', 1), 'Unknown'),
    coalesce(p.email, ''),
    m.role::text
  from public.memberships m
  left join public.profiles p on p.id = m.user_id
  where m.group_id = p_group_id;
end;
$$;

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
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Group name is required'; end if;

  insert into public.groups (id, name, created_by, created_at)
  values (gen_random_uuid(), trim(p_name), v_uid, now())
  returning id into v_gid;

  insert into public.memberships (group_id, user_id, role, created_at)
  values (v_gid, v_uid, 'owner', now());

  select * into v_row from public.groups where id = v_gid;
  return v_row;
end;
$$;
grant execute on function public.create_group(text) to anon, authenticated;

create or replace function public.create_invite(p_group_id uuid, p_role text default 'member')
returns uuid
language plpgsql
security definer
as $$
declare v_token uuid;
begin
  if not exists (select 1 from public.memberships where group_id = p_group_id and user_id = auth.uid() and role in ('owner','admin')) then
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
as $$
declare v_group uuid; v_role text;
begin
  select group_id, invited_role into v_group, v_role
  from public.invites where token = p_token and used_at is null and expires_at > now();
  if v_group is null then raise exception 'invalid or expired token'; end if;

  insert into public.memberships (group_id, user_id, role)
  values (v_group, auth.uid(), coalesce(v_role, 'member'))
  on conflict (group_id, user_id) do update set role = excluded.role;

  delete from public.invites where token = p_token;
end;
$$;

create or replace function public.join_group_token(p_token uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_inv public.invites%rowtype;
  v_gname text;
begin
  select * into v_inv from public.invites where token = p_token and used_by is null and expires_at > now();
  if not found then return jsonb_build_object('joined', false, 'reason', 'invalid_or_expired'); end if;

  insert into public.memberships (group_id, user_id, role) values (v_inv.group_id, auth.uid(), v_inv.invited_role) on conflict do nothing;
  delete from public.invites where token = p_token;
  select name into v_gname from public.groups where id = v_inv.group_id;
  
  return jsonb_build_object('joined', true, 'group_id', v_inv.group_id, 'group_name', v_gname);
end;
$$;

-- Recurring Process
create or replace function public.process_recurring_expenses()
returns void
language plpgsql
security definer
as $$
declare
  r record;
  new_next_run date;
begin
  for r in (select * from public.recurring_expenses where active = true and next_run <= current_date) loop
    INSERT INTO public.expenses (group_id, user_id, amount_cents, currency, description, category, occurred_on) 
    VALUES (r.group_id, r.user_id, r.amount_cents, r.currency, r.description || ' (תשלום קבוע)', r.category, current_date);

    if r.frequency = 'monthly' then new_next_run := r.next_run + interval '1 month';
    elsif r.frequency = 'weekly' then new_next_run := r.next_run + interval '1 week';
    else new_next_run := r.next_run + interval '1 month'; end if;

    UPDATE public.recurring_expenses SET last_run = now(), next_run = new_next_run WHERE id = r.id;
  end loop;
end;
$$;

-- ============================================================================
-- BACKUP SYSTEM
-- ============================================================================

-- 1. Enable pg_cron
create extension if not exists pg_cron with schema public;

-- 2. Create Backups Table
create table if not exists public.daily_backups (
  id               uuid primary key default gen_random_uuid(),
  backup_timestamp timestamptz default now(),
  table_name       text not null,
  table_data       jsonb not null
);
alter table public.daily_backups enable row level security;
drop policy if exists "admin_only_backups" on public.daily_backups;
create policy "admin_only_backups" on public.daily_backups to service_role using (true) with check (true);

-- 3. Snapshot Function
create or replace function public.capture_daily_snapshot()
returns void
language plpgsql
security definer
as $$
begin
  insert into public.daily_backups (table_name, table_data) select 'profiles', coalesce(jsonb_agg(t), '[]'::jsonb) from public.profiles t;
  insert into public.daily_backups (table_name, table_data) select 'groups', coalesce(jsonb_agg(t), '[]'::jsonb) from public.groups t;
  insert into public.daily_backups (table_name, table_data) select 'memberships', coalesce(jsonb_agg(t), '[]'::jsonb) from public.memberships t;
  insert into public.daily_backups (table_name, table_data) select 'expenses', coalesce(jsonb_agg(t), '[]'::jsonb) from public.expenses t;
  insert into public.daily_backups (table_name, table_data) select 'transfers', coalesce(jsonb_agg(t), '[]'::jsonb) from public.transfers t;
  insert into public.daily_backups (table_name, table_data) select 'invites', coalesce(jsonb_agg(t), '[]'::jsonb) from public.invites t;
  
  delete from public.daily_backups where backup_timestamp < now() - interval '30 days';
end;
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'daily-backup';
select cron.schedule('daily-backup', '0 3 * * *', 'select public.capture_daily_snapshot()');
