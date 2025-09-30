import React, { useMemo } from 'react'
import clsx from 'clsx'
import type { Member } from '../lib/settlements'

/** מינימלי – מספיק למסך המאזנים */
type ExpenseLike = {
  id: string
  user_id: string
  amount_cents: number
  payer_name?: string
}

type Props = {
  members: Member[]              // [{ user_id?/uid?/id, name? }]
  expenses: ExpenseLike[]        // מה-hook של ההוצאות
  currency?: string              // ברירת מחדל '₪'
}

/* ---------- helpers ---------- */

const C = (v: number) => Math.round(v) // אנחנו עובדים באגורות – מספרים שלמים

const fmt = (cents: number, currency = '₪') =>
  `${currency}${(cents / 100).toFixed(2)}`

/** מזהה אחיד לחבר – תומך uid/user_id/id */
function idOf(m: any): string {
  return m?.uid ?? m?.user_id ?? m?.id ?? ''
}

/** שם מוצג למשתמש */
function nameOf(uid: string, members: Member[], expenses: ExpenseLike[]) {
  const m = members.find(x => idOf(x) === uid) as any
  if (m?.name) return m.name
  const exp = expenses.find(e => e.user_id === uid && e.payer_name)?.payer_name
  return exp || uid
}

/** חלוקה שוויונית באגורות + פיזור שאריות דטרמיניסטי לפי סדר id */
function evenSplitCents(total: number, idsInStableOrder: string[]) {
  const n = idsInStableOrder.length
  if (n <= 0) return new Map<string, number>()

  const base = Math.floor(total / n)
  let remainder = total - base * n

  const res = new Map<string, number>()
  idsInStableOrder.forEach((id, i) => {
    res.set(id, base + (i < remainder ? 1 : 0))
  })
  return res
}

/* ---------- component ---------- */

export default function BalancesPanel({ members, expenses, currency = '₪' }: Props) {
  const memberIds = useMemo(() => {
    const ids = members.map(idOf).filter(Boolean)
    return Array.from(new Set(ids)) // ייחוד
  }, [members])

  const orderedIds = useMemo(() => [...memberIds].sort(), [memberIds])

  /* כמה כל אחד שילם */
  const paidBy = useMemo(() => {
    const map = new Map<string, number>()
    orderedIds.forEach(id => map.set(id, 0))
    for (const e of expenses) {
      map.set(e.user_id, (map.get(e.user_id) ?? 0) + C(e.amount_cents ?? 0))
    }
    return map
  }, [orderedIds, expenses])

  /* כמה כל אחד אמור לשלם (חלוקה שווה של כל ההוצאות) */
  const oweBy = useMemo(() => {
    const map = new Map<string, number>()
    orderedIds.forEach(id => map.set(id, 0))

    if (orderedIds.length === 0) return map

    for (const e of expenses) {
      const distr = evenSplitCents(C(e.amount_cents ?? 0), orderedIds)
      distr.forEach((piece, uid) => {
        map.set(uid, (map.get(uid) ?? 0) + piece)
      })
    }
    return map
  }, [orderedIds, expenses])

  /* נטו לכל משתמש: חיובי = מגיע לקבל, שלילי = חייב לשלם */
  const nets = useMemo(() => {
    return orderedIds.map(id => ({
      id,
      net: (paidBy.get(id) ?? 0) - (oweBy.get(id) ?? 0),
    }))
  }, [orderedIds, paidBy, oweBy])

  const total = useMemo(
    () => expenses.reduce((s, e) => s + C(e.amount_cents ?? 0), 0),
    [expenses]
  )

  /* הפקת העברות לסגירה */
  const transfers = useMemo(() => {
    type Net = { id: string; net: number }

    const creditors: Net[] = nets.filter(n => n.net > 0).map(n => ({ ...n })).sort((a,b)=>b.net-a.net)
    const debtors:   Net[] = nets.filter(n => n.net < 0).map(n => ({ ...n })).sort((a,b)=>a.net-b.net)

    const res: { from: string; to: string; amount: number }[] = []

    let i = 0, j = 0
    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];     if (!debtor) break
      const creditor = creditors[j]; if (!creditor) break

      const need = Math.min(-debtor.net, creditor.net)
      if (need > 0) {
        res.push({ from: debtor.id, to: creditor.id, amount: need })
        debtor.net += need
        creditor.net -= need
      }

      if (debtor.net >= 0) i++
      if (creditor.net <= 0) j++
    }

    return res
  }, [nets])

  const isBalanced = transfers.length === 0

  const summaryTotals = useMemo(() => {
    const toReceive = nets.filter(n => n.net > 0).reduce((s,n)=>s+n.net, 0)
    const toPay     = nets.filter(n => n.net < 0).reduce((s,n)=>s+(-n.net), 0)
    return { toReceive, toPay }
  }, [nets])

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-12">
      {/* סיכום עליון */}
      <section className="bg-white rounded-2xl shadow p-4">
        <div className="text-sm text-gray-500 mb-2">סיכום</div>
        <div className="flex items-center gap-6 text-sm">
          <div className="text-emerald-700">
            מגיע לקבל: <b>{fmt(summaryTotals.toReceive, currency)}</b>
          </div>
          <div className="text-rose-700">
            יש חובות: <b>{fmt(summaryTotals.toPay, currency)}</b>
          </div>
          <div className="ms-auto text-gray-500">
            סה״כ הוצאות קבוצה: <b>{fmt(total, currency)}</b>
          </div>
        </div>
      </section>

      {/* מצב לכל משתתף */}
      <section className="bg-white rounded-2xl shadow p-4">
        <div className="text-sm text-gray-500 mb-3">מאזנים לכל משתתפים</div>
        <ul className="grid grid-cols-1 gap-2">
          {nets.map(({ id, net }) => {
            const zero = net === 0
            const pos  = net > 0
            return (
              <li
                key={id}
                className={clsx(
                  'flex items-center justify-between rounded-xl px-3 py-2 border',
                  zero && 'bg-gray-50',
                  pos && 'bg-emerald-50 border-emerald-200',
                  !pos && !zero && 'bg-rose-50 border-rose-200'
                )}
              >
                <div className="font-medium">{nameOf(id, members, expenses)}</div>
                <div className={clsx(
                  'text-sm',
                  zero && 'text-gray-500',
                  pos && 'text-emerald-700',
                  !pos && !zero && 'text-rose-700'
                )}>
                  {zero
                    ? 'מאוזן/ת'
                    : pos
                    ? `מגיע לקבל ${fmt(net, currency)}`
                    : `חייב/ת ${fmt(-net, currency)}`}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {/* הצעות לסגירת חשבון */}
      <section className="bg-white rounded-2xl shadow p-4">
        <div className="text-sm text-gray-500 mb-3">הצעות לסגירת חשבון</div>
        {isBalanced ? (
          <div className="text-gray-500">הקבוצה מאוזנת — אין צורך בהעברה.</div>
        ) : (
          <ul className="space-y-2">
            {transfers.map((t, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between rounded-xl px-3 py-2 border bg-slate-50"
              >
                <div className="text-sm">
                  <b>{nameOf(t.from, members, expenses)}</b> ישלם/תשלם ל־
                  <b> {nameOf(t.to, members, expenses)}</b>
                </div>
                <div className="font-semibold">{fmt(t.amount, currency)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
