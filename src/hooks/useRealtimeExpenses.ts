// src/hooks/useRealtimeExpenses.ts
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Expense } from '../lib/types';

const toInt = (v: unknown): number =>
  typeof v === 'string' ? parseInt(v, 10) : (typeof v === 'number' ? v : 0);

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
        payer:profiles!expenses_user_id_fkey(display_name,email),
        payer_name
      `)
      .eq('group_id', groupId)
      .order('occurred_on', { ascending: false });

    if (error) {
      console.error('[useRealtimeExpenses] load failed:', error.message);
      setExpenses([]);
      return;
    }

    // נרמול נתונים + fallback לשם המשלם
    const rows: Expense[] = (data ?? []).map((r: any) => ({
      id: r.id,
      group_id: r.group_id,
      user_id: r.user_id,
      amount_cents: toInt(r.amount_cents),
      currency: r.currency ?? null,
      description: r.description ?? null,
      category: r.category ?? null,
      occurred_on: r.occurred_on,
      created_at: r.created_at,
      // נשמור גם את אובייקט payer מה-join (לפי הטייפ המעודכן)
      payer: r.payer
        ? { display_name: r.payer.display_name ?? null, email: r.payer.email ?? null }
        : null,
      // ואם אין payer_name בעמודה - ננחזיר תצוגה מה-join
      payer_name: r.payer_name ?? r.payer?.display_name ?? r.payer?.email ?? null,
    }));

    setExpenses(rows);
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!groupId) return;

    // ערוץ מסונן לפי הקבוצה כדי למנוע אירועים לא רלוונטיים
    const ch = supabase
      .channel(`expenses:${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` },
        () => load()
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {
        /* no-op */
      }
    };
  }, [groupId, load]);

  return { expenses, refresh: load };
}
