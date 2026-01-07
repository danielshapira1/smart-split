-- ============================================================================
-- BACKUP SYSTEM STANDALONE SCRIPT
-- Copy and run this ENTIRE file in the Supabase SQL Editor.
-- ============================================================================

-- 1. Enable pg_cron (requires superuser or specific Supabase setup)
create extension if not exists pg_cron with schema public;

-- 2. Create Backups Table
create table if not exists public.daily_backups (
  id               uuid primary key default gen_random_uuid(),
  backup_timestamp timestamptz default now(),
  table_name       text not null,
  table_data       jsonb not null
);

-- RLS: Only admins/service role should access backups
alter table public.daily_backups enable row level security;

-- Drop policy if it exists to allow re-running this script without error
drop policy if exists "admin_only_backups" on public.daily_backups;

create policy "admin_only_backups"
  on public.daily_backups
  to service_role
  using (true)
  with check (true);

-- 3. Snapshot Function
create or replace function public.capture_daily_snapshot()
returns void
language plpgsql
security definer
as $$
declare
  t text;
begin
  -- Real implementation with individual inserts safely
  insert into public.daily_backups (table_name, table_data)
  select 'profiles', coalesce(jsonb_agg(t), '[]'::jsonb) from public.profiles t;

  insert into public.daily_backups (table_name, table_data)
  select 'groups', coalesce(jsonb_agg(t), '[]'::jsonb) from public.groups t;

  insert into public.daily_backups (table_name, table_data)
  select 'memberships', coalesce(jsonb_agg(t), '[]'::jsonb) from public.memberships t;

  insert into public.daily_backups (table_name, table_data)
  select 'expenses', coalesce(jsonb_agg(t), '[]'::jsonb) from public.expenses t;

  insert into public.daily_backups (table_name, table_data)
  select 'transfers', coalesce(jsonb_agg(t), '[]'::jsonb) from public.transfers t;
  
  insert into public.daily_backups (table_name, table_data)
  select 'invites', coalesce(jsonb_agg(t), '[]'::jsonb) from public.invites t;

  -- Auto-cleanup: keep only last 30 days
  delete from public.daily_backups
  where backup_timestamp < now() - interval '30 days';
end;
$$;

-- 4. Schedule Job (At 03:00 AM every day)
-- Safely remove existing job if it exists to avoid duplicates or errors
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'daily-backup';

-- Schedule the new job
select cron.schedule('daily-backup', '0 3 * * *', 'select public.capture_daily_snapshot()');
