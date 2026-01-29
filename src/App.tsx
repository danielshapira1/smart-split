// src/App.tsx
import React, { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { LogOut, Plus, Trash2, Pencil, Settings } from 'lucide-react';

import { supabase, ensureProfileForCurrentUser } from './lib/supabaseClient';
import { deleteExpense } from './lib/supaRest';
import { GroupSwitcher } from './components/GroupSwitcher';
import { GroupSettings } from './components/GroupSettings';
import { InviteButton } from './components/InviteButton';
import { ExpenseForm } from './components/ExpenseForm';
import BalancesPanel from './components/BalancesPanel';
import { useRealtimeExpenses, type Transfer } from './hooks/useRealtimeExpenses';

import type { Group, Profile } from './lib/types';
import type { Member } from './lib/settlements';
import { ArrowLeftRight } from 'lucide-react';

/* ---------- Types used here ---------- */
export type Expense = {
  id: string;
  group_id: string;
  user_id: string;
  amount_cents: number;
  currency: string | null;
  description: string | null;
  category: string | null;
  occurred_on: string;
  created_at: string;
  // מצטרף מה־join — שם/מייל של המשלם מתוך profiles
  payer?: { display_name: string | null; email: string | null } | null;
  // לשמירת תאימות לאחור (אם שמרת שם בטבלה עצמה)
  payer_name?: string | null;
};

const CATEGORIES = [
  'סופר',
  'דלק',
  'שכירות',
  'בילויים',
  'מסעדות',
  'נסיעות',
  'קניות',
  'חשבונות',
  'אחר',
];

/* ---------- App ---------- */
export default function App() {
  const [session, setSession] =
    useState<import('@supabase/supabase-js').Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [groups, setGroups] = useState<Group[]>([]);
  const [group, setGroup] = useState<Group | null>(null);
  const [role, setRole] = useState<string>('member');

  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [tab, setTab] = useState<'expenses' | 'balances'>('expenses');
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const [expenseToEdit, setExpenseToEdit] = useState<Expense | null>(null);

  // חברי הקבוצה למאזנים (שמות בלבד — לא מסתמכים על זה למספר משתתפים)
  const [members, setMembers] = useState<Member[]>([]);

  // --- ברכה לשם משתמש ---
  const greetName = useMemo(
    () => profile?.display_name || session?.user?.email || 'אורח',
    [profile?.display_name, session?.user?.email]
  );

  /* ----- auth ----- */
  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange((_e, s) => setSession(s)).data;
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // ודא שקיים פרופיל לאחר התחברות
  useEffect(() => {
    if (!session) return;
    ensureProfileForCurrentUser().catch(() => { });
  }, [session]);

  /* ----- helper: ריענון קבוצות ובחירת קבוצה יעד ----- */
  const refreshGroups = React.useCallback(
    async (targetGroupId?: string | null) => {
      if (!session) return;
      const uid = session.user.id;

      // נסיון ראשי: דרך memberships (מסונן לפי המשתמש), ומחזירים groups
      let gs: Group[] = [];
      try {
        const { data, error } = await supabase
          .from('memberships')
          .select(
            `
            groups:groups(
              id,
              name,
              created_by,
              created_at,
              creator:profiles!groups_created_by_fkey(display_name,email)
            )
          `
          )
          .eq('user_id', uid);

        if (error) throw error;
        gs = (data ?? [])
          .map((row: any) => row.groups)
          .filter(Boolean) as Group[];
      } catch {
        // fallback: JOIN מתוך groups (צריך הרשאות מתאימות)
        try {
          const { data, error } = await supabase
            .from('groups')
            .select(
              `
              id,
              name,
              created_by,
              created_at,
              creator:profiles!groups_created_by_fkey(display_name,email),
              memberships!inner(user_id)
            `
            )
            .eq('memberships.user_id', uid);

          if (error) throw error;
          gs = (data ?? []) as any as Group[];
        } catch (err2) {
          console.error('refreshGroups fallback failed:', err2);
          gs = [];
        }
      }

      setGroups(gs);
      setGroup((prev) => {
        const pickId = targetGroupId ?? prev?.id ?? gs[0]?.id ?? null;
        return gs.find((g) => g.id === pickId) ?? gs[0] ?? null;
      });
    },
    [session]
  );

  /* ----- profile + groups ----- */
  const fetchProfile = React.useCallback(async () => {
    if (!session) return;
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle<Profile>();
    setProfile(prof ?? null);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      await refreshGroups(null);
      await fetchProfile();
    })();
  }, [session, refreshGroups, fetchProfile]);

  /* ----- Realtime על memberships של המשתמש ----- */
  useEffect(() => {
    if (!session) return;
    const uid = session.user.id;

    const ch = supabase
      .channel(`mems:${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'memberships', filter: `user_id=eq.${uid}` },
        () => refreshGroups(null)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [session, refreshGroups]);

  /* ----- role for current group ----- */
  useEffect(() => {
    if (!session || !group) {
      setRole('member');
      setMembers([]); // reset members
      return;
    }
    (async () => {
      // 1. Fetch Role
      const { data: roleData, error: roleError } = await supabase
        .from('memberships')
        .select('role')
        .eq('user_id', session.user.id)
        .eq('group_id', group.id)
        .maybeSingle();

      if (roleError) {
        console.warn('load role failed:', roleError.message);
        setRole('member');
      } else {
        setRole(roleData?.role ?? 'member');
      }

      // 2. Fetch Members (Profiles) via Secure RPC
      // This bypasses RLS issues and guarantees we get whatever data exists
      const { data: membersData, error: membersError } = await supabase
        .rpc('get_group_members', { p_group_id: group.id });

      if (membersError) {
        console.error('fetch members rpc failed:', membersError);
        setMembers([]);
      } else {
        // Transform to Member[]
        const mapped: Member[] = (membersData || []).map((m: any) => ({
          user_id: m.user_id,
          name: m.display_name || m.email || 'חבר לא ידוע',
          display_name: m.display_name,
          email: m.email
        }));
        setMembers(mapped);
      }

    })();
  }, [session?.user?.id, group?.id]);

  /* ----- קבלה מהירה של הזמנה מה-URL (?invite=TOKEN) ----- */
  const processingInvite = React.useRef(false);

  useEffect(() => {
    if (!session) return;
    const url = new URL(window.location.href);
    const token = url.searchParams.get('invite');
    if (!token) return;

    if (processingInvite.current) return;
    processingInvite.current = true;

    (async () => {
      // Fix: ensure profile exists before accepting invite (avoid FK error)
      try {
        await ensureProfileForCurrentUser();
      } catch (err) {
        console.warn('ensureProfileForCurrentUser failed:', err);
      }

      const { data, error } = await supabase.rpc('accept_invite', { p_token: token });
      if (error) {
        // אם השגיאה היא שהמשתמש כבר בקבוצה - זה לא באמת כישלון קריטי
        if (error.message?.includes('violates unique constraint "memberships_pkey"')) {
          // התעלמות או הודעה עדינה
          console.log('Already a member');
        } else {
          alert('שגיאה בהצטרפות לקבוצה: ' + error.message);
        }
        processingInvite.current = false; // allow retry if failed? or keep blocked? Usually keep blocked if token is one-time.
      } else {
        await refreshGroups(data?.group_id ?? null);
      }

      url.searchParams.delete('invite');
      window.history.replaceState({}, '', url.toString());
      processingInvite.current = false;
    })();
  }, [session, refreshGroups]);

  /* ----- realtime expenses ----- */
  const { expenses, transfers, refresh } = useRealtimeExpenses(group?.id);

  /* ----- load members for current group (שמות להצגה) ----- */
  useEffect(() => {
    if (!group) {
      setMembers([]);
      return;
    }

    (async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select(
          `
          user_id,
          profiles:profiles!memberships_user_id_fkey (
            id,
            display_name,
            email
          )
        `
        )
        .eq('group_id', group.id);

      if (error) {
        console.error('load members failed:', error.message);
        setMembers([]);
        return;
      }

      const ms: Member[] = (data ?? []).map((m: any) => ({
        user_id: m.user_id,
        uid: m.user_id,
        name: m.profiles?.display_name || m.profiles?.email || m.user_id,
      }));

      setMembers(ms);
    })();
  }, [group]);

  /* ----- filters + combined list (לתצוגת רשימת הוצאות בלבד) ----- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter((e) => {
      const okCat = !category || e.category === category;
      const okSearch = !q || (e.description ?? '').toLowerCase().includes(q);
      return okCat && okSearch;
    });
  }, [expenses, search, category]);

  const combinedItems = useMemo(() => {
    const q = search.trim().toLowerCase();

    // 1. Map expenses
    const list1 = filtered.map(e => ({ type: 'expense' as const, data: e, date: new Date(e.occurred_on || e.created_at) }));

    // 2. Map transfers (Only if no category filter is active, or maybe we don't filter transfers by text yet)
    // Transfers usually don't have categories. We'll show them unless a category is picked (or maybe 'Settlement' category?).
    const list2 = (!category && !q) ? transfers.map(t => ({ type: 'transfer' as const, data: t, date: new Date(t.created_at) })) : [];

    // 3. Merge & Sort
    return [...list1, ...list2].sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [filtered, transfers, search, category]);

  /* ---------- סיכום למעלה: “מי חייב למי” ---------- */
  const meId = session?.user?.id ?? '';
  const [myNetBalance, setMyNetBalance] = useState<number | null>(null);

  // Fetch true balance from view whenever expenses change (or group changes)
  useEffect(() => {
    if (!group || !meId) {
      setMyNetBalance(0);
      return;
    }

    const fetchBalance = async () => {
      const { data, error } = await supabase
        .from('net_balances')
        .select('net_cents')
        .eq('group_id', group.id)
        .eq('user_id', meId)
        .maybeSingle();

      if (!error && data) {
        setMyNetBalance(data.net_cents);
      } else {
        setMyNetBalance(0);
      }
    };

    fetchBalance();
  }, [group, meId, expenses]); // depend on expenses to refresh when they change

  // Parsing participant names for the summary text
  const participantIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of expenses) if (e.user_id) s.add(e.user_id);
    return Array.from(s);
  }, [expenses]);

  const isPair = members.length === 2; // Better to check members list than expense participants

  const otherId = useMemo(() => {
    if (!isPair) return '';
    return members.find(m => m.user_id !== meId)?.user_id || '';
  }, [isPair, members, meId]);

  const otherName = useMemo(() => {
    if (!otherId) return 'המשתתף/ת השני/ה';
    const m = members.find((x) => x.user_id === otherId);
    return m?.display_name || m?.email || m?.name || 'חבר קבוצה';
  }, [otherId, members]);

  const summaryText = useMemo(() => {
    if (!group) return '';
    if (myNetBalance === null) return 'מחשב...';

    const netCents = myNetBalance;
    const abs = Math.abs(netCents) / 100;

    if (netCents > 0) {
      // Positive = I am owed money (Wait, view logic: paid - owed. If result > 0, I paid more than I owe => I am owed money)
      // Standard definition: Net Balance > 0 means you are OWED. Net Balance < 0 means you OWE.
      // Let's verify view:
      // paid_cents - share_owed_cents - transfers_out + transfers_in
      // If I paid 100, and equal split is 50. 100 - 50 = +50. I am owed 50. Correct.
      return isPair
        ? `${otherName} חייב/ת לך ₪${abs.toFixed(2)}`
        : `הקבוצה חייבת לך ₪${abs.toFixed(2)}`;
    }
    if (netCents < 0) {
      return isPair
        ? `את/ה חייב/ת ל${otherName} ₪${abs.toFixed(2)}`
        : `את/ה חייב/ת לקבוצה ₪${abs.toFixed(2)}`;
    }
    return 'מאוזנים';
  }, [group, myNetBalance, isPair, otherName]);

  const currentPayerName =
    profile?.display_name || profile?.email || session?.user?.email || 'משתמש';

  /* ----- actions ----- */
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('SignOut error:', error);
    window.localStorage.clear();
    window.location.reload();
  };

  // יצירת קבוצה חדשה
  const createGroup = async () => {
    const name = prompt('שם קבוצה חדש:')?.trim();
    if (!name || !session) return;

    // נסיון דרך RPC
    try {
      const rpc = await supabase.rpc('create_group', { p_name: name });
      const row = (rpc as any)?.data as Group | null;
      const error = (rpc as any)?.error as { message?: string } | null;

      if (!error && row) {
        setGroups((prev) => [row, ...prev]);
        setGroup(row);
        setRole('owner');
        return;
      }
    } catch { }

    // fallback ישיר לטבלאות
    try {
      const { data: gRaw, error: e1 } = await supabase
        .from('groups')
        .insert({ name })
        .select('*')
        .maybeSingle();

      if (e1 || !gRaw) throw e1 ?? new Error('יצירת קבוצה נכשלה');
      const g = gRaw as Group;

      const { error: e2 } = await supabase.from('memberships').insert({
        group_id: g.id,
        user_id: session.user.id,
        role: 'owner',
      });

      if (e2) console.warn('הוספת חברות נכשלה:', e2.message);

      setGroups((prev) => [g, ...prev]);
      setGroup(g);
      setRole('owner');
    } catch (err: any) {
      console.error('[createGroup] error', err);
      alert(err?.message ?? 'יצירת קבוצה נכשלה');
    }
  };



  // Rescue 'Unknown' members by looking at expenses history
  // If we have an expense from this user, we likely have their profile name loaded there
  const enrichedMembers = useMemo(() => {
    return members.map(m => {
      const isUnknown = !m.name || m.name === 'חבר לא ידוע' || m.name === 'Unknown';
      if (!isUnknown) return m;

      // Search in loaded expenses
      const found = expenses.find((e: any) => e.user_id === m.user_id);
      if (found) {
        // 'payer' is populated by useRealtimeExpenses usually, or 'profiles' from raw query
        const p = (found as any).payer || (found as any).profiles;
        const newName = p?.display_name || p?.email || (found as any).payer_name;
        if (newName) {
          return {
            ...m,
            name: newName,
            display_name: p?.display_name || m.display_name,
            email: p?.email || m.email
          };
        }
      }
      return m;
    });
  }, [members, expenses]);

  const confirmDelete = async () => {
    if (!expenseToDelete) return;
    try {
      await deleteExpense(expenseToDelete.id);
      setExpenseToDelete(null);
      refresh(); // refresh list
    } catch (err: any) {
      alert('שגיאה במחיקת הוצאה: ' + err.message);
    }
  };

  /* ----- guards ----- */
  if (!session) return <AuthScreen />;

  // === מסך ללא קבוצה: עם ברכה למעלה ===
  if (!group) {
    return (
      <div className="h-full flex flex-col bg-zinc-900 min-h-screen">
        <header className="sticky top-0 z-10 bg-zinc-800/95 backdrop-blur border-b border-zinc-700 px-4 py-3 flex items-center gap-2">
          <div className="flex-1" />
          <div className="ms-auto me-2 text-sm text-zinc-300">שלום, {greetName}</div>
          <button onClick={signOut} className="text-sm text-red-400 hover:text-red-300 flex items-center gap-1">
            <LogOut className="w-4 h-4" /> יציאה
          </button>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
          <p className="text-zinc-500 text-center">
            אין קבוצה עדיין — צור קבוצה חדשה או הצטרף מההזמנה.
          </p>
          <button className="rounded-full bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 transition-colors" onClick={createGroup}>
            צור קבוצה חדשה
          </button>
        </div>
      </div>
    );
  }

  /* ---------- render with group ---------- */

  /* ---------- render with group ---------- */


  return (
    <div className="max-w-md mx-auto h-full flex flex-col bg-zinc-900 min-h-screen">
      {/* header */}
      <header className="sticky top-0 z-10 bg-zinc-900/60 backdrop-blur-md border-b border-white/5 px-4 py-3 flex items-center gap-2">
        <GroupSwitcher
          groups={groups}
          current={group}
          onSelect={setGroup}
          onCreated={(g) => {
            setGroups((prev) => [g, ...prev]);
            setGroup(g);
          }}
          onCreateNew={createGroup}
        />
        <div className="ms-auto me-2 text-sm text-zinc-300">שלום, {greetName}</div>
        <button
          onClick={() => setShowSettings(true)}
          className="p-2 text-zinc-400 hover:text-indigo-400 transition-colors"
          title="הגדרות קבוצה"
        >
          <Settings className="w-5 h-5" />
        </button>
        <InviteButton groupId={group.id} isAdmin={role === 'owner' || role === 'admin'} />
      </header>

      {/* top summary line */}
      <div className="px-4 pt-4 pb-2 text-sm text-zinc-400 font-medium">{summaryText}</div>

      {/* search + filter */}
      <div className="px-4 py-2 flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש תיאור..."
          className="flex-1 rounded-xl border border-white/10 bg-zinc-800/40 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:ring-2 focus:ring-indigo-500/50 backdrop-blur-sm transition-all"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-xl border border-white/10 bg-zinc-800/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500/50 backdrop-blur-sm"
        >
          <option value="" className="bg-zinc-800">כל הקטגוריות</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c} className="bg-zinc-800">
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* tabs */}
      <nav className="px-4 py-3">
        <div className="bg-zinc-800/50 p-1 rounded-2xl flex gap-1 border border-white/5 backdrop-blur-sm">
          <button
            onClick={() => setTab('expenses')}
            className={clsx(
              'flex-1 py-2 rounded-xl text-sm font-medium transition-all duration-200',
              tab === 'expenses'
                ? 'bg-zinc-700/80 text-white shadow-sm ring-1 ring-white/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/30'
            )}
          >
            הוצאות
          </button>
          <button
            onClick={() => setTab('balances')}
            className={clsx(
              'flex-1 py-2 rounded-xl text-sm font-medium transition-all duration-200',
              tab === 'balances'
                ? 'bg-zinc-700/80 text-white shadow-sm ring-1 ring-white/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/30'
            )}
          >
            מאזנים
          </button>
        </div>
      </nav>

      {/* content */}
      {tab === 'expenses' ? (
        <main className="flex-1 overflow-y-auto px-4 py-3">
          {filtered.length === 0 ? (
            <p className="text-zinc-500 text-center mt-10">
              אין הוצאות — לחץ על הפלוס למטה כדי להוסיף.
            </p>
          ) : (
            <ul className="space-y-3">
              {filtered.map((e) => {
                const payerName =
                  e.payer?.display_name || e.payer?.email || e.payer_name || '...';

                return (
                  <li
                    key={e.id}
                    className="group bg-zinc-800/40 backdrop-blur-sm border border-white/5 rounded-2xl p-4 flex items-center justify-between hover:bg-zinc-800/60 transition-all duration-200"
                  >
                    <div>
                      <div className="font-medium text-zinc-200 text-base">{e.description || 'ללא תיאור'}</div>
                      <div className="text-xs text-zinc-500 mt-1 flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-zinc-700/50 border border-white/5">{e.category || '—'}</span>
                        <span>•</span>
                        <span>{new Date(e.occurred_on).toLocaleDateString('he-IL')}</span>
                        <span>•</span>
                        <span>{payerName}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-zinc-100 text-lg">₪{(e.amount_cents / 100).toFixed(2)}</div>
                      <div className="text-[0.65rem] text-zinc-500 uppercase tracking-wider">{e.currency || 'ILS'}</div>
                    </div>

                    {(e.user_id === session.user.id || role === 'owner' || role === 'admin') && (
                      <div className="flex items-center gap-1 mr-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* Edit: Only the creator can edit */}
                        {e.user_id === session.user.id && (
                          <button
                            onClick={() => {
                              setExpenseToEdit(e);
                              setShowForm(true);
                            }}
                            className="p-2 text-zinc-400 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-lg transition-colors"
                            title="ערוך הוצאה"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}

                        {/* Delete: Creator OR Admin/Owner can delete */}
                        <button
                          onClick={() => setExpenseToDelete(e)}
                          className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                          title="מחק הוצאה"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </main>
      ) : (
        <BalancesPanel
          members={enrichedMembers}
          expenses={expenses as any}
          transfers={transfers}
          groupId={group.id}
          currentUserId={session.user.id}
          onRefresh={refresh}
          currency="ILS"
        />
      )}

      {/* footer add */}
      {tab === 'expenses' && (
        <footer className="sticky bottom-0 pointer-events-none p-6 flex justify-end">
          <button
            onClick={() => setShowForm(true)}
            className={clsx(
              'pointer-events-auto px-5 py-3 rounded-2xl shadow-xl shadow-indigo-500/20 bg-gradient-to-r from-indigo-600 to-violet-600 text-white flex items-center gap-2 active:scale-[.98] hover:scale-105 transition-all duration-200 font-medium'
            )}
          >
            <Plus className="w-5 h-5" />
            <span>הוסף הוצאה</span>
          </button>
        </footer>
      )}

      {/* modal */}
      {showForm && (
        <ExpenseForm
          groupId={group.id}
          currentPayerName={greetName}
          categories={CATEGORIES}
          members={enrichedMembers}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            setExpenseToEdit(null);
            refresh();
          }}
          initialData={expenseToEdit}
        />
      )}

      {showSettings && group && (
        <GroupSettings
          group={group}
          profile={profile}
          onClose={() => setShowSettings(false)}
          onRefresh={() => {
            refresh(); // Triggers re-fetch of realtime expenses
            fetchProfile(); // Re-fetch profile to update header name
          }}
          onLogout={signOut}
        />
      )}

      {/* Delete Confirmation Modal */}
      {expenseToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-800 border border-zinc-700 w-full max-w-sm rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-zinc-100">מחיקת הוצאה</h3>
            <p className="text-zinc-400">
              אתה בטוח שאתה רוצה למחוק את ההוצאה "{expenseToDelete.description || 'ללא תיאור'}"?
            </p>
            <div className="flex gap-3 justify-end mt-4">
              <button
                onClick={() => setExpenseToDelete(null)}
                className="px-4 py-2 rounded-xl text-zinc-400 hover:bg-zinc-800 font-medium"
              >
                ביטול
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 font-medium shadow"
              >
                מחק
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Auth screen ---------- */
function AuthScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = async () => {
    const base = import.meta.env.BASE_URL || '/';
    const redirectTo = `${window.location.origin}${base}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) setError(error.message);
  };

  const sendMagic = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const base = import.meta.env.BASE_URL || '/';
    const redirectTo = `${window.location.origin}${base}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div className="h-full max-w-sm mx-auto flex flex-col items-center justify-center p-4 bg-zinc-900 min-h-screen">
      <h1 className="text-2xl font-bold mb-2 text-zinc-100">הוצאות ביחד</h1>
      <p className="text-zinc-500 mb-6 text-center">התחברות מהירה</p>
      <div className="w-full space-y-3">
        <button
          onClick={google}
          className="w-full rounded-xl bg-red-600 hover:bg-red-500 text-white py-3 font-medium active:scale-[.99] transition-colors"
        >
          התחברות עם Google
        </button>
        <div className="text-center text-xs text-zinc-600">או התחברות עם קישור למייל</div>
        <form onSubmit={sendMagic} className="w-full space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="המייל שלך"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-600"
          />
          <button className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white py-3 font-medium active:scale-[.99] transition-colors">
            שלח לי קישור
          </button>
        </form>
      </div>
      {sent && <p className="text-green-500 mt-3">נשלח קישור למייל אם הוא קיים במערכת.</p>}
      {error && <p className="text-red-500 mt-3">{error}</p>}

      <div className="mt-8 border-t border-zinc-800 pt-4 w-full text-center">
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            window.localStorage.clear();
            window.location.reload();
          }}
          className="text-xs text-zinc-600 hover:text-zinc-400 underline"
        >
          נתקל בבעיות התחברות? לחץ כאן לניקוי נתונים
        </button>
      </div>
    </div>
  );
}
