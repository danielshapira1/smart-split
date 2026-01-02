// src/hooks/useRealtimeExpenses.ts
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Expense } from '../lib/types';

export type Transfer = {
  id: string;
  group_id: string;
  from_user: string;
  to_user: string;
  amount_cents: number;
  note: string | null;
  created_at: string;
};

const toInt = (v: unknown): number =>
  typeof v === 'string' ? parseInt(v, 10) : (typeof v === 'number' ? v : 0);

export function useRealtimeExpenses(groupId?: string | null) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  const load = useCallback(async () => {
    if (!groupId) {
      setExpenses([]);
      setTransfers([]);
      return;
    }

    // 1. Load Expenses
    const { data: expData, error: expError } = await supabase
      .from('expenses')
      .select(`
        id, group_id, user_id, amount_cents, currency,
        description, category, occurred_on, created_at,
        payer:profiles(display_name,email)
      `)
      .eq('group_id', groupId)
      .order('occurred_on', { ascending: false });

    if (expError) console.error('[useRealtimeData] expenses failed:', expError.message);

    const expRows: Expense[] = (expData ?? []).map((r: any) => ({
      id: r.id,
      group_id: r.group_id,
      user_id: r.user_id,
      amount_cents: toInt(r.amount_cents),
      currency: r.currency ?? null,
      description: r.description ?? null,
      category: r.category ?? null,
      occurred_on: r.occurred_on,
      created_at: r.created_at,
      payer: r.payer
        ? { display_name: r.payer.display_name ?? null, email: r.payer.email ?? null }
        : null,
      payer_name: r.payer_name ?? r.payer?.display_name ?? r.payer?.email ?? null,
    }));
    setExpenses(expRows);

    // 2. Load Transfers
    const { data: trData, error: trError } = await supabase
      .from('transfers')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });

    if (trError) console.error('[useRealtimeData] transfers failed:', trError.message);

    const trRows: Transfer[] = (trData ?? []).map((t: any) => ({
      ...t,
      amount_cents: toInt(t.amount_cents),
    }));
    setTransfers(trRows);

  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!groupId) return;

    const ch = supabase
      .channel(`room:${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` },
        () => load()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transfers', filter: `group_id=eq.${groupId}` },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [groupId, load]);

  return { expenses, transfers, refresh: load };
}
