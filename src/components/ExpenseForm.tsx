import React, { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { saveExpenseRow } from "../lib/supaRest";

type Props = {
  groupId: string;
  currentPayerName: string;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
};

export function ExpenseForm({ groupId, currentPayerName, categories, onClose, onSaved }: Props) {
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState("ILS");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "אחר");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0,10));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    try {
      setSaving(true);
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("Not authenticated");

      await saveExpenseRow({
        group_id: groupId,
        user_id: uid,
        amount_cents: Math.round(Number(amount || 0) * 100),
        currency,
        description,
        category,
        occurred_on: date,           // YYYY-MM-DD
      });

      onSaved();
    } catch (e: any) {
      alert(e?.message ?? "שמירת הוצאה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl p-4 space-y-3">
        <h2 className="text-lg font-semibold">הוספת הוצאה</h2>

        <input
          placeholder="תיאור"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-xl border px-3 py-2"
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-xl border px-3 py-2"
        >
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <input
          type="number"
          inputMode="decimal"
          placeholder="סכום"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-xl border px-3 py-2"
        />

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-xl border px-3 py-2"
        />

        <input
          value={currentPayerName}
          readOnly
          className="w-full rounded-xl border px-3 py-2 bg-slate-50"
          title="נשאב מהפרופיל/מייל"
        />

        <div className="flex justify-between pt-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 bg-slate-100">בטל</button>
          <button
            disabled={saving}
            onClick={save}
            className="rounded-full px-4 py-2 bg-black text-white"
          >
            {saving ? "שומר..." : "שמור הוצאה"}
          </button>
        </div>
      </div>
    </div>
  );
}
