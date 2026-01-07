import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { userColor } from '../lib/colors';

/* ---------- Types ---------- */
type Expense = {
    user_id: string;
    amount_cents: number | string;
    payer_name?: string | null;
};

type Member = {
    user_id?: string;
    name?: string;
};

type Props = {
    expenses: Expense[];
    members: Member[];
    currency?: string;
};

export function UserMonthlyChart({ expenses, members, currency = 'ILS' }: Props) {
    const data = useMemo(() => {
        const map = new Map<string, number>();

        // Init with members to show even 0
        for (const m of members) {
            if (m.user_id) map.set(m.user_id, 0);
        }

        for (const e of expenses) {
            const amt = typeof e.amount_cents === 'string'
                ? parseFloat(e.amount_cents)
                : (e.amount_cents ?? 0);

            const uid = e.user_id;
            map.set(uid, (map.get(uid) ?? 0) + amt);
        }

        // Convert to array
        const arr = Array.from(map.entries()).map(([uid, val]) => {
            const mem = members.find(m => m.user_id === uid);
            const name = mem?.name || uid.slice(0, 4);
            return {
                name,
                uid,
                value: val / 100
            };
        });

        // Remove zero if too many? or keep to show who didn't pay?
        // Let's filter out absolute 0 if there are many members, but for small groups show all.
        return arr.sort((a, b) => b.value - a.value);
    }, [expenses, members]);

    if (data.every(d => d.value === 0)) return null;

    return (
        <div className="bg-zinc-800 border border-zinc-700 rounded-2xl shadow-sm p-4 flex flex-col">
            <h3 className="text-zinc-300 text-sm font-semibold mb-2 text-right">כמה שילם כל אחד (החודש)</h3>
            <div className="w-full h-[12.5rem]" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20 }}>
                        <XAxis type="number" hide />
                        <YAxis
                            type="category"
                            dataKey="name"
                            width={80}
                            tick={{ fill: '#f4f4f5', fontSize: 12 }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip
                            cursor={{ fill: '#3f3f46', opacity: 0.4 }}
                            formatter={(value: number) => [`₪${value.toFixed(0)}`, '']}
                            contentStyle={{ backgroundColor: '#27272a', borderColor: '#3f3f46', borderRadius: '8px', color: '#f4f4f5' }}
                        />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={userColor(entry.uid)} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
