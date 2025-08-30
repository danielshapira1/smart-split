import React, { useMemo } from "react";
import {
  Member,
  Expense,
  computeNet,
  computeSettlements,
} from "../lib/settlements";

// נגזרת טיפוסים מהפונקציות עצמן כדי להיצמד בדיוק למבני ההחזרה
type NetEntry = ReturnType<typeof computeNet>[number];
type TransferEntry = ReturnType<typeof computeSettlements>[number];

type Props = {
  members: Member[];
  expenses: Expense[];
  currency?: string; // ILS by default
};

export default function BalancesPanel({
  members,
  expenses,
  currency = "ILS",
}: Props) {
  const nets: NetEntry[] = useMemo(
    () => computeNet(members ?? [], expenses ?? []),
    [members, expenses]
  );

  const transfers: TransferEntry[] = useMemo(
    () => computeSettlements(nets),
    [nets]
  );

  const totalPositive = nets
    .filter((n) => n.net_cents > 0)
    .reduce((s, n) => s + n.net_cents, 0);

  const totalNegative = nets
    .filter((n) => n.net_cents < 0)
    .reduce((s, n) => s + n.net_cents, 0);

  return (
    <div className="space-y-4">
      {/* סיכום כללי */}
      <div className="rounded-2xl border p-4 bg-white">
        <div className="text-sm text-gray-600">סיכום</div>
        <div className="mt-1 flex gap-6 text-sm">
          <div className="text-emerald-700">
            מגיע לקבל: ₪{(totalPositive / 100).toFixed(2)}
          </div>
          <div className="text-rose-700">
            סך חובות: ₪{(-totalNegative / 100).toFixed(2)}
          </div>
        </div>
      </div>

      {/* נטו לכל משתתף */}
      <div className="rounded-2xl border p-4 bg-white">
        <div className="font-medium mb-3">מאזנים לכל משתתף</div>
        <ul className="divide-y">
          {nets.map((n) => (
            <li key={n.uid} className="py-2 flex items-center justify-between">
              <span className="truncate">{n.name}</span>
              <span
                className={
                  n.net_cents > 0
                    ? "text-emerald-700 font-medium"
                    : n.net_cents < 0
                    ? "text-rose-700 font-medium"
                    : "text-gray-500"
                }
              >
                {n.net_cents === 0
                  ? "מאוזן"
                  : `${n.net_cents > 0 ? "מגיע לו" : "חייב"} ₪${(
                      Math.abs(n.net_cents) / 100
                    ).toFixed(2)}`}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* הצעות לסגירת חשבון */}
      <div className="rounded-2xl border p-4 bg-white">
        <div className="font-medium mb-3">הצעות לסגירת חשבון</div>
        {transfers.length === 0 ? (
          <div className="text-gray-500 text-sm">
            הקבוצה מאוזנת — אין צורך בהעברות.
          </div>
        ) : (
          <ul className="space-y-2">
            {transfers.map((t, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"
              >
                <span className="truncate">
                  <span className="font-medium">{t.from_name}</span> ➜{" "}
                  <span className="font-medium">{t.to_name}</span>
                </span>
                <span className="text-sm font-semibold text-slate-800">
                  ₪{(t.amount_cents / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
