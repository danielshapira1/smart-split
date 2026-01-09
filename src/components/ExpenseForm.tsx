import React, { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { saveExpenseRow } from "../lib/supaRest";

type Props = {
  groupId: string;
  currentPayerName: string;
  categories: string[];
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

export function ExpenseForm({ groupId, currentPayerName, categories, onClose, onSaved, initialData }: Props) {
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

  const save = async () => {
    try {
      setSaving(true);
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("Not authenticated");

      if (isRecurring) {
        // Save as recurring expense
        const { error } = await supabase.from('recurring_expenses').insert({
          group_id: groupId,
          user_id: uid,
          amount_cents: Math.round(Number(amount || 0) * 100),
          currency,
          description,
          category,
          frequency,
          next_run: date, // Explicitly set the start date (user selected)
        });
        if (error) throw error;

        // Try to process immediately so it shows up in the list if date is today/past
        await supabase.rpc('process_recurring_expenses');
      } else {
        // Save as normal expense
        await saveExpenseRow({
          id: initialData?.id,
          group_id: groupId,
          user_id: uid,
          amount_cents: Math.round(Number(amount || 0) * 100),
          currency,
          description,
          category,
          occurred_on: date,
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-800 border border-zinc-700 w-full max-w-md rounded-2xl p-4 space-y-3 shadow-2xl">
        <h2 className="text-lg font-semibold text-zinc-100">
          {initialData ? "עריכת הוצאה" : "הוספת הוצאה"}
        </h2>

        <input
          placeholder="תיאור"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-xl border border-zinc-600 bg-zinc-700/50 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500 placeholder-zinc-400"
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-xl border border-zinc-600 bg-zinc-700/50 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {categories.map((c) => <option key={c} value={c} className="bg-zinc-800 text-zinc-100">{c}</option>)}
        </select>

        <div className="flex items-center gap-3 bg-zinc-700/30 p-2 rounded-xl border border-zinc-700/50">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={e => setIsRecurring(e.target.checked)}
              className="sr-only peer"
              disabled={!!initialData} // Cannot change existing expense to recurring here easily
            />
            <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
          <span className="text-sm text-zinc-300">תשלום קבוע (הוראת קבע)</span>
        </div>

        {isRecurring && (
          <div className="animate-in fade-in slide-in-from-top-1 duration-200">
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="w-full rounded-xl border border-zinc-600 bg-zinc-700/50 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="monthly" className="bg-zinc-800 text-zinc-100">כל חודש</option>
              <option value="weekly" className="bg-zinc-800 text-zinc-100">כל שבוע</option>
            </select>
          </div>
        )}

        <input
          type="number"
          inputMode="decimal"
          placeholder="סכום"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-xl border border-zinc-600 bg-zinc-700/50 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500 placeholder-zinc-400"
        />

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-xl border border-zinc-600 bg-zinc-700/50 px-3 py-2 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500 [color-scheme:dark]"
        />

        <input
          value={currentPayerName}
          readOnly
          className="w-full rounded-xl border border-zinc-600/50 bg-zinc-700/30 px-3 py-2 text-zinc-400 cursor-not-allowed"
          title="נשאב מהפרופיל/מייל"
        />

        <div className="flex justify-between pt-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors">בטל</button>
          <button
            disabled={saving}
            onClick={save}
            className="rounded-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
          >
            {saving ? "שומר..." : (initialData ? "שמור שינויים" : "שמור הוצאה")}
          </button>
        </div>
      </div>
    </div>
  );
}
