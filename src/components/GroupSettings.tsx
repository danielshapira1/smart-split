import React, { useRef, useState } from 'react';
import { Download, Upload, X, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import type { Group, Expense } from '../lib/types';
import type { Transfer } from '../hooks/useRealtimeExpenses';

type Props = {
    group: Group;
    onClose: () => void;
    onRefresh: () => void;
};

export function GroupSettings({ group, onClose, onRefresh }: Props) {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [replaceMode, setReplaceMode] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- EXPORT ---
    const handleExport = async () => {
        try {
            setLoading(true);
            setMessage(null);

            // 1. Fetch Expenses
            const { data: expenses, error: eErr } = await supabase
                .from('expenses')
                .select(`
          *,
          payer:profiles(display_name,email)
        `)
                .eq('group_id', group.id);

            if (eErr) throw eErr;

            // 2. Fetch Transfers
            const { data: transfers, error: tErr } = await supabase
                .from('transfers')
                .select('*')
                .eq('group_id', group.id);

            if (tErr) throw tErr;

            // 3. Construct JSON
            const exportData = {
                meta: {
                    version: 1,
                    exported_at: new Date().toISOString(),
                    group_name: group.name,
                    platform: 'smart-split',
                },
                group: { ...group },
                expenses: expenses || [],
                transfers: transfers || [],
            };

            // 4. Trigger Download
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `smart-split-${group.name.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setMessage({ type: 'success', text: 'הייצוא הושלם בהצלחה!' });
        } catch (err: any) {
            console.error('Export failed:', err);
            setMessage({ type: 'error', text: 'שגיאה בייצוא: ' + err.message });
        } finally {
            setLoading(false);
        }
    };

    // --- IMPORT ---
    const handleImportScroll = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset value so we can select the same file again if needed
        e.target.value = '';

        if (replaceMode) {
            if (!confirm('אזהרה: בחרת במצב "שחזור מלא".\nכל הנתונים הקיימים בקבוצה יימחקו ויוחלפו בנתונים מהקובץ.\nפעולה זו אינה הפיכה.\n\nהאם להמשיך?')) {
                return;
            }
        } else {
            if (!confirm('ייבוא נתונים יוסיף את ההוצאות וההעברות מהקובץ לקבוצה הנוכחית (ללא מחיקה).\nהאם להמשיך?')) {
                return;
            }
        }

        try {
            setLoading(true);
            setMessage(null);

            const text = await file.text();
            const json = JSON.parse(text);

            if (!json.expenses && !json.transfers) {
                throw new Error('קובץ לא תקין: חסרים נתונים (expenses/transfers)');
            }

            // Check group mismatch
            if (json.group?.id && json.group.id !== group.id) {
                const proceed = confirm(
                    `שים לב: קובץ זה נוצר עבור קבוצה אחרת ("${json.group.name || 'לא ידועה'}").\n` +
                    'ייבוא הנתונים יערבב אותם בקבוצה הנוכחית.\n\n' +
                    'האם אתה בטוח שברצונך להמשיך?'
                );
                if (!proceed) {
                    setLoading(false);
                    return;
                }
            }

            const newExpenses = (json.expenses || []).map((ex: any) => {
                // We strip ID to create new ones
                // We try to keep the original user_id. 
                // Note: 'payer_name' logic removed because the column does not exist in the DB.
                // We rely on 'user_id' being valid or just displaying 'Unknown' if the user is missing.

                return {
                    group_id: group.id, // Enforce current group
                    user_id: ex.user_id, // Keep original user if possible
                    amount_cents: ex.amount_cents,
                    currency: ex.currency,
                    description: ex.description,
                    category: ex.category,
                    occurred_on: ex.occurred_on,
                    created_at: ex.created_at || new Date().toISOString(),
                };
            });

            const newTransfers = (json.transfers || []).map((tr: any) => ({
                group_id: group.id,
                from_user: tr.from_user,
                to_user: tr.to_user,
                amount_cents: tr.amount_cents,
                note: tr.note,
                created_at: tr.created_at || new Date().toISOString(),
            }));

            // Bulk insert
            if (replaceMode) {
                // Delete existing first
                const { error: dErr1 } = await supabase.from('expenses').delete().eq('group_id', group.id);
                if (dErr1) throw dErr1;
                const { error: dErr2 } = await supabase.from('transfers').delete().eq('group_id', group.id);
                if (dErr2) throw dErr2;
            }

            if (newExpenses.length > 0) {
                const { error: eErr } = await supabase.from('expenses').insert(newExpenses);
                if (eErr) throw eErr;
            }

            if (newTransfers.length > 0) {
                const { error: tErr } = await supabase.from('transfers').insert(newTransfers);
                if (tErr) throw tErr;
            }

            setMessage({ type: 'success', text: `ייבוא הושלם: ${newExpenses.length} הוצאות, ${newTransfers.length} העברות.` });
            onRefresh();
        } catch (err: any) {
            console.error('Import failed:', err);
            setMessage({ type: 'error', text: 'שגיאה בייבוא: ' + err.message });
        } finally {
            setLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-zinc-800 border border-zinc-700 w-full max-w-sm rounded-2xl p-6 shadow-xl flex flex-col gap-4 relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 left-4 p-2 text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                    <X className="w-5 h-5" />
                </button>

                <h2 className="text-xl font-bold text-zinc-100">הגדרות קבוצה</h2>
                <p className="text-sm text-zinc-400 -mt-2">
                    {group.name}
                </p>

                <div className="space-y-4 pt-2">
                    {/* Export */}
                    <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-700/50">
                        <h3 className="font-medium text-zinc-200 mb-1 flex items-center gap-2">
                            <Download className="w-4 h-4 text-indigo-400" /> ייצוא נתונים
                        </h3>
                        <p className="text-xs text-zinc-500 mb-3">
                            הורד קובץ JSON עם כל ההוצאות וההעברות של הקבוצה לגיבוי.
                        </p>
                        <button
                            onClick={handleExport}
                            disabled={loading}
                            className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-lg text-sm transition-colors text-zinc-200 flex items-center justify-center gap-2"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'ייצא לקובץ'}
                        </button>
                    </div>

                    {/* Import */}
                    <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-700/50">
                        <h3 className="font-medium text-zinc-200 mb-1 flex items-center gap-2">
                            <Upload className="w-4 h-4 text-emerald-400" /> ייבוא נתונים
                        </h3>
                        <p className="text-xs text-zinc-500 mb-3">
                            טען נתונים מקובץ גיבוי.
                        </p>

                        <label className="flex items-center gap-2 mb-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={replaceMode}
                                onChange={e => setReplaceMode(e.target.checked)}
                                className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-indigo-600 focus:ring-indigo-600 focus:ring-offset-zinc-900"
                            />
                            <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">
                                נקה נתונים קיימים לפני הייבוא (שחזור מלא)
                            </span>
                        </label>

                        <input
                            type="file"
                            accept=".json"
                            className="hidden"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                        />
                        <button
                            onClick={handleImportScroll}
                            disabled={loading}
                            className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-lg text-sm transition-colors text-zinc-200 flex items-center justify-center gap-2"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'בחר קובץ לייבוא'}
                        </button>
                    </div>
                </div>

                {message && (
                    <div className={`p-3 rounded-lg text-sm flex items-start gap-2 ${message.type === 'success' ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-800' : 'bg-red-900/30 text-red-300 border border-red-800'
                        }`}>
                        {message.type === 'success' ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                        <span>{message.text}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
