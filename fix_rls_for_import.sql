-- ============================================================================
-- FIX RLS POLICIES TO ALLOW IMPORT / RECORDING FOR OTHERS
-- Run this script in the Supabase SQL Editor to enable the Import feature to work 
-- for expenses created by other users.
-- ============================================================================

-- 1. Update EXPENSES Policy
-- Old policy: "insert my expense" -> only allowed user_id = auth.uid()
-- New policy: "insert group expense" -> allows inserting for ANY user_id as long as:
--    a) The user inserting (auth.uid()) is a MEMBER of the group
--    b) (Optional but good) The target user_id is ALSO a member of the group (enforced by application logic usually, but we check group membership of auth.uid())

drop policy if exists "insert my expense" on public.expenses;
drop policy if exists "insert group expense" on public.expenses;

create policy "insert group expense"
on public.expenses for insert
with check (
  exists (
    select 1 from public.memberships m
    where m.group_id = expenses.group_id
      and m.user_id  = auth.uid()
  )
);

-- Note: We trust that the foreign key `user_id` -> `profiles(id)` ensures the user exists.
-- And checking `auth.uid()` membership ensures random strangers can't insert into your group.

-- 2. Update TRANSFERS Policy
-- Old policy: "insert my transfer or admin" -> allowed from/to = me OR admin
-- New policy: "insert group transfer" -> allows any member to record transfers between any members

drop policy if exists "insert my transfer or admin" on public.transfers;
drop policy if exists "insert group transfer" on public.transfers;

create policy "insert group transfer"
on public.transfers for insert
with check (
  exists (
    select 1 from public.memberships m
    where m.group_id = transfers.group_id
      and m.user_id  = auth.uid()
  )
);

-- Done!
