import React, { useMemo, useState } from 'react';
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

type Props = {
  members: Member[];
  expenses: Expense[];
  transfers: Transfer[];  // <--- Added support for transfers
  groupId: string;        // <--- Need groupId for saving transfers
  currentUserId: string;  // <--- Need to know who I am
  onRefresh?: () => void; // <--- Callback to refresh data
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
const safeId = (s: string | undefined | null) => (s ?? '').trim();
const nameOfMember = (m: Member | undefined, fallback = ''): string =>
  (m?.name || m?.display_name || m?.email || fallback).trim();

const fmtCurrency = (cents: number, currency = 'ILS') =>
  (cents / 100).toLocaleString('he-IL', { style: 'currency', currency });

/** פיזור שווה של סכום בסנטים על רשימת משתמשים */
function evenSplitCents(totalCents: number, ids: string[]) {
  const n = Math.max(1, ids.length);
  const base = Math.floor(totalCents / n);
  let remainder = totalCents - base * n;
  const out = new Map<string, number>();
  for (const id of ids) {
    const extra = remainder > 0 ? 1 : 0;
    out.set(id, base + extra);
    remainder -= extra;
  }
  return out;
}

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
  const [loading, setLoading] = useState(false);
  const [targetDate, setTargetDate] = useState(new Date()); // For monthly filter

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
    name: m.name || m.display_name || m.email
  })), [members]);

  // 1. Participant IDs
  const participantIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of members) {
      const id = memberId(m);
      if (id) set.add(id);
    }
    for (const e of expenses) {
      const id = safeId(e.user_id);
      if (id) set.add(id);
    }
    // Transfers participants too
    for (const t of transfers) {
      if (t.from_user) set.add(t.from_user);
      if (t.to_user) set.add(t.to_user);
    }
    return Array.from(set).sort();
  }, [members, expenses, transfers]);

  // 2. Paid By (Expenses)
  const paidBy = useMemo(() => {
    const map = new Map<string, number>();
    for (const id of participantIds) map.set(id, 0);
    for (const e of expenses) {
      const id = safeId(e.user_id);
      if (!id) continue;
      map.set(id, (map.get(id) ?? 0) + clampCents(e.amount_cents));
    }
    return map;
  }, [participantIds, expenses]);

  // 3. Owe By (Split logic - currently Even Split only)
  const oweBy = useMemo(() => {
    const map = new Map<string, number>();
    for (const id of participantIds) map.set(id, 0);
    if (participantIds.length === 0) return map;

    for (const e of expenses) {
      const amount = clampCents(e.amount_cents);
      if (amount <= 0) continue;
      // TODO: Future supports unequal split here
      const share = evenSplitCents(amount, participantIds);
      for (const [id, chunk] of share.entries()) {
        map.set(id, (map.get(id) ?? 0) + chunk);
      }
    }
    return map;
  }, [participantIds, expenses]);

  // 4. Transfers (Settlements)
  // We need to count how much each person sent (reduce debt) or received (reduce credit)
  const transferMap = useMemo(() => {
    const sent = new Map<string, number>();
    const received = new Map<string, number>();
    for (const t of transfers) {
      const amt = clampCents(t.amount_cents);
      sent.set(t.from_user, (sent.get(t.from_user) ?? 0) + amt);
      received.set(t.to_user, (received.get(t.to_user) ?? 0) + amt);
    }
    return { sent, received };
  }, [transfers]);

  // 5. Net Balances
  const nets = useMemo(() => {
    return participantIds.map((id) => {
      const paidExp = paidBy.get(id) ?? 0;
      const oweExp = oweBy.get(id) ?? 0;
      const sentTr = transferMap.sent.get(id) ?? 0;
      const receivedTr = transferMap.received.get(id) ?? 0;

      // Net = (Paid Expenses + Sent Transfers) - (My Share of Expenses + Received Transfers)
      // If result > 0: "I gave more than I took" -> Credit
      // If result < 0: "I took more than I gave" -> Debt
      const net = (paidExp + sentTr) - (oweExp + receivedTr);

      return { id, net };
    });
  }, [participantIds, paidBy, oweBy, transferMap]);

  // Totals
  const totalSpent = useMemo(
    () => expenses.reduce((s, e) => s + clampCents(e.amount_cents), 0),
    [expenses]
  );
  const totalDebt = useMemo(
    () => nets.filter((n) => n.net < 0).reduce((s, n) => s + Math.abs(n.net), 0),
    [nets]
  );
  const totalCredit = useMemo(
    () => nets.filter((n) => n.net > 0).reduce((s, n) => s + n.net, 0),
    [nets]
  );

  // Suggested settlements
  const suggestedTransfers = useMemo(() => settleGreedy(nets), [nets]);
  const isBalanced = suggestedTransfers.length === 0;

  // Name resolution
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      const id = memberId(m);
      if (!id) continue;
      map.set(id, nameOfMember(m, id.slice(0, 6)));
    }
    for (const e of expenses) {
      const id = safeId(e.user_id);
      if (!id || map.has(id)) continue;
      const fallback = (e.payer_name ?? '') || id.slice(0, 6);
      map.set(id, fallback);
    }
    return map;
  }, [members, expenses]);

  const nameOf = (id: string) => nameById.get(id) ?? id.slice(0, 6);
  const twoMembers = participantIds.length === 2;

  // --- Actions ---

  const handleSettle = async (fromId: string, toId: string, maxAmount: number) => {
    if (loading) return;

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

    setLoading(true);
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
      setLoading(false);
      setSettling(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      {/* Top Summary */}
      <section className="bg-zinc-800 border border-zinc-700 rounded-2xl shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-sm text-zinc-500">סה"כ הוצאות:</div>
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
      <div className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-2xl p-2 px-4">
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

      {/* Chart: Distribution */}
      <ExpensesPieChart expenses={monthlyExpenses} currency={currency} />

      {/* Chart: User Breakdown */}
      <UserMonthlyChart expenses={monthlyExpenses} members={chartMembers} currency={currency} />

      {/* Chart: Trend */}
      <SixMonthTrendChart expenses={expenses} currentDate={targetDate} currency={currency} />

      {/* Per User Status */}
      <section className="bg-zinc-800 border border-zinc-700 rounded-2xl shadow-sm p-4">
        <div className="text-sm font-medium mb-3 text-zinc-300">מאזנים אישיים</div>
        <ul className="space-y-2">
          {nets.map((n) => {
            const owes = n.net < -1; // tolerance
            const credits = n.net > 1;
            const zero = !owes && !credits;

            const otherName =
              twoMembers && owes
                ? nameOf(participantIds.find((id) => id !== n.id) || '')
                : 'לקבוצה';

            return (
              <li
                key={n.id}
                className="rounded-xl px-3 py-2 flex items-center justify-between"
                style={{
                  borderInlineStart: `6px solid ${userColor(n.id)}`,
                  backgroundColor: userBg(n.id),
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
        </ul>
      </section>

      {/* Suggested Settlements */}
      <section className="bg-zinc-800 border border-zinc-700 rounded-2xl shadow-sm p-4">
        <div className="text-sm font-medium mb-3 text-zinc-300">הצעת סגירת חוב (להעברה)</div>
        {isBalanced ? (
          <div className="text-zinc-500 text-sm text-center py-2">הכל מאוזן! אין חובות פתוחים. ✨</div>
        ) : (
          <ul className="space-y-2">
            {suggestedTransfers.map((t, idx) => {
              const key = `${t.from}-${t.to}`;
              const isMe = t.from === currentUserId || t.to === currentUserId; // Can I settle this?
              // Specifically, I can only PAY if I am 'from', or received if 'to' (maybe mark as received).
              // For simplicity, allowed if I am either party OR admin (omitted here for simplicity).
              const canSettle = currentUserId && (t.from === currentUserId || t.to === currentUserId);

              return (
                <li
                  key={key + idx}
                  className="rounded-xl px-3 py-3 flex items-center justify-between bg-zinc-900/50 border border-zinc-700/50"
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
                      disabled={loading}
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

        {!isBalanced && (
          <p className="mt-4 text-xs text-zinc-500 text-center">
            לחיצה על "סמן כשולם" תאפס את החוב הזה ע"י יצירת העברה.
          </p>
        )}
      </section>
    </div>
  );
}
