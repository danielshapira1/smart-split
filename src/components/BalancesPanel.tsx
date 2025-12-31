import React, { useMemo } from 'react';
import { UserChip, userBg, userBorder, userColor } from '../lib/colors';

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
  amount_cents: number | string; // לעיתים חוזר כמחרוזת – נטפל בהמרה
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
  currency?: string;
};

/* ========= Small helpers ========= */

// המרה בטוחה לסנטים + אפס אם NaN
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

/** פיזור שווה של סכום בסנטים על רשימת משתמשים (כולל שאריות) */
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

    d.net += amount; // שלילי מתקדם ל-0
    c.net -= amount; // חיובי יורד ל-0

    if (Math.abs(d.net) < 1) i++;
    if (Math.abs(c.net) < 1) j++;
  }

  return res;
}

/* ========= Component ========= */

export default function BalancesPanel({ members, expenses, currency = 'ILS' }: Props) {
  // סט זהויות של כל המשתתפים (חברי קבוצה + כל מי ששילם הוצאה)
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
    return Array.from(set).sort();
  }, [members, expenses]);

  // כמה כל אחד שילם בפועל
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

  // כמה כל אחד היה אמור לשלם (חלוקה שווה לכל המשתתפים)
  const oweBy = useMemo(() => {
    const map = new Map<string, number>();
    for (const id of participantIds) map.set(id, 0);
    if (participantIds.length === 0) return map;

    for (const e of expenses) {
      const amount = clampCents(e.amount_cents);
      if (amount <= 0) continue;
      const share = evenSplitCents(amount, participantIds);
      for (const [id, chunk] of share.entries()) {
        map.set(id, (map.get(id) ?? 0) + chunk);
      }
    }
    return map;
  }, [participantIds, expenses]);

  // נטו לכל משתתף
  const nets = useMemo(
    () =>
      participantIds.map((id) => ({
        id,
        net: (paidBy.get(id) ?? 0) - (oweBy.get(id) ?? 0), // >0 מגיע לו, <0 חייב
      })),
    [participantIds, paidBy, oweBy]
  );

  // סכומים כוללים
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

  // הצעת סגירת חוב
  const transfers = useMemo(() => settleGreedy(nets), [nets]);
  const isBalanced = transfers.length === 0;

  // למקרה שמישהו שילם ולא קיים ב־members (דיבוג)
  const nonMemberPayers = useMemo(() => {
    const ms = new Set(members.map(memberId).filter(Boolean));
    const payers = new Set(expenses.map((e) => safeId(e.user_id)).filter(Boolean));
    return Array.from(payers).filter((id) => !ms.has(id));
  }, [members, expenses]);

  // מיפוי שם ידידותי למשתמש
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      const id = memberId(m);
      if (!id) continue;
      map.set(id, nameOfMember(m, id.slice(0, 6)));
    }
    // אם אין בממברים, ננסה משם משלם של הוצאות
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

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      {/* סיכום עליון */}
      <section className="bg-zinc-800 border border-zinc-700 rounded-2xl shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-sm text-zinc-500">סך הוצאות קבוצה:</div>
          <div className="font-bold text-zinc-100">{fmtCurrency(totalSpent, currency)}</div>

          <div className="ml-auto flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">יש חובות:</span>
              <span className="font-semibold text-rose-400">
                {fmtCurrency(totalDebt, currency)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">מגיע לקבל:</span>
              <span className="font-semibold text-emerald-400">
                {fmtCurrency(totalCredit, currency)}
              </span>
            </div>
          </div>
        </div>

        {nonMemberPayers.length > 0 && (
          <div className="mt-3 text-xs bg-amber-900/20 border border-amber-900/30 rounded-xl p-2 text-amber-200">
            שים לב: קיימות הוצאות של משתמשים שאינם ברשימת חברי הקבוצה. החישוב כולל גם אותם.
          </div>
        )}
      </section>

      {/* מצב לכל משתתף */}
      <section className="bg-zinc-800 border border-zinc-700 rounded-2xl shadow-sm p-4">
        <div className="text-sm font-medium mb-3 text-zinc-300">מאזנים לכל משתתף</div>
        <ul className="space-y-2">
          {nets.map((n) => {
            const owes = n.net < 0;
            const zero = n.net === 0;

            const otherName =
              twoMembers && owes
                ? nameOf(participantIds.find((id) => id !== n.id) || '')
                : 'הקבוצה';

            return (
              <li
                key={n.id}
                className="rounded-xl px-3 py-2 flex items-center justify-between"
                style={{
                  borderInlineStart: `6px solid ${userColor(n.id)}`,
                  backgroundColor: userBg(n.id), // We'll fix alpha in lib/colors.tsx
                  boxShadow: `0 1px 0 ${userBorder(n.id)} inset`,
                }}
              >
                <div className="text-sm text-zinc-200">
                  <UserChip uid={n.id} name={nameOf(n.id)} />{' '}
                  {zero
                    ? 'מאוזנ/ת'
                    : owes
                      ? `חייב/ת ל־${otherName}`
                      : 'מגיע לקבל'}
                </div>

                <div
                  className={`text-sm font-semibold ${owes ? 'text-rose-400' : n.net > 0 ? 'text-emerald-400' : 'text-zinc-500'
                    }`}
                >
                  {zero ? '' : fmtCurrency(Math.abs(n.net), currency)}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* הצעת סגירת חובות */}
      <section className="bg-zinc-800 border border-zinc-700 rounded-2xl shadow-sm p-4">
        <div className="text-sm font-medium mb-3 text-zinc-300">הצעת סגירת חוב</div>
        {isBalanced ? (
          <div className="text-zinc-500">הקבוצה מאוזנת — אין צורך בהעברות.</div>
        ) : (
          <ul className="space-y-2">
            {transfers.map((t, idx) => (
              <li
                key={`${t.from}-${t.to}-${idx}`}
                className="rounded-xl px-3 py-2 flex items-center justify-between"
                style={{
                  backgroundColor: userBg(t.from, 0.1), // increased alpha for dark mode
                  boxShadow: `0 1px 0 ${userBorder(t.from, 0.2)} inset`,
                }}
              >
                <div className="text-sm text-zinc-200">
                  <UserChip uid={t.from} name={nameOf(t.from)} /> חייב ל־{' '}
                  <UserChip uid={t.to} name={nameOf(t.to)} />
                </div>
                <div className="text-sm font-semibold text-zinc-100">
                  {fmtCurrency(t.amount, currency)}
                </div>
              </li>
            ))}
          </ul>
        )}

        {twoMembers && !isBalanced && transfers[0] && (
          <div className="mt-3 text-xs text-gray-500">
            מאחר ויש רק שני משתתפים: “{nameOf(transfers[0].from)} חייב ל־{nameOf(
              transfers[0].to
            )} {fmtCurrency(transfers[0].amount, currency)}”.
          </div>
        )}
      </section>
    </div>
  );
}
