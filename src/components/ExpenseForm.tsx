import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { X } from 'lucide-react'

export type ExpenseFormProps = {
  groupId: string
  currentPayerName: string
  categories: string[]
  onClose: () => void
  onSaved: () => void
}

type Session = import('@supabase/supabase-js').Session

export const ExpenseForm: React.FC<ExpenseFormProps> = ({
  groupId,
  currentPayerName,
  categories,
  onClose,
  onSaved,
}) => {
  const [session, setSession] = useState<Session | null>(null)
  const [saving, setSaving] = useState(false)

  // שדות טופס
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<string>(categories[0] ?? 'אחר')
  const [amount, setAmount] = useState<string>('') // בשקלים כתו
  const [occurredOn, setOccurredOn] = useState<string>(() => {
    const d = new Date()
    // yyyy-mm-dd
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
  }, [])

  const amountCents = useMemo(() => {
    // המרה לבטוח: ריקים -> NaN -> 0
    const n = Number.parseFloat(amount.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return 0
    return Math.round(n * 100)
  }, [amount])

  const canSave = useMemo(() => {
    return !!session?.user?.id && !!groupId && amountCents > 0 && !!category && !!occurredOn
  }, [session, groupId, amountCents, category, occurredOn])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.user?.id) {
      alert('לא נמצא משתמש מחובר')
      return
    }
    if (!canSave) return

    setSaving(true)
    try {
      const payload = {
        group_id: groupId,
        user_id: session.user.id,
        amount_cents: amountCents,
        currency: 'ILS',
        description: description?.trim() || null,
        category,
        occurred_on: occurredOn,
        payer_name: currentPayerName || null,
      }

      const { error } = await supabase.from('expenses').insert(payload)
      if (error) {
        console.error('insert expense failed:', error)
        alert(error.message)
        setSaving(false)
        return
      }

      // איפוס שדות (רק אם תרצה להשאיר פתוח)
      // setDescription('')
      // setCategory(categories[0] ?? 'אחר')
      // setAmount('')
      // setOccurredOn(new Date().toISOString().slice(0, 10))

      setSaving(false)
      onSaved()
    } catch (err: any) {
      console.error(err)
      alert('שמירה נכשלה')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold">הוספת הוצאה</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 hover:bg-slate-100 active:scale-95"
            aria-label="סגור"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form className="space-y-3" onSubmit={onSubmit}>
          {/* תיאור */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">תיאור</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="מה קנית?"
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-black"
              maxLength={120}
            />
          </div>

          {/* קטגוריה */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">קטגוריה</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 outline-none"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* סכום */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">סכום (₪)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-black"
              required
            />
            <p className="text-xs text-gray-500 mt-1">מספרים בלבד. נקודה עשרונית מותרת.</p>
          </div>

          {/* תאריך */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">תאריך</label>
            <input
              type="date"
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-black"
              required
            />
          </div>

          {/* מי שילם (תצוגה בלבד, שומר כ-payer_name) */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">שולם ע"י</label>
            <input
              value={currentPayerName}
              readOnly
              className="w-full rounded-xl border px-3 py-2 bg-slate-50 text-gray-600"
            />
          </div>

          {/* כפתורים */}
          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border px-3 py-3 active:scale-95"
              disabled={saving}
            >
              בטל
            </button>
            <button
              type="submit"
              disabled={!canSave || saving}
              className="flex-1 rounded-xl bg-black text-white px-3 py-3 active:scale-95 disabled:opacity-60"
            >
              {saving ? 'שומר…' : 'שמור הוצאה'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
