import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import { Plus, LogOut } from 'lucide-react'
import { ExpenseForm } from './components/ExpenseForm'
import { GroupSwitcher } from './components/GroupSwitcher'
import { InviteButton } from './components/InviteButton'
import { BalancesPanel } from './components/BalancesPanel'
import { useRealtimeExpenses } from './hooks/useRealtimeExpenses'
import clsx from 'clsx'

type Profile = { id: string; email: string | null; display_name: string | null }
type Group = { id: string; name: string }
type Expense = {
  id: string; group_id: string; user_id: string;
  amount_cents: number; currency: string; description: string;
  category: string; occurred_on: string; created_at: string; payer_name?: string
}

const CATEGORIES = ['סופר','דלק','שכירות','בילויים','מסעדות','נסיעות','קניות','חשבונות','אחר']

export default function App() {
  const [session, setSession] = useState<import('@supabase/supabase-js').Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [group, setGroup] = useState<Group | null>(null)
  const [role, setRole] = useState<string>('member')
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('')
  const [tab, setTab] = useState<'expenses'|'balances'>('expenses')

  // --- Auth session ---
  useEffect(() => {
    const run = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setSession(session ?? null)
      supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    }
    run()
  }, [])

  // --- Load profile + groups after login ---
  useEffect(() => {
    const load = async () => {
      if (!session) return

      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle()
      setProfile(prof)

      const { data: mems } = await supabase
        .from('memberships')
        .select('groups(*), role')
        .eq('user_id', session.user.id)

      const gs: Group[] = (mems || []).map((m: any) => m.groups).filter(Boolean)
      setGroups(gs)
      if (!group && gs[0]) setGroup(gs[0])
      if (mems && mems[0]) setRole(mems[0].role)
    }
    load()
  }, [session])

  // --- Accept invite from URL ?invite=token ---
  useEffect(() => {
    const url = new URL(window.location.href)
    const token = url.searchParams.get('invite')
    if (!token || !session) return

    supabase.rpc('accept_invite', { p_token: token })
      .then(async ({ error }) => {
        if (!error) {
          const { data: mems } = await supabase
            .from('memberships')
            .select('groups(*), role')
            .eq('user_id', session.user.id)

          const gs: Group[] = (mems || []).map((m: any) => m.groups).filter(Boolean)
          setGroups(gs)
          if (gs[0]) setGroup(gs[0])

          url.searchParams.delete('invite')
          window.history.replaceState({}, '', url.toString())
        } else {
          console.error(error.message)
        }
      })
  }, [session])

  const { expenses, refresh } = useRealtimeExpenses(group?.id)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return expenses.filter(e => {
      const okCat = !category || e.category === category
      const okSearch = !q || (e.description?.toLowerCase().includes(q))
      return okCat && okSearch
    })
  }, [expenses, search, category])

  const total = useMemo(() => filtered.reduce((sum, e) => sum + e.amount_cents, 0), [filtered])

  const signOut = async () => { await supabase.auth.signOut() }

  if (!session) return <AuthScreen />

  if (!group) return (
    <div className='h-full flex items-center justify-center text-gray-600'>
      אין קבוצה עדיין — צור קבוצה חדשה מהתפריט.
    </div>
  )

  return (
    <div className='max-w-md mx-auto h-full flex flex-col'>
      <header className='sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center gap-2'>
        <GroupSwitcher
          groups={groups}
          current={group}
          onSelect={setGroup}
          onCreated={g => { setGroups(prev => [g, ...prev]); setGroup(g); }}
        />
        <div className='flex-1' />
        <InviteButton groupId={group.id} isAdmin={role === 'owner' || role === 'admin'} />
        <button onClick={signOut} className='text-sm text-red-600 flex items-center gap-1'>
          <LogOut className='w-4 h-4' /> יציאה
        </button>
      </header>

      <div className='px-4 pt-3 flex gap-2'>
        <input
          value={search}
          onChange={e=>setSearch(e.target.value)}
          placeholder='חיפוש תיאור...'
          className='flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black'
        />
        <select
          value={category}
          onChange={e=>setCategory(e.target.value)}
          className='rounded-xl border px-3 py-2 text-sm outline-none'
        >
          <option value=''>כל הקטגוריות</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <nav className='px-4 pt-2 flex gap-2'>
        <button
          onClick={()=>setTab('expenses')}
          className={clsx('px-3 py-2 rounded-full text-sm', tab==='expenses'?'bg-black text-white':'bg-slate-100')}
        >
          הוצאות
        </button>
        <button
          onClick={()=>setTab('balances')}
          className={clsx('px-3 py-2 rounded-full text-sm', tab==='balances'?'bg-black text-white':'bg-slate-100')}
        >
          מאזנים
        </button>
      </nav>

      {tab === 'expenses' ? (
        <main className='flex-1 overflow-y-auto px-4 py-3'>
          {filtered.length === 0 ? (
            <p className='text-gray-500 text-center mt-10'>אין הוצאות — לחץ על הפלוס למטה כדי להוסיף.</p>
          ) : (
            <ul className='space-y-3'>
              {filtered.map((e: Expense) => (
                <li key={e.id} className='bg-white rounded-2xl shadow p-3 flex items-center justify-between'>
                  <div>
                    <div className='font-medium'>{e.description || 'ללא תיאור'}</div>
                    <div className='text-xs text-gray-500'>
                      קטגוריה: {e.category} · {new Date(e.occurred_on).toLocaleDateString('he-IL')} · שולם ע"י {e.payer_name || e.user_id}
                    </div>
                  </div>
                  <div className='text-right'>
                    <div className='font-bold'>₪{(e.amount_cents/100).toFixed(2)}</div>
                    <div className='text-[11px] text-gray-500'>{e.currency}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </main>
      ) : (
        <BalancesPanel groupId={group.id} />
      )}

      {tab==='expenses' && (
        <footer className='sticky bottom-0 bg-white border-t p-3'>
          <div className='flex items-center justify-between'>
            <div className='text-gray-600 text-sm'>
              סה"כ: <span className='font-semibold'>₪{(total/100).toFixed(2)}</span>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className='px-4 py-2 rounded-full shadow bg-black text-white flex items-center gap-1 active:scale-[.98]'
            >
              <Plus className='w-4 h-4'/> הוסף הוצאה
            </button>
          </div>
        </footer>
      )}

      {showForm && (
        <ExpenseForm
          groupId={group.id}
          onClose={() => { setShowForm(false); refresh(); }}
          categories={CATEGORIES}
        />
      )}
    </div>
  )
}

/** מסך התחברות – עם redirectTo נכון הכולל BASE_URL */
function AuthScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // תמיד לחשב redirect עם base (ב-GitHub Pages זה /smart-split/)
  const base = import.meta.env.BASE_URL || '/'
  const redirectTo = `${window.location.origin}${base}`

  const handleEmailMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })
    if (error) setError(error.message)
    else setSent(true)
  }

  const handleGoogleLogin = async () => {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) setError(error.message)
  }

  return (
    <div className='h-full max-w-sm mx-auto flex flex-col items-center justify-center p-4'>
      <h1 className='text-2xl font-bold mb-2'>הוצאות ביחד</h1>
      <p className='text-gray-500 mb-6 text-center'>התחברות מהירה</p>

      <div className='w-full space-y-3'>
        <button
          onClick={handleGoogleLogin}
          className='w-full rounded-xl bg-red-600 text-white py-3 font-medium active:scale-[.99]'
        >
          התחברות עם Google
        </button>

        <div className='text-center text-xs text-gray-500'>או התחברות עם קישור למייל</div>

        <form onSubmit={handleEmailMagicLink} className='w-full space-y-3'>
          <input
            type='email'
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
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
