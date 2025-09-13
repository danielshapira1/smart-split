import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { LogOut, Plus } from 'lucide-react'

import { supabase, ensureProfileForCurrentUser } from './lib/supabaseClient'
import { GroupSwitcher } from './components/GroupSwitcher'
import { InviteButton } from './components/InviteButton'
import { ExpenseForm } from './components/ExpenseForm'
import BalancesPanel from './components/BalancesPanel'
import { useRealtimeExpenses } from './hooks/useRealtimeExpenses'

import type { Group, Profile } from './lib/types'
import type { Member } from './lib/settlements'

/* ---------- Types used here ---------- */
export type Expense = {
  id: string
  group_id: string
  user_id: string
  amount_cents: number
  currency: string
  description: string
  category: string
  occurred_on: string
  created_at: string
  payer_name?: string
}

const CATEGORIES = ['סופר', 'דלק', 'שכירות', 'בילויים', 'מסעדות', 'נסיעות', 'קניות', 'חשבונות', 'אחר']

/* ---------- App ---------- */
export default function App() {
  const [session, setSession] = useState<import('@supabase/supabase-js').Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)

  const [groups, setGroups] = useState<Group[]>([])
  const [group, setGroup] = useState<Group | null>(null)
  const [role, setRole] = useState<string>('member')

  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [tab, setTab] = useState<'expenses' | 'balances'>('expenses')

  // חברי הקבוצה למאזנים
  const [members, setMembers] = useState<Member[]>([])

  /* ----- auth ----- */
  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange((_e, s) => setSession(s)).data
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      setSession(data.session ?? null)
    })()
    return () => sub?.subscription?.unsubscribe?.()
  }, [])

  // ודא שקיים פרופיל לאחר התחברות
  useEffect(() => {
    if (!session) return
    ;(async () => {
      try {
        await ensureProfileForCurrentUser()
      } catch {
        // מתעלמים בשקט
      }
    })()
  }, [session])

  /* ----- profile + groups (טעינה ראשונית) ----- */
  useEffect(() => {
    if (!session) return

    ;(async () => {
      try {
        const uid = session.user.id

        // פרופיל
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', uid)
          .maybeSingle<Profile>()
        setProfile(prof ?? null)

        // חברות בקבוצות (ללא join בעייתי)
        const { data: memRows, error: memErr } = await supabase
          .from('memberships')
          .select('group_id, role')
          .eq('user_id', uid)

        if (memErr) throw memErr
        const mems = (memRows ?? []) as Array<{ group_id: string; role: string }>

        // משוך את פרטי הקבוצות לפי מזהים
        const groupIds = [...new Set(mems.map((m) => m.group_id))]
        let gs: Group[] = []
        if (groupIds.length) {
          const { data: gRows, error: gErr } = await supabase
            .from('groups')
            .select('*')
            .in('id', groupIds)

          if (gErr) throw gErr
          gs = (gRows ?? []) as Group[]
        }

        setGroups(gs)

        // בחר קבוצה נוכחית אם אין
        const firstGroup = gs[0] as Group | undefined
        if (!group && firstGroup) setGroup(firstGroup)

        // קבע תפקיד בהתאם לקבוצה הנוכחית / הראשונה, עם בדיקות בטוחות
        if (group && mems.length) {
          const found = mems.find((m) => m.group_id === group.id)
          if (found?.role) setRole(found.role)
        } else if (!group && firstGroup && mems.length) {
          const found = mems.find((m) => m.group_id === firstGroup.id)
          if (found?.role) setRole(found.role)
        }
      } catch (err) {
        console.error('initial load failed:', err)
      }
    })()
  }, [session]) // לא תלוי ב-group כדי למנוע לולאה

  // הבאת תפקיד לפי קבוצה נוכחית בכל שינוי קבוצה
  useEffect(() => {
    if (!session || !group) return
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('memberships')
          .select('role')
          .eq('group_id', group.id)
          .eq('user_id', session.user.id)
          .maybeSingle()

        if (!error && data) setRole(data.role)
      } catch {}
    })()
  }, [group?.id, session?.user.id])

  /* ----- קבלה מהירה של הזמנה מה-URL (?invite=) ----- */
  useEffect(() => {
    if (!session) return

    ;(async () => {
      const url = new URL(window.location.href)
      const token = url.searchParams.get('invite')
      if (!token) return

      try {
        const { error } = await supabase.rpc('accept_invite', { p_token: token })
        if (error) {
          console.error('accept_invite failed:', error.message)
        } else {
          // רענון קבוצות לאחר הצטרפות
          const { data: mems } = await supabase
            .from('memberships')
            .select('group_id')
            .eq('user_id', session.user.id)

          const ids = [...new Set((mems ?? []).map((m: any) => m.group_id))]
          if (ids.length) {
            const { data: gRows } = await supabase.from('groups').select('*').in('id', ids)
            const gs = (gRows ?? []) as Group[]
            setGroups(gs)
            if (gs[0]) setGroup(gs[0])
          }
        }
      } finally {
        // נקה את הפרמטר מהכתובת
        url.searchParams.delete('invite')
        window.history.replaceState({}, '', url.toString())
      }
    })()
  }, [session])

  /* ----- realtime expenses ----- */
  const { expenses, refresh } = useRealtimeExpenses(group?.id)

  /* ----- load members for current group (ללא JOIN; שני שלבים) ----- */
  useEffect(() => {
    if (!group) {
      setMembers([])
      return
    }

    ;(async () => {
      try {
        // 1) כל המשתמשים החברים בקבוצה
        const { data: memRows, error: e1 } = await supabase
          .from('memberships')
          .select('user_id')
          .eq('group_id', group.id)

        if (e1) throw e1

        const ids = [...new Set((memRows ?? []).map((r: any) => r.user_id))]
        if (ids.length === 0) {
          setMembers([])
          return
        }

        // 2) פרופילים עבור אותם משתמשים
        const { data: profRows, error: e2 } = await supabase
          .from('profiles')
          .select('id, display_name, email')
          .in('id', ids)

        if (e2) throw e2

        const byId = new Map((profRows ?? []).map((p: any) => [p.id, p]))
        const ms: Member[] = ids.map((id) => ({
          uid: id,
          user_id: id,
          name: byId.get(id)?.display_name || byId.get(id)?.email || id,
        }))

        setMembers(ms)
      } catch (err) {
        console.error('load members failed:', err)
        setMembers([])
      }
    })()
  }, [group?.id])

  /* ----- filters + totals ----- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return expenses.filter((e) => {
      const okCat = !category || e.category === category
      const okSearch = !q || (e.description ?? '').toLowerCase().includes(q)
      return okCat && okSearch
    })
  }, [expenses, search, category])

  const total = useMemo(
    () => filtered.reduce((sum, e) => sum + (e?.amount_cents ?? 0), 0),
    [filtered]
  )

  const currentPayerName =
    profile?.display_name ||
    profile?.email ||
    (session?.user?.email ?? 'משתמש')

  /* ----- actions ----- */
  const signOut = async () => {
    try {
      // הימנע מ־403: scope='local'
      await supabase.auth.signOut({ scope: 'local' })
      setSession(null)
    } catch (e) {
      console.error('signOut failed', e)
    }
  }

  // יצירת קבוצה חדשה – RPC + נפילת גיבוי
  const createGroup = async () => {
    const name = prompt('שם קבוצה חדש:')?.trim()
    if (!name || !session) return

    // RPC תחילה
    try {
      const rpc = await supabase.rpc('create_group', { p_name: name })
      const row = (rpc as any)?.data as Group | null
      const error = (rpc as any)?.error as { message?: string } | null

      if (!error && row) {
        setGroups((prev) => [row, ...prev])
        setGroup(row)
        setRole('owner')
        return
      }
    } catch {
      // fallback
    }

    // Fallback: יצירה ידנית + חברות owner
    try {
      const { data: gRaw, error: e1 } = await supabase
        .from('groups')
        .insert({ name })
        .select('*')
        .maybeSingle()

      if (e1 || !gRaw) throw e1 ?? new Error('יצירת קבוצה נכשלה')
      const g = gRaw as Group

      const { error: e2 } = await supabase.from('memberships').insert({
        group_id: g.id,
        user_id: session.user.id,
        role: 'owner',
      })
      if (e2) console.warn('הוספת חברות נכשלה:', e2.message)

      setGroups((prev) => [g, ...prev])
      setGroup(g)
      setRole('owner')
    } catch (err: any) {
      console.error('[createGroup] error', err)
      alert(err?.message ?? 'יצירת קבוצה נכשלה')
    }
  }

  /* ----- guards ----- */
  if (!session) return <AuthScreen />

  if (!group) {
    return (
      <div className='h-full flex flex-col items-center justify-center gap-4 px-4'>
        <p className='text-gray-600 text-center'>אין קבוצה עדיין — צור קבוצה חדשה או הצטרף מההזמנה.</p>
        <button
          className='rounded-full bg-black text-white px-4 py-2'
          onClick={createGroup}
        >
          צור קבוצה חדשה
        </button>
      </div>
    )
  }

  /* ---------- render ---------- */
  return (
    <div className='max-w-md mx-auto h-full flex flex-col'>
      {/* header */}
      <header className='sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center gap-2'>
        <GroupSwitcher
          groups={groups}
          current={group}
          onSelect={setGroup}
          onCreated={(g) => {
            setGroups((prev) => [g, ...prev])
            setGroup(g)
          }}
        />
        {/* כפתור פלוס לגיבוי */}
        <button
          onClick={createGroup}
          className='rounded-full p-2 border hover:bg-slate-50'
          title='קבוצה חדשה'
        >
          <Plus className='w-4 h-4' />
        </button>

        <div className='flex-1' />
        <InviteButton groupId={group.id} isAdmin={role === 'owner' || role === 'admin'} />
        <button onClick={signOut} className='text-sm text-red-600 flex items-center gap-1'>
          <LogOut className='w-4 h-4' /> יציאה
        </button>
      </header>

      {/* top summary line */}
      <div className='px-4 pt-2 text-sm text-gray-600'>
        {filtered.length > 0 ? `סה"כ נבחר: ₪${(total / 100).toFixed(2)}` : 'אין תוצאות להצגה'}
      </div>

      {/* search + filter */}
      <div className='px-4 pt-3 flex gap-2'>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='חיפוש תיאור...'
          className='flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black'
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className='rounded-xl border px-3 py-2 text-sm outline-none'
        >
          <option value=''>כל הקטגוריות</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* tabs */}
      <nav className='px-4 pt-2 flex gap-2'>
        <button
          onClick={() => setTab('expenses')}
          className={clsx(
            'px-3 py-2 rounded-full text-sm',
            tab === 'expenses' ? 'bg-black text-white' : 'bg-slate-100'
          )}
        >
          הוצאות
        </button>
        <button
          onClick={() => setTab('balances')}
          className={clsx(
            'px-3 py-2 rounded-full text-sm',
            tab === 'balances' ? 'bg-black text-white' : 'bg-slate-100'
          )}
        >
          מאזנים
        </button>
      </nav>

      {/* content */}
      {tab === 'expenses' ? (
        <main className='flex-1 overflow-y-auto px-4 py-3'>
          {filtered.length === 0 ? (
            <p className='text-gray-500 text-center mt-10'>
              אין הוצאות — לחץ על הפלוס למטה כדי להוסיף.
            </p>
          ) : (
            <ul className='space-y-3'>
              {filtered.map((e) => (
                <li
                  key={e.id}
                  className='bg-white rounded-2xl shadow p-3 flex items-center justify-between'
                >
                  <div>
                    <div className='font-medium'>{e.description || 'ללא תיאור'}</div>
                    <div className='text-xs text-gray-500'>
                      קטגוריה: {e.category} ·{' '}
                      {new Date(e.occurred_on).toLocaleDateString('he-IL')} · שולם ע"י{' '}
                      {e.payer_name || e.user_id}
                    </div>
                  </div>
                  <div className='text-right'>
                    <div className='font-bold'>₪{(e.amount_cents / 100).toFixed(2)}</div>
                    <div className='text-[11px] text-gray-500'>{e.currency}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </main>
      ) : (
        <BalancesPanel members={members} expenses={expenses} currency="ILS" />
      )}

      {/* footer add */}
      {tab === 'expenses' && (
        <footer className='sticky bottom-0 bg-white border-t p-3'>
          <div className='flex items-center justify-between'>
            <div className='text-gray-600 text-sm'>
              סה"כ: <span className='font-semibold'>₪{(total / 100).toFixed(2)}</span>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className={clsx(
                'px-4 py-2 rounded-full shadow bg-black text-white flex items-center gap-1 active:scale-[.98]'
              )}
            >
              <Plus className='w-4 h-4' /> הוסף הוצאה
            </button>
          </div>
        </footer>
      )}

      {/* modal */}
      {showForm && (
        <ExpenseForm
          groupId={group.id}
          currentPayerName={currentPayerName}
          categories={CATEGORIES}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}

/* ---------- Auth screen ---------- */
function AuthScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const google = async () => {
    const base = import.meta.env.BASE_URL || '/'
    const redirectTo = `${window.location.origin}${base}`
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    })
    if (error) setError(error.message)
  }

  const sendMagic = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const base = import.meta.env.BASE_URL || '/'
    const redirectTo = `${window.location.origin}${base}`
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo }
    })
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className='h-full max-w-sm mx-auto flex flex-col items-center justify-center p-4'>
      <h1 className='text-2xl font-bold mb-2'>הוצאות ביחד</h1>
      <p className='text-gray-500 mb-6 text-center'>התחברות מהירה</p>
      <div className='w-full space-y-3'>
        <button
          onClick={google}
          className='w-full rounded-xl bg-red-600 text-white py-3 font-medium active:scale-[.99]'
        >
          התחברות עם Google
        </button>
        <div className='text-center text-xs text-gray-500'>או התחברות עם קישור למייל</div>
        <form onSubmit={sendMagic} className='w-full space-y-3'>
          <input
            type='email'
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder='המייל שלך'
            className='w-full rounded-xl border px-3 py-3 outline-none focus:ring-2 focus:ring-black'
          />
          <button className='w-full rounded-xl bg-black text-white py-3 font-medium active:scale-[.99]'>
            שלח לי קישור
          </button>
        </form>
      </div>
      {sent && <p className='text-green-600 mt-3'>נשלח קישור למייל אם הוא קיים במערכת.</p>}
      {error && <p className='text-red-600 mt-3'>{error}</p>}
    </div>
  )
}
