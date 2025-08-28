// src/components/BalancesPanel.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { Check } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'

type BalanceRow = { group_id: string; user_id: string; net_cents: number }
type Profile = { id: string; email: string|null; display_name: string|null }

export function BalancesPanel({ groupId }:{ groupId: string }) {
  const [rows, setRows] = useState<BalanceRow[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})

  const load = async () => {
    const { data } = await supabase.from('net_balances').select('*').eq('group_id', groupId)
    const rs = (data || []) as BalanceRow[]
    setRows(rs)
    const ids = Array.from(new Set(rs.map(r => r.user_id)))
    if (ids.length) {
      const { data: p } = await supabase.from('profiles').select('*').in('id', ids)
      const map: Record<string, Profile> = {}
      ;(p||[]).forEach(pr => { if (pr && pr.id) map[pr.id] = pr as Profile })
      setProfiles(map)
    } else {
      setProfiles({})
    }
  }

  useEffect(()=>{ load() }, [groupId])

  const chartData = useMemo(
    () => rows.map(r => ({
      name: display(profiles[r.user_id as string] /* יכול להיות undefined וזה בסדר לפונקציה */),
      value: Math.round((r.net_cents || 0)/100),
    })),
    [rows, profiles]
  )

  // אלגוריתם חמדן לסגירת חוב
  const suggestions = useMemo(() => {
    const debtors = rows
      .filter(r => (r.net_cents || 0) < 0)
      .map(r => ({ id: r.user_id, amt: -(r.net_cents || 0) }))
    const creditors = rows
      .filter(r => (r.net_cents || 0) > 0)
      .map(r => ({ id: r.user_id, amt: (r.net_cents || 0) }))

    debtors.sort((a,b)=>b.amt-a.amt)
    creditors.sort((a,b)=>b.amt-a.amt)

    const acts: { from: string; to: string; cents: number }[] = []
    let i=0, j=0
    while (i<debtors.length && j<creditors.length) {
      const d = debtors[i]!   // non-null assertion: בטוח קיים כי בדקנו בתנאי ה-while
      const c = creditors[j]!
      const take = Math.min(d.amt, c.amt)
      acts.push({ from: d.id, to: c.id, cents: Math.round(take) })
      d.amt -= take
      c.amt -= take
      if (d.amt <= 1) i++
      if (c.amt <= 1) j++
    }
    return acts
  }, [rows])

  const settle = async (from: string, to: string, cents: number) => {
    await supabase.from('transfers').insert({ group_id: groupId, from_user: from, to_user: to, amount_cents: Math.round(cents) })
    await load()
  }

  return (
    <div className='px-4 py-4 space-y-4'>
      <div className='bg-white dark:bg-slate-800 rounded-2xl shadow p-3'>
        <h3 className='font-semibold mb-2'>מאזן לכל משתמש (₪)</h3>
        <div className='h-48'>
          <ResponsiveContainer width='100%' height='100%'>
            <BarChart data={chartData}>
              <XAxis dataKey='name' />
              <YAxis />
              <Tooltip />
              <Bar dataKey='value' />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className='bg-white dark:bg-slate-800 rounded-2xl shadow p-3'>
        <h3 className='font-semibold mb-3'>הצעות לסגירת חשבון</h3>
        {suggestions.length === 0 ? (
          <p className='text-gray-500 text-sm'>אין חובות פתוחים.</p>
        ) : (
          <ul className='space-y-2'>
            {suggestions.map((s, idx) => (
              <li key={idx} className='flex items-center justify-between'>
                <div className='text-sm'>
                  <b>{display(profiles[s.from])}</b> → <b>{display(profiles[s.to])}</b> — ₪{(s.cents/100).toFixed(2)}
                </div>
                <button onClick={()=>settle(s.from, s.to, s.cents)} className='text-sm bg-black text-white rounded-full px-3 py-1 flex items-center gap-1'>
                  <Check className='w-4 h-4'/> ביצעתי
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function display(p?: Profile) {
  if (!p) return 'לא ידוע'
  return p.display_name || p.email || 'ללא שם'
}
