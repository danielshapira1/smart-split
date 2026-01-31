import React, { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { saveExpenseRow } from "../lib/supaRest";
import { DatePicker } from "./DatePicker";

type Member = {
  user_id?: string;
  display_name?: string;
  email?: string;
};

type Props = {
  groupId: string;
  currentPayerName: string;
  categories: string[];
  members: Member[]; // Added members prop
  onClose: () => void;
  onSaved: () => void;
  initialData?: {
    id: string;
    amount_cents: number;
    description: string | null;
    category: string | null;
    occurred_on: string;
    currency: string | null;
  } | null;
};

export function ExpenseForm({ groupId, currentPayerName, categories, members, onClose, onSaved, initialData }: Props) {
  // State for members
  const [localMembers, setLocalMembers] = useState<Member[]>(members);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  // Fetch members on mount
  React.useEffect(() => {
    let mounted = true;
    async function loadMembers() {
      // Get current session user
      const { data: { session } } = await supabase.auth.getSession();
      if (mounted && session?.user) {
        setCurrentUserId(session.user.id);
      }

      // Use the secure RPC that guarantees names
      const { data, error } = await supabase.rpc('get_group_members', { p_group_id: groupId });
      if (!error && data && mounted) {
        // Map RPC result to Member type
        const mapped: Member[] = data.map((m: any) => ({
          user_id: m.user_id,
          display_name: m.display_name,
          email: m.email
        }));
        setLocalMembers(mapped);

        // If we are in custom mode and had empty splits, re-init them with new members
        setCustomSplits(prev => {
          // Only re-init if we have a mismatch in length or empty
          if (prev.length === 0 || prev.length !== mapped.length) {
            return mapped.map(m => ({ user_id: m.user_id!, amount: 0 }));
          }
          return prev;
        });
      }
    }
    loadMembers();
    return () => { mounted = false; };
  }, [groupId]);

  // Use localMembers instead of members prop for the rest of the component
  const activeMembers = localMembers.length > 0 ? localMembers : members;

  const [amount, setAmount] = useState<string>(
    initialData ? (initialData.amount_cents / 100).toString() : ""
  );
  const [currency, setCurrency] = useState(initialData?.currency || "ILS");
  const [description, setDescription] = useState(initialData?.description || "");
  const [category, setCategory] = useState<string>(initialData?.category || (categories[0] ?? "אחר"));
  const [date, setDate] = useState<string>(
    initialData?.occurred_on || new Date().toISOString().slice(0, 10)
  );
  const [saving, setSaving] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState("monthly");

  // Split Mode State
  const [splitMode, setSplitMode] = useState<'equal' | 'direct' | 'custom'>(() => {
    // Persist mode in localStorage
    return (localStorage.getItem('expense_split_mode') as 'equal' | 'direct' | 'custom') || 'equal';
  });

  // For 'direct' mode: who is the beneficiary?
  const [directBeneficiary, setDirectBeneficiary] = useState<string>("");

  // For 'custom' mode: list of { user_id, amount }
  // Initialize with empty or 0 for all members
  const [customSplits, setCustomSplits] = useState<{ user_id: string; amount: number }[]>(() => {
    return activeMembers.map(m => ({ user_id: m.user_id!, amount: 0 }));
  });

  const handleSplitModeChange = (mode: 'equal' | 'direct' | 'custom') => {
    setSplitMode(mode);
    localStorage.setItem('expense_split_mode', mode);
  };

  // Auto-select beneficiary in direct mode
  React.useEffect(() => {
    if (splitMode === 'direct' && !directBeneficiary && currentUserId && activeMembers.length > 0) {
      // Find a member that is not the current user
      const otherMember = activeMembers.find(m => m.user_id !== currentUserId);
      if (otherMember?.user_id) {
        setDirectBeneficiary(otherMember.user_id);
      }
    }
  }, [splitMode, directBeneficiary, currentUserId, activeMembers]);

  const save = async () => {
    try {
      setSaving(true);
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("Not authenticated");

      const amountCents = Math.round(Number(amount || 0) * 100);

      if (isRecurring) {
        // Recurring logic (Equal split only for now as requested/implied)
        const { error } = await supabase.from('recurring_expenses').insert({
          group_id: groupId,
          user_id: uid,
          amount_cents: amountCents,
          currency,
          description,
          category,
          frequency,
          next_run: date,
        });
        if (error) throw error;
        await supabase.rpc('process_recurring_expenses');
      } else {
        // Normal Expense

        // Construct Splits
        let splits: { user_id: string; amount_cents: number }[] = [];

        if (splitMode === 'direct') {
          if (!directBeneficiary) {
            alert("אנא בחר עבור מי ההוצאה");
            setSaving(false);
            return;
          }
          // The beneficiary owes 100% of the amount
          splits = [{
            user_id: directBeneficiary,
            amount_cents: amountCents
          }];
        } else if (splitMode === 'custom') {
          const totalSplit = customSplits.reduce((acc, curr) => acc + (curr.amount || 0), 0);
          // Tolerance check for floating point issues?
          if (Math.abs(totalSplit - Number(amount || 0)) > 0.1) {
            alert(`סכום החלוקה (${totalSplit}) אינו תואם לסכום ההוצאה (${amount})`);
            setSaving(false);
            return;
          }

          splits = customSplits.map(s => ({
            user_id: s.user_id,
            amount_cents: Math.round(s.amount * 100)
          })).filter(s => s.amount_cents > 0);
        }
        // If 'equal', we send empty splits array, backend defaults to equal.

        await saveExpenseRow({
          id: initialData?.id,
          group_id: groupId,
          user_id: uid,
          amount_cents: amountCents,
          currency,
          description,
          category,
          occurred_on: date,
          splits: splits // Pass the splits
        });
      }

      onSaved();
    } catch (e: any) {
      alert(e?.message ?? "שמירת הוצאה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-zinc-900/80 backdrop-blur-xl border border-white/10 w-full max-w-md rounded-2xl p-4 sm:p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-zinc-100">
          {initialData ? "עריכת הוצאה" : "הוספת הוצאה"}
        </h2>

        <div className="space-y-3">
          <input
            placeholder="תיאור ההוצאה"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl border border-white/5 bg-zinc-800/50 px-4 py-3 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder-zinc-500"
          />

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-xl border border-white/5 bg-zinc-800/50 px-4 py-3 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all appearance-none"
          >
            {categories.map((c) => <option key={c} value={c} className="bg-zinc-800 text-zinc-100">{c}</option>)}
          </select>

          {/* Split Mode Toggles */}
          {!initialData && !isRecurring && (
            <div className="flex gap-2 p-1 bg-zinc-800/50 rounded-xl border border-white/5">
              <button
                onClick={() => handleSplitModeChange('equal')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${splitMode === 'equal' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                שווה
              </button>
              <button
                onClick={() => handleSplitModeChange('direct')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${splitMode === 'direct' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                ישיר
              </button>
              <button
                onClick={() => handleSplitModeChange('custom')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${splitMode === 'custom' ? 'bg-emerald-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                מותאם
              </button>
            </div>
          )}

          {/* Direct Mode UI */}
          {splitMode === 'direct' && !initialData && !isRecurring && (
            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
              <label className="text-xs text-zinc-400 block mb-1.5 mr-1 font-medium">עבור מי שולם? (100% החזר)</label>
              <select
                value={directBeneficiary}
                onChange={(e) => setDirectBeneficiary(e.target.value)}
                className="w-full rounded-xl border border-white/5 bg-zinc-800/50 px-4 py-3 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all appearance-none"
              >
                <option value="" disabled>בחר חבר קבוצה...</option>
                {activeMembers.map(m => (
                  <option key={m.user_id} value={m.user_id} className="bg-zinc-800 text-zinc-100">
                    {m.display_name || m.email || "חבר לא ידוע"}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Custom Mode UI */}
          {splitMode === 'custom' && !initialData && !isRecurring && (
            <div className="animate-in fade-in slide-in-from-top-1 duration-200 space-y-2 bg-zinc-800/30 p-2 rounded-xl border border-white/5">
              <div className="flex justify-between px-1">
                <span className="text-xs text-zinc-400 font-medium">חלוקה ידנית</span>
                <span className={`text-xs font-mono font-bold ${Math.abs(customSplits.reduce((acc, curr) => acc + (curr.amount || 0), 0) - Number(amount || 0)) < 0.05 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {customSplits.reduce((acc, curr) => acc + (curr.amount || 0), 0).toFixed(2)} / {Number(amount || 0).toFixed(2)}
                </span>
              </div>

              {customSplits.map((split, idx) => (
                <div key={split.user_id} className="flex items-center gap-2">
                  <div className="flex-1 text-sm text-zinc-300 truncate pl-1">
                    {activeMembers.find(m => m.user_id === split.user_id)?.display_name || activeMembers.find(m => m.user_id === split.user_id)?.email || 'Unknown'}
                  </div>
                  <input
                    type="number"
                    placeholder="0"
                    value={split.amount || ''}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setCustomSplits(prev => prev.map((s, i) =>
                        i === idx ? { ...s, amount: isNaN(val) ? 0 : val } : s
                      ));
                    }}
                    className="w-24 rounded-lg border border-white/5 bg-zinc-700/50 px-2 py-1.5 text-zinc-100 text-right outline-none focus:ring-1 focus:ring-emerald-500/50"
                  />
                </div>
              ))}
              <div className="flex justify-end pt-1">
                <button
                  onClick={() => {
                    // Spread remaining amount equally? Or just fill logic?
                    // Simple logic: Distribute amount equally
                    const total = Number(amount || 0);
                    const perPers = total / activeMembers.length;
                    setCustomSplits(activeMembers.map(m => ({ user_id: m.user_id!, amount: parseFloat(perPers.toFixed(2)) })));
                  }}
                  className="text-xs text-emerald-400 hover:underline px-1"
                >
                  אפס לחלוקה שווה
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 bg-zinc-800/30 p-3 rounded-xl border border-white/5">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={e => setIsRecurring(e.target.checked)}
                className="sr-only peer"
                disabled={!!initialData}
              />
              <div className="w-11 h-6 bg-zinc-700/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
            </label>
            <span className="text-sm text-zinc-300 font-medium">תשלום קבוע (הוראת קבע)</span>
          </div>

          {isRecurring && (
            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="w-full rounded-xl border border-white/5 bg-zinc-800/50 px-4 py-3 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
              >
                <option value="monthly" className="bg-zinc-800 text-zinc-100">כל חודש</option>
                <option value="weekly" className="bg-zinc-800 text-zinc-100">כל שבוע</option>
              </select>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 rounded-xl border border-white/5 bg-zinc-800/50 px-4 py-3 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder-zinc-500 font-mono text-lg"
            />
            <div className="w-full sm:w-40">
              <DatePicker
                value={date}
                onChange={setDate}
                align="left"
                direction="up"
              />
            </div>
          </div>
        </div>

        <div className="pt-4 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-xl px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors font-medium">ביטול</button>
          <button
            disabled={saving}
            onClick={save}
            className="rounded-xl px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 font-medium shadow-lg shadow-indigo-500/20"
          >
            {saving ? "שומר..." : (initialData ? "שמור שינויים" : "שמור הוצאה")}
          </button>
        </div>
      </div>
    </div>
  );
}
