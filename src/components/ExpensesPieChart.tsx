import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

/* ---------- Types ---------- */
type Expense = {
    amount_cents: number | string;
    category?: string;
};

type Props = {
    expenses: Expense[];
    currency?: string;
};

/* ---------- Colors ---------- */
const COLORS = [
    '#6366f1', // Indigo 500
    '#ec4899', // Pink 500
    '#10b981', // Emerald 500
    '#f59e0b', // Amber 500
    '#06b6d4', // Cyan 500
    '#8b5cf6', // Violet 500
    '#f43f5e', // Rose 500
    '#14b8a6', // Teal 500
];

const RADIAN = Math.PI / 180;
const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    // Only show label if segment is big enough
    if (percent < 0.05) return null;

    return (
        <text x={x} y={y} fill="white" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" className="text-[10px] font-bold">
            {`${(percent * 100).toFixed(0)}%`}
        </text>
    );
};

export function ExpensesPieChart({ expenses, currency = 'ILS' }: Props) {
    const data = useMemo(() => {
        const map = new Map<string, number>();

        for (const e of expenses) {
            const cat = e.category || 'אחר';
            const amount = typeof e.amount_cents === 'string'
                ? parseFloat(e.amount_cents)
                : (e.amount_cents ?? 0);

            map.set(cat, (map.get(cat) ?? 0) + amount);
        }

        // Convert to array
        const arr = Array.from(map.entries()).map(([name, value]) => ({
            name,
            value: value / 100, // convert to units
        }));

        // Sort descending
        arr.sort((a, b) => b.value - a.value);
        return arr;
    }, [expenses]);

    const total = data.reduce((sum, item) => sum + item.value, 0);

    if (total === 0) return null;

    return (
        <div className="bg-zinc-800 border border-zinc-700 rounded-2xl shadow-sm p-4 flex flex-col items-center">
            <h3 className="text-zinc-300 text-sm font-semibold mb-2 w-full text-right">התפלגות הוצאות</h3>
            <div className="w-full h-[250px]" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            outerRadius={80}
                            innerRadius={50}
                            fill="#8884d8"
                            dataKey="value"
                            paddingAngle={2}
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(value: number) => [`${currency} ${value.toFixed(2)}`, '']}
                            contentStyle={{ backgroundColor: '#27272a', borderColor: '#3f3f46', borderRadius: '8px', color: '#f4f4f5' }}
                            itemStyle={{ color: '#e4e4e7' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
