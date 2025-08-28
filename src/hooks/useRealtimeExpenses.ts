import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

type Expense = { id: string; group_id: string; user_id: string; amount_cents: number; currency: string; description: string; category: string; occurred_on: string; created_at: string, payer_name?: string }

export function useRealtimeExpenses(groupId?: string | null) {
  const [expenses, setExpenses] = useState<Expense[]>([])

  async function load() {
    if (!groupId) return
    const { data, error } = await supabase
      .from('expenses_with_names')
      .select('*')
      .eq('group_id', groupId)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
    if (!error && data) setExpenses(data as Expense[])
  }

  useEffect(() => { load() }, [groupId])

  useEffect(() => {
    if (!groupId) return
    const channel = supabase
      .channel('expenses-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` }, (_payload) => { load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers', filter: `group_id=eq.${groupId}` }, (_payload) => { /* balances changed */ })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [groupId])

  return { expenses, refresh: load }
}
