import React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import type { Expense } from '../lib/types';
import { userBg, userBorder, userColor, UserChip } from '../lib/colors';

type Props = {
  expense: Expense;
  canEdit: boolean;
  onEdit: (expense: Expense) => void;
  onDeleted: () => void;
};

const formatILS = (cents: number) => `₪${(cents / 100).toFixed(2)}`;

export default function ExpenseItem({ expense, canEdit, onEdit, onDeleted }: Props) {
  const payer = expense.payer_name || expense.user_id;

  const onDelete = async () => {
    if (!confirm('למחוק את ההוצאה הזו?')) return;
    const { error } = await supabase.from('expenses').delete().eq('id', expense.id);
    if (error) alert(error.message);
    else onDeleted();
  };

  return (
    <li
      className="rounded-2xl p-3 flex items-center justify-between"
      style={{
        borderInlineStart: `6px solid ${userColor(expense.user_id)}`,
        backgroundColor: userBg(expense.user_id),
        boxShadow: `0 1px 0 ${userBorder(expense.user_id)} inset`,
      }}
    >
      <div className="min-w-0">
        <div className="font-medium truncate text-zinc-100">{expense.description || 'ללא תיאור'}</div>
        <div className="text-xs text-zinc-400 truncate">
          קטגוריה: {expense.category || '—'} · {new Date(expense.occurred_on).toLocaleDateString('he-IL')} ·{' '}
          שולם ע״י <UserChip uid={expense.user_id} name={payer} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="font-bold text-zinc-100">{formatILS(expense.amount_cents)}</div>
          <div className="text-[11px] text-zinc-500">{expense.currency}</div>
        </div>
        {canEdit && (
          <>
            <button className="text-zinc-500 hover:text-zinc-300 transition-colors" onClick={() => onEdit(expense)} title="עריכה">
              <Pencil className="w-4 h-4" />
            </button>
            <button className="text-rose-400 hover:text-rose-300 transition-colors" onClick={onDelete} title="מחיקה">
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}
