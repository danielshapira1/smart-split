import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Expense } from '../lib/types';

const toInt = (v: any) => (typeof v === 'string' ? parseInt(v, 10) : (v ?? 0));

export function useRealtimeExpenses(groupId?: string | null) {
  const [expenses, setExpenses] = useState<Expense[]>([]);

  const load = useCallback(async () => {
    if (!groupId) {
      setExpenses([]);
      return;
    }
    const { data, error } = await supabase
      .from('expenses')
      .select(`
        id, group_id, user_id, amount_cents, currency,
        description, category, occurred_on, created_at,
        payer:profiles!expenses_user_id_fkey ( display_name, email )
      `)
      .eq('group_id', groupId)
      .order('occurred_on', { ascending: false });

    if (error) {
      console.error('load expenses failed:', error.message);
      setExpenses([]);
      return;
    }

    const rows: Expense[] = (data ?? []).map((r: any) => ({
      id: r.id,
      group_id: r.group_id,
      user_id: r.user_id,
      amount_cents: toInt(r.amount_cents), // ← חשוב!
      currency: r.currency,
      description: r.description,
      category: r.category,
      occurred_on: r.occurred_on,
      created_at: r.created_at,
      payer_name: r.payer?.display_name || r.payer?.email || null,
    }));

    setExpenses(rows);
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!groupId) return;
    const ch = supabase
      .channel('rt-expenses')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, payload => {
        const row = payload.new as any;
        // מסננים לפי group_id כדי לא לרענן לחינם
        if (!row || row.group_id !== groupId) return;
        load();
      })
      .subscribe();

    return () => {
      try { supabase.removeChannel(ch); } catch {}
    };
  }, [groupId, load]);

  return { expenses, refresh: load };
}
