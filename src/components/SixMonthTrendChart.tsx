import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

/* ---------- Types ---------- */
type Expense = {
    amount_cents: number | string;
    occurred_on?: string;
    created_at?: string;
};

type Props = {
    expenses: Expense[]; // All time expenses
    currentDate?: Date;
    currency?: string;
};

export function SixMonthTrendChart({ expenses, currentDate = new Date(), currency = 'ILS' }: Props) {
    const data = useMemo(() => {
        // We want last 6 months inclusive of current month
        const result = [];
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        for (let i = 5; i >= 0; i--) {
            // Calculate target month
            const d = new Date(year, month - i, 1);
            const m = d.getMonth();
            const y = d.getFullYear();
            const label = d.toLocaleDateString('he-IL', { month: 'short' }); // e.g. "ינו׳"

            // Sum expenses for this month
            let total = 0;
            for (const e of expenses) {
                const date = new Date(e.occurred_on || e.created_at || '');
                if (date.getFullYear() === y && date.getMonth() === m) {
                    const amt = typeof e.amount_cents === 'string'
                        ? parseFloat(e.amount_cents)
                        : (e.amount_cents ?? 0);
                    total += amt;
                }
            }

            result.push({
                name: label,
                year: y, // debug
                month: m, // debug
                value: total / 100
            });
        }
        return result;
    }, [expenses, currentDate]);

    const hasData = data.some(d => d.value > 0);
    if (!hasData) return null;

    return (
        <div className="bg-zinc-800 border border-zinc-700 rounded-2xl shadow-sm p-4 flex flex-col">
            <h3 className="text-zinc-300 text-sm font-semibold mb-2 text-right">הוצאות חצי שנה אחרונה</h3>
            <div className="w-full h-[12.5rem]" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#3f3f46" />
                        <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} />
                        <Tooltip
                            formatter={(value: number) => [`₪${value.toFixed(0)}`, '']}
                            contentStyle={{ backgroundColor: '#27272a', borderColor: '#3f3f46', borderRadius: '8px', color: '#f4f4f5' }}
                        />
                        <Area type="monotone" dataKey="value" stroke="#6366f1" fillOpacity={1} fill="url(#colorVal)" strokeWidth={2} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
