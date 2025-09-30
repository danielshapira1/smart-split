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

/* ---------- Local types ---------- */
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

  // זיהוי מי מחובר + הודעת-פלש
  const [whoami, setWhoami] = useState<string>('')
  const [flash, setFlash] = useState<string | null>(null)

  /* ----- auth ----- */
  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange((_e, s) => setSession(s)).data
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    return () => sub?.subscription?.unsubscribe?.()
  }, [])

  useEffect(() => {
    if (!session) { setWhoami(''); return }
    const emailOrId = session.user.email ?? session.user.id
    setWhoami(emailOrId)
  }, [session])

  // ודא שקיים פרופיל לאחר התחברות
  useEffect(() => {
    if (!session) return
    ensureProfileForCurrentUser().catch(() => {})
  }, [session])

  /* ----- helper: ריענון קבוצות ובחירת קבוצה יעד ----- */
  const refreshGroups = React.useCallback(
    async (targetGroupId?: string | null) => {
      if (!session) return
      const uid = session.user.id

      const { data: mems } = await supabase
        .from('memberships')
        .select('groups(*)')
        .eq('user_id', uid)

      const gs: Group[] = (mems ?? []).map((m: any) => m.groups).filter(Boolean)
      setGroups(gs)

      // אם יש group_id יעד (מההצטרפות) – נעדיף אותו; אחרת נשמור/נבחר ראשונה
      setGroup(prev => {
        const pickId = targetGroupId ?? prev?.id ?? gs[0]?.id ?? null
        return gs.find(g => g.id === pickId) ?? gs[0] ?? null
      })
    },
    [session]
  )

  /* ----- profile + groups ----- */
  useEffect(() => {
    if (!session) return
    ;(async () => {
      await refreshGroups(null)

      // פרופיל
      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle<Profile>()
      setProfile(prof ?? null)
    })()
  }, [session, refreshGroups])

  /* ----- role for current group ----- */
  useEffect(() => {
    if (!session || !group) {
      setRole('member')
      return
    }
    ;(async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('role')
        .eq('user_id', session.user.id)
        .eq('group_id', group.id)
        .maybeSingle()

      if (error) {
        console.warn('load role failed:', error.message)
        setRole('member')
        return
      }
      setRole(data?.role ?? 'member')
    })()
  }, [session?.user?.id, group?.id])

  /* ----- קבלה מהירה של הזמנה מה-URL (?invite= או ?token=)  ----- */
  useEffect(() => {
    if (!session) return
    const url = new URL(window.location.href)
    const token = url.searchParams.get('invite') || url.searchParams.get('token')
    if (!token) return

    ;(async () => {
      const { data, error } = await supabase.rpc('accept_invite', { p_token: token })
      if (error) {
        alert('שגיאה בהצטרפות לקבוצה: ' + error.message)
      } else {
        // data: { joined, already_member, group_id, group_name }
        const gid = (data as any)?.group_id ?? null
        const gname = (data as any)?.group_name ?? ''
        const already = !!(data as any)?.already_member

        await refreshGroups(gid)           // רענון מיידי
        setTimeout(() => refreshGroups(gid), 1200) // רענון מאוחר – סוגר פינות latency

        setFlash(already
          ? `את/ה כבר חבר/ה ב"${gname}"`
          : `הצטרפת ל"${gname}" בהצלחה`)
        window.setTimeout(() => setFlash(null), 3000)
      }

      // הסרת הפרמטרים כדי שלא יחזור ברענון
      url.searchParams.delete('invite')
      url.searchParams.delete('token')
      window.history.replaceState({}, '', url.toString())
    })()
  }, [session, refreshGroups])

  /* ----- realtime: כל שינוי בחברות של המשתמש => רענון ----- */
  useEffect(() => {
    if (!session) return
    const ch = supabase
      .channel('rt-memberships-self')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'memberships', filter: `user_id=eq.${session.user.id}` },
        () => refreshGroups()
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [session, refreshGroups])

  /* ----- realtime expenses ----- */
  const { expenses, refresh } = useRealtimeExpenses(group?.id)

  /* ----- load members for current group (with explicit FK alias) ----- */
  useEffect(() => {
    if (!group) {
      setMembers([])
      return
    }

    ;(async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select(`
          user_id,
          profiles:profiles!memberships_user_id_fkey (
            id,
            display_name,
            email
          )
        `)
        .eq('group_id', group.id)

      if (error) {
        console.error('load members failed:', error.message)
        setMembers([])
        return
      }

      const ms: Member[] = (data ?? []).map((m: any) => ({
        uid: m.user_id,
        user_id: m.user_id,
        name: m.profiles?.display_name || m.profiles?.email || m.user_id,
      }))

      setMembers(ms)
    })()
  }, [group])

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
    await supabase.auth.signOut()
  }

  // יצירת קבוצה חדשה – RPC ואם לא מצליח נופלים ל־INSERT רגיל + חברות
  const createGroup = async () => {
    const name = prompt('שם קבוצה חדש:')?.trim()
    if (!name || !session) return

    try {
      const rpc = await supabase.rpc('create_group', { p_name: name })
      const row = (rpc as any)?.data as Group | null
      const error = (rpc as any)?.error as { message?: string } | null

      if (!error && row) {
        setGroups((prev) => [row, ...prev])
        setGroup(row)
        setRole('owner')
        setFlash(`נוצרה קבוצה "${row.name}"`)
        setTimeout(() => setFlash(null), 2500)
        return
      }
    } catch {
      // נמשיך ל-fallback
    }

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
      setFlash(`נוצרה קבוצה "${g.name}"`)
      setTimeout(() => setFlash(null), 2500)
    } catch (err: any) {
      console.error('[createGroup] error', err)
      alert(err?.message ?? 'יצירת קבוצה נכשלה')
    }
  }

  /* ----- guards ----- */
  if (!session) return <AuthScreen />

  if (!group) {
    return (
      <div className='h-full flex flex-col items-center justify-center gap-4'>
        {whoami && (
          <div className='px-4 py-2 bg-slate-50 text-slate-600 text-xs rounded'>
            מחובר כ־ <span className='font-medium'>{whoami}</span>
          </div>
        )}
        {flash && (
          <div className='px-3 py-2 rounded bg-emerald-50 text-emerald-800 text-sm'>
            {flash}
          </div>
        )}
        <p className='text-gray-600'>אין קבוצה עדיין — צור קבוצה חדשה או הצטרף מההזמנה.</p>
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
      {/* who-am-i + flash (top) */}
      {whoami && (
        <div className='px-4 py-2 bg-slate-50 text-slate-600 text-xs'>
          מחובר כ־ <span className='font-medium'>{whoami}</span>
        </div>
      )}
      {flash && (
        <div className='fixed top-3 right-3 z-50 bg-black text-white text-sm px-3 py-2 rounded-xl shadow'>
          {flash}
        </div>
      )}

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
