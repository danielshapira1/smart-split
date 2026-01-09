import React, { useRef, useState, useEffect } from 'react';
import { Download, Upload, X, AlertTriangle, Check, Loader2, User, LogOut, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import type { Group, Profile } from '../lib/types';
import { RecurringExpensesList } from './RecurringExpensesList';

type Props = {
    group: Group;
    profile: Profile | null;
    onClose: () => void;
    onRefresh: () => void;
    onLogout: () => void;
};

export function GroupSettings({ group, profile, onClose, onRefresh, onLogout }: Props) {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [replaceMode, setReplaceMode] = useState(false);
    const [showRecurring, setShowRecurring] = useState(false);

    // Profile State
    const [displayName, setDisplayName] = useState(profile?.display_name || '');
    const [savingProfile, setSavingProfile] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (profile) setDisplayName(profile.display_name || '');
    }, [profile]);

    // --- PROFILE SAVE ---
    const handleSaveProfile = async () => {
        if (!profile) return;
        try {
            setSavingProfile(true);
            const { error } = await supabase
                .from('profiles')
                .update({ display_name: displayName })
                .eq('id', profile.id);

            if (error) throw error;

            setMessage({ type: 'success', text: 'הפרופיל עודכן בהצלחה!' });
            onRefresh();
        } catch (err: any) {
            console.error('Profile update failed:', err);
            setMessage({ type: 'error', text: 'שגיאה בעדכון הפרופיל: ' + err.message });
        } finally {
            setSavingProfile(false);
        }
    };

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

        // Reset value
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
                return {
                    group_id: group.id,
                    user_id: ex.user_id,
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
            <div className="bg-zinc-900/80 backdrop-blur-xl border border-white/10 w-full max-w-sm rounded-3xl p-6 shadow-2xl flex flex-col gap-5 relative max-h-[85vh] overflow-y-auto">
                <button
                    onClick={onClose}
                    className="absolute top-4 left-4 p-2 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded-full transition-colors"
                >
                    <X className="w-5 h-5" />
                </button>

                <h2 className="text-xl font-bold text-zinc-100">
                    {showRecurring ? 'הוראות קבע' : 'הגדרות'}
                </h2>

                {showRecurring ? (
                    <div className="animate-in slide-in-from-right-4 duration-200">
                        <button
                            onClick={() => setShowRecurring(false)}
                            className="text-sm text-indigo-400 hover:text-indigo-300 mb-4 flex items-center gap-1 font-medium px-2 py-1 rounded-lg hover:bg-indigo-500/10 w-max transition-colors"
                        >
                            ← חזרה להגדרות
                        </button>
                        <RecurringExpensesList group={group} />
                    </div>
                ) : (
                    <>
                        {/* Profile Section */}
                        <div className="space-y-3 pt-2">
                            <h3 className="font-medium text-zinc-200 flex items-center gap-2 text-sm">
                                <User className="w-4 h-4 text-indigo-400" /> פרופיל משתמש
                            </h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs text-zinc-400 block mb-1.5 font-medium">שם לתצוגה</label>
                                    <div className="flex gap-2">
                                        <input
                                            value={displayName}
                                            onChange={e => setDisplayName(e.target.value)}
                                            className="flex-1 rounded-xl bg-zinc-800/50 border border-white/5 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all placeholder:text-zinc-600"
                                            placeholder="השם שלך בקבוצה"
                                        />
                                        <button
                                            onClick={handleSaveProfile}
                                            disabled={savingProfile}
                                            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl transition-colors whitespace-nowrap font-medium shadow-lg shadow-indigo-900/20"
                                        >
                                            {savingProfile ? '...' : 'שמור'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <hr className="border-white/5 my-1" />

                        {/* Recurring Expenses Entry */}
                        <button
                            onClick={() => setShowRecurring(true)}
                            className="w-full p-4 bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 hover:from-zinc-800 hover:to-zinc-800 rounded-2xl border border-white/5 flex items-center justify-between group transition-all duration-200 shadow-sm"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-indigo-500/10 rounded-xl group-hover:bg-indigo-500/20 transition-colors">
                                    <Calendar className="w-5 h-5 text-indigo-400" />
                                </div>
                                <div className="text-right">
                                    <div className="text-sm font-semibold text-zinc-200">הוראות קבע</div>
                                    <div className="text-xs text-zinc-500">ניהול תשלומים קבועים</div>
                                </div>
                            </div>
                            <div className="text-zinc-500 group-hover:translate-x-[-2px] transition-transform">←</div>
                        </button>

                        <hr className="border-white/5 my-1" />

                        <div className="space-y-3">
                            {/* Export */}
                            <div className="p-4 bg-zinc-800/20 rounded-2xl border border-white/5">
                                <h3 className="font-medium text-zinc-200 mb-1 flex items-center gap-2 text-sm">
                                    <Download className="w-4 h-4 text-indigo-400" /> ייצוא נתונים
                                </h3>
                                <p className="text-xs text-zinc-500 mb-3 leading-relaxed opacity-80">
                                    הורד קובץ JSON עם כל ההוצאות וההעברות.
                                </p>
                                <button
                                    onClick={handleExport}
                                    disabled={loading}
                                    className="w-full py-2.5 bg-zinc-800/80 hover:bg-zinc-700 border border-white/5 rounded-xl text-sm transition-colors text-zinc-200 flex items-center justify-center gap-2 font-medium"
                                >
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'ייצא לקובץ'}
                                </button>
                            </div>

                            {/* Import */}
                            <div className="p-4 bg-zinc-800/20 rounded-2xl border border-white/5">
                                <h3 className="font-medium text-zinc-200 mb-1 flex items-center gap-2 text-sm">
                                    <Upload className="w-4 h-4 text-emerald-400" /> ייבוא נתונים
                                </h3>
                                <p className="text-xs text-zinc-500 mb-3 leading-relaxed opacity-80">
                                    טען נתונים מקובץ גיבוי.
                                </p>

                                <label className="flex items-center gap-2 mb-3 cursor-pointer group select-none">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            checked={replaceMode}
                                            onChange={e => setReplaceMode(e.target.checked)}
                                            className="peer sr-only "
                                        />
                                        <div className="w-9 h-5 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500/80"></div>
                                    </div>
                                    <span className="text-xs text-zinc-400 group-hover:text-zinc-300 transition-colors">
                                        שחזור מלא (מחיקת מידע קיים)
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
                                    className="w-full py-2.5 bg-zinc-800/80 hover:bg-zinc-700 border border-white/5 rounded-xl text-sm transition-colors text-zinc-200 flex items-center justify-center gap-2 font-medium"
                                >
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'בחר קובץ לייבוא'}
                                </button>
                            </div>
                        </div>

                        {message && (
                            <div className={`p-3 rounded-xl text-sm flex items-start gap-2 ${message.type === 'success' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20'
                                }`}>
                                {message.type === 'success' ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                                <span>{message.text}</span>
                            </div>
                        )}

                        <div className="mt-2 border-t border-white/5 pt-4">
                            <button
                                onClick={onLogout}
                                className="w-full py-3 rounded-2xl border border-red-500/10 bg-red-500/5 hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors flex items-center justify-center gap-2 font-medium"
                            >
                                <LogOut className="w-4 h-4" /> התנתק
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
