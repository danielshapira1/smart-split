import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

type Props = {
  groupId: string
  onClose: () => void
  categories: string[]
}

export function ExpenseForm({ groupId, onClose, categories }: Props) {
  const [description, setDescription] = useState('')
  const [amountStr, setAmountStr] = useState('')      // שקל חדש כטקסט
  const [category, setCategory] = useState<string>(categories[0] ?? 'אחר')
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // מונע תווים לא מספריים (מאפשר נקודה או פסיק עשרונית אחת)
  const onAmountChange = (v: string) => {
    const sanitized = v
      .replace(/[^\d.,]/g, '')       // רק ספרות, נקודה, פסיק
      .replace(',', '.')             // פסיק לנקודה
    // לאפשר לכל היותר נקודה אחת
    const parts = sanitized.split('.')
    const fixed = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : sanitized
    setAmountStr(fixed)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // המרה לאגורות
    const shekels = Number(amountStr.replace(',', '.'))
    if (Number.isNaN(shekels) || shekels <= 0) {
      setError('סכום לא תקין')
      return
    }
    const amount_cents = Math.round(shekels * 100)

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('לא מחובר')

      const { error } = await supabase.from('expenses').insert({
        group_id: groupId,
        user_id: user.id,
        amount_cents,
        currency: 'ILS',
        description: description.trim(),
        category,
        occurred_on: date,         // חשוב: העמודה נקראת occurred_on
      })

      if (error) throw error

      onClose()
    } catch (err: any) {
      setError(err.message ?? 'שמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">הוספת הוצאה</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-black">×</button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="תיאור"
            className="w-full rounded-xl border px-3 py-3 outline-none focus:ring-2 focus:ring-black"
          />

          <div>
            <label className="block text-sm mb-1">סכום (₪)</label>
            <input
              type="text"
              inputMode="decimal"
              pattern="^\d*([.,]\d{0,2})?$"
              placeholder="0.00"
              value={amountStr}
              onChange={(e) => onAmountChange(e.target.value)}
              className="w-full rounded-xl border px-3 py-3 outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          <div className="flex gap-2">
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="flex-1 rounded-xl border px-3 py-3 outline-none"
            >
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-[52%] rounded-xl border px-3 py-3 outline-none"
            />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button
            disabled={saving}
            className="w-full rounded-xl bg-black text-white py-3 font-medium active:scale-[.99] disabled:opacity-60"
          >
            {saving ? 'שומר…' : 'שמור הוצאה'}
          </button>
        </form>
      </div>
    </div>
  )
}
