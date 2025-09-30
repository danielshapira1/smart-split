// src/components/ExpenseItem.tsx
import React from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { userBg, userBorder, userColor, UserChip } from '../lib/colors'
import type { Expense } from '../lib/types'

type Props = {
  expense: Expense
  canEdit?: boolean
  onEdit?: (expense: Expense) => void
  onDeleted?: () => void
}

export default function ExpenseItem({ expense, canEdit = false, onEdit, onDeleted }: Props) {
  const payerName = expense.payer_name || expense.user_id
  const formatILS = (c: number) => `₪${(c / 100).toFixed(2)}`

  const onDelete = async () => {
    if (!confirm('למחוק את ההוצאה הזו?')) return
    const { error } = await supabase.from('expenses').delete().eq('id', expense.id)
    if (error) {
      alert(error.message)
    } else {
      onDeleted?.()
    }
  }

  return (
    <li
      className="bg-white rounded-2xl shadow p-3 flex items-center justify-between"
      style={{
        // פס צבעוני בצד + רקע עדין לפי המשלם
        borderInlineStart: `6px solid ${userColor(expense.user_id)}`,
        backgroundColor: userBg(expense.user_id),
        boxShadow: `0 1px 0 ${userBorder(expense.user_id)} inset`,
      }}
    >
      <div className="min-w-0">
        <div className="font-medium truncate">{expense.description || 'ללא תיאור'}</div>
        <div className="text-xs text-gray-500 truncate">
          קטגוריה: {expense.category || '—'} ·{' '}
          {new Date(expense.occurred_on).toLocaleDateString('he-IL')} ·{' '}
          שולם ע״י <UserChip uid={expense.user_id} name={payerName} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="font-bold">{formatILS(expense.amount_cents)}</div>
          <div className="text-[11px] text-gray-500">{expense.currency}</div>
        </div>

        {canEdit && (
          <>
            <button
              className="text-gray-500 hover:text-black"
              onClick={() => onEdit?.(expense)}
              title="עריכה"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              className="text-rose-600 hover:text-rose-700"
              onClick={onDelete}
              title="מחיקה"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </li>
  )
}
