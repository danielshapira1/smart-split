import React, { useMemo, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { UserChip, userBg, userBorder, userColor } from '../lib/colors';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { saveTransfer } from '../lib/supaRest';
import { ExpensesPieChart } from './ExpensesPieChart';
import { UserMonthlyChart } from './UserMonthlyChart';
import { SixMonthTrendChart } from './SixMonthTrendChart';
import type { Transfer } from '../hooks/useRealtimeExpenses';

/* ========= Types ========= */

export type Member = {
  uid?: string;
  user_id?: string;
  name?: string;
  display_name?: string;
  email?: string;
};

export type Expense = {
  id: string;
  group_id: string;
  user_id: string;
  amount_cents: number | string;
  currency?: string;
  description?: string;
  category?: string;
  occurred_on?: string;
  created_at?: string;
  payer_name?: string | null;
};

type NetBalance = {
  group_id: string;
  user_id: string;
  net_cents: number;
};

type Props = {
  members: Member[];
  expenses: Expense[];
  transfers: Transfer[];
  groupId: string;
  currentUserId: string;
  onRefresh?: () => void;
  currency?: string;
};

/* ========= Small helpers ========= */

const toCents = (v: unknown) => {
  const n =
    typeof v === 'string'
      ? Number.isFinite(+v) ? Math.round(parseFloat(v)) : 0
      : Math.round((v as number) ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const clampCents = (n: unknown) => Math.max(0, toCents(n));

const memberId = (m: Member | undefined | null) => (m?.uid || m?.user_id || '').trim();
const nameOfMember = (m: Member | undefined, fallback = ''): string => {
  const n = m?.display_name || m?.name || m?.email || fallback;
  return n?.trim() || 'Unknown';
};

const fmtCurrency = (cents: number, currency = 'ILS') =>
  (cents / 100).toLocaleString('he-IL', { style: 'currency', currency });

/** Greedy settlement: מדביק חייבים (שלילי) מול זכאים (חיובי) */
function settleGreedy(nets: Array<{ id: string; net: number }>) {
  const debtors = nets
    .filter((x) => x.net < 0)
    .map((x) => ({ id: x.id, net: x.net }))
    .sort((a, b) => a.net - b.net);

  const creditors = nets
    .filter((x) => x.net > 0)
    .map((x) => ({ id: x.id, net: x.net }))
    .sort((a, b) => b.net - a.net);

  const res: Array<{ from: string; to: string; amount: number }> = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    if (!d || !c) break;

    const need = Math.abs(d.net);
    const give = c.net;
    const amount = Math.min(need, give);
    if (amount <= 0) break;

    res.push({ from: d.id, to: c.id, amount });

    d.net += amount;
    c.net -= amount;

    if (Math.abs(d.net) < 1) i++;
    if (Math.abs(c.net) < 1) j++;
  }

  return res;
}

/* ========= Component ========= */

export default function BalancesPanel({
  members,
  expenses,
  transfers = [],
  groupId,
  currentUserId,
  onRefresh,
  currency = 'ILS'
}: Props) {
  const [settling, setSettling] = useState<string | null>(null); // "from-to" key
  const [dbBalances, setDbBalances] = useState<NetBalance[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);

  const [targetDate, setTargetDate] = useState(new Date()); // For monthly filter

  // Fetch true balances from View whenever expenses/transfers change
  useEffect(() => {
    if (!groupId) return;

    // We use a small timeout to let the DB update view (though it should be immediate in same transaction usually,
    // but client refresh might be faster). View is not materialized, so it's always fresh.
    const fetchB = async () => {
      setLoadingBalances(true);
      const { data, error } = await supabase
        .from('net_balances')
        .select('*')
        .eq('group_id', groupId);

      if (!error && data) {
        setDbBalances(data);
      }
      setLoadingBalances(false);
    };

    fetchB();
  }, [groupId, expenses, transfers]); // Re-fetch when local data changes

  const handleNextMonth = () => {
    setTargetDate(d => {
      const next = new Date(d);
      next.setMonth(next.getMonth() + 1);
      return next;
    });
  };

  const handlePrevMonth = () => {
    setTargetDate(d => {
      const prev = new Date(d);
      prev.setMonth(prev.getMonth() - 1);
      return prev;
    });
  };

  // Filtered expenses for the charts
  const monthlyExpenses = useMemo(() => {
    const m = targetDate.getMonth();
    const y = targetDate.getFullYear();
    return expenses.filter(e => {
      const d = new Date(e.occurred_on || e.created_at || '');
      return d.getMonth() === m && d.getFullYear() === y;
    });
  }, [expenses, targetDate]);

  // Derived members for the charts (ensure name exists)
  const chartMembers = useMemo(() => members.map(m => ({
    user_id: m.user_id || m.uid,
    name: m.display_name || m.name || m.email
  })), [members]);

  // Name resolution
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      const id = memberId(m);
      if (!id) continue;
      map.set(id, nameOfMember(m, id.slice(0, 6)));
    }
    return map;
  }, [members]);

  const nameOf = (id: string) => nameById.get(id) ?? id.slice(0, 6);

  // Combine DB balances with member info
  // The View returns net_cents > 0 (Owed/Zakai) or < 0 (Owes/Chayav).
  const nets = useMemo(() => {
    // Map all members to ensure we show everyone even if 0 balance (optional, but good)
    // Or just map the rows from DB? DB view includes all members in group (left join in view).

    // If dbBalances is empty, we show 0 for all members
    const map = new Map<string, number>();
    for (const m of members) {
      const id = memberId(m);
      if (id) map.set(id, 0);
    }

    for (const b of dbBalances) {
      map.set(b.user_id, b.net_cents);
    }

    return Array.from(map.entries()).map(([id, net]) => ({
      id,
      net
    })).sort((a, b) => b.net - a.net); // Highest credit first
  }, [dbBalances, members]);

  // Totals
  const totalSpent = useMemo(
    () => expenses.reduce((s, e) => s + clampCents(e.amount_cents), 0),
    [expenses]
  );
  // Calculate total debt from the nets view (sum of positive balances = sum of negative balances ideally)
  const totalDebt = useMemo(
    () => nets.filter((n) => n.net < 0).reduce((s, n) => s + Math.abs(n.net), 0),
    [nets]
  );

  // Suggested settlements using the correct nets
  const suggestedTransfers = useMemo(() => settleGreedy(nets), [nets]);
  const isBalanced = suggestedTransfers.length === 0;

  const twoMembers = members.length === 2; // Approximate check

  /* --- Actions --- */

  const handleSettle = async (fromId: string, toId: string, maxAmount: number) => {
    if (loadingBalances) return;

    // Default to full amount, but allow edit
    const def = (maxAmount / 100).toFixed(2);
    const input = prompt(`הכנס סכום להחזר (מקסימום ${def})`, def);
    if (input === null) return; // Cancelled

    const val = parseFloat(input);
    if (!Number.isFinite(val) || val <= 0) {
      alert('סכום לא תקין');
      return;
    }

    // Convert back to cents
    const amountCents = Math.round(val * 100);

    setSettling(`${fromId}-${toId}`);
    try {
      await saveTransfer({
        group_id: groupId,
        from_user: fromId,
        to_user: toId,
        amount_cents: amountCents,
        note: 'Settle up',
      });
      onRefresh?.();
    } catch (err: any) {
      alert('שגיאה בשמירת העברה: ' + err.message);
    } finally {
      setSettling(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      {/* Top Summary */}
      <section className="bg-zinc-800/40 backdrop-blur-sm border border-white/5 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-sm text-zinc-400">סה"כ הוצאות:</div>
          <div className="font-bold text-zinc-100">{fmtCurrency(totalSpent, currency)}</div>

          <div className="ml-auto flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">חובות פתוחים:</span>
              <span className={`font-semibold ${totalDebt > 5 ? 'text-rose-400' : 'text-zinc-400'}`}>
                {fmtCurrency(totalDebt, currency)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Month Nav */}
      <div className="flex items-center justify-between bg-zinc-800/40 backdrop-blur-sm border border-white/5 rounded-2xl p-2 px-4 shadow-sm">
        <button onClick={handlePrevMonth} className="p-2 text-zinc-400 hover:text-white transition-colors">
          <ChevronRight className="w-5 h-5" />
        </button>
        <span className="font-medium text-zinc-200">
          {targetDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}
        </span>
        <button onClick={handleNextMonth} className="p-2 text-zinc-400 hover:text-white transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
      </div>

      {/* Charts */}
      {/* Note: Charts currently show RAW expenses data, not net balances. This is correct for "Pie Chart" etc. */}

      {/* Chart: Distribution */}
      <ExpensesPieChart expenses={monthlyExpenses} currency={currency} />

      {/* Chart: User Breakdown */}
      <UserMonthlyChart expenses={monthlyExpenses} members={chartMembers} currency={currency} />

      {/* Chart: Trend */}
      <SixMonthTrendChart expenses={expenses} currentDate={targetDate} currency={currency} />

      {/* Per User Status */}
      <section className="bg-zinc-800/40 backdrop-blur-sm border border-white/5 rounded-2xl shadow-sm p-4">
        <div className="text-sm font-medium mb-3 text-zinc-300">מאזנים אישיים</div>
        <ul className="space-y-2">
          {nets.map((n) => {
            const owes = n.net < -5; // tolerance 5 cents
            const credits = n.net > 5;
            const zero = !owes && !credits;

            const otherName =
              twoMembers && owes
                ? nameOf(nets.find((x) => x.id !== n.id)?.id || '')
                : 'לקבוצה';

            return (
              <li
                key={n.id}
                className="rounded-xl px-3 py-2 flex items-center justify-between"
                style={{
                  borderInlineStart: `0.375rem solid ${userColor(n.id)}`,
                  backgroundColor: 'rgba(39, 39, 42, 0.4)', // zinc-800/40 equivalent
                  boxShadow: `0 1px 0 ${userBorder(n.id)} inset`,
                }}
              >
                <div className="text-sm text-zinc-200">
                  <UserChip uid={n.id} name={nameOf(n.id)} />{' '}
                  {zero
                    ? 'מאוזנ/ת'
                    : owes
                      ? `חייב/ת ${otherName}`
                      : 'מגיע לקבל'}
                </div>

                <div
                  className={`text-sm font-semibold ${owes ? 'text-rose-400' : credits ? 'text-emerald-400' : 'text-zinc-500'
                    }`}
                >
                  {zero ? '' : fmtCurrency(Math.abs(n.net), currency)}
                </div>
              </li>
            );
          })}
          {nets.length === 0 && <p className="text-zinc-500 text-xs text-center py-2">אין נתונים</p>}
        </ul>
      </section>

      {/* Suggested Settlements */}
      <section className="bg-zinc-800/40 backdrop-blur-sm border border-white/5 rounded-2xl shadow-sm p-4">
        <div className="text-sm font-medium mb-3 text-zinc-300">הצעת סגירת חוב (להעברה)</div>
        {isBalanced ? (
          <div className="text-zinc-500 text-sm text-center py-2">הכל מאוזן! אין חובות פתוחים. ✨</div>
        ) : (
          <ul className="space-y-2">
            {suggestedTransfers.map((t, idx) => {
              const key = `${t.from}-${t.to}`;
              const isMe = t.from === currentUserId || t.to === currentUserId;
              const canSettle = currentUserId && (t.from === currentUserId || t.to === currentUserId);

              return (
                <li
                  key={key + idx}
                  className="rounded-xl px-3 py-3 flex items-center justify-between bg-zinc-900/50 border border-white/5"
                >
                  <div className="flex flex-col gap-1">
                    <div className="text-sm text-zinc-200 flex items-center gap-2">
                      <UserChip uid={t.from} name={nameOf(t.from)} />
                      <span className="text-zinc-500 text-xs">מעביר ל</span>
                      <UserChip uid={t.to} name={nameOf(t.to)} />
                    </div>
                    <div className="font-bold text-zinc-100 px-1">
                      {fmtCurrency(t.amount, currency)}
                    </div>
                  </div>

                  {canSettle && (
                    <button
                      onClick={() => handleSettle(t.from, t.to, t.amount)}
                      disabled={loadingBalances || !!settling}
                      className="text-xs bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-600/30 px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
                    >
                      {settling === key ? 'שומר...' : 'סמן כשולם'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
