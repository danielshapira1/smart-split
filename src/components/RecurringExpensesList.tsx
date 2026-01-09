import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Loader2, Trash2, Calendar, Repeat } from 'lucide-react';
import type { Group } from '../lib/types';

type RecurringExpense = {
    id: string;
    description: string;
    amount_cents: number;
    currency: string;
    frequency: 'monthly' | 'weekly';
    next_run: string;
    active: boolean;
    created_at: string;
};

type Props = {
    group: Group;
};

export function RecurringExpensesList({ group }: Props) {
    const [expenses, setExpenses] = useState<RecurringExpense[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const fetchRecurring = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('recurring_expenses')
                .select('*')
                .eq('group_id', group.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setExpenses(data || []);
        } catch (err) {
            console.error('Failed to fetch recurring expenses:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRecurring();
    }, [group.id]);

    const handleDelete = async (id: string) => {
        if (!confirm('האם אתה בטוח שברצונך למחוק הוראת קבע זו?')) return;
        try {
            setDeletingId(id);
            const { error } = await supabase
                .from('recurring_expenses')
                .delete()
                .eq('id', id);

            if (error) throw error;
            setExpenses(prev => prev.filter(e => e.id !== id));
        } catch (err) {
            console.error('Failed to delete recurring expense:', err);
            alert('מחיקה נכשלה');
        } finally {
            setDeletingId(null);
        }
    };

    if (loading) return <div className="p-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>;

    if (expenses.length === 0) {
        return <div className="p-4 text-center text-sm text-zinc-500">אין הוראות קבע פעילות בקבוצה זו.</div>;
    }

    return (
        <div className="space-y-3">
            {expenses.map(ex => (
                <div key={ex.id} className="bg-zinc-800/40 backdrop-blur-sm p-3 rounded-xl border border-white/5 flex justify-between items-center group hover:bg-zinc-800/60 transition-colors">
                    <div>
                        <div className="font-medium text-zinc-200">{ex.description || 'ללא תיאור'}</div>
                        <div className="text-xs text-zinc-500 flex items-center gap-2 mt-1">
                            <span className="flex items-center gap-1">
                                <Repeat className="w-3 h-3" />
                                {ex.frequency === 'monthly' ? 'כל חודש' : 'כל שבוע'}
                            </span>
                            <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                חיוב הבא: {new Date(ex.next_run).toLocaleDateString('he-IL')}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-zinc-100 font-bold whitespace-nowrap" dir="ltr">
                            {ex.currency} {(ex.amount_cents / 100).toFixed(2)}
                        </div>
                        <button
                            onClick={() => handleDelete(ex.id)}
                            disabled={deletingId === ex.id}
                            className="p-2 text-zinc-500 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
                            title="מחק הוראת קבע"
                        >
                            {deletingId === ex.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
