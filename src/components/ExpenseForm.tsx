import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { X } from 'lucide-react'

export function ExpenseForm({ groupId, onClose, categories }: { groupId: string, onClose: () => void, categories: string[] }) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState<string>('')
  const [category, setCategory] = useState<string>('אחר')
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0,10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const cents = Math.round(Number((amount || '0').replace(',', '.')) * 100)
    if (!Number.isFinite(cents) || cents <= 0) { setError('סכום לא תקין'); setSaving(false); return }
    const { data: { user } } = await supabase.auth.getUser()
    const { error: err } = await supabase.from('expenses').insert({
      group_id: groupId,
      user_id: user?.id,
      amount_cents: cents,
      currency: 'ILS',
      description,
      category,
      occurred_on: date
    })
    if (err) setError(err.message)
    else onClose()
    setSaving(false)
  }

  return (
    <div className='fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 z-50'>
      <div className='w-full max-w-md bg-white rounded-2xl shadow-xl p-4'>
        <div className='flex items-center justify-between mb-2'>
          <h2 className='text-lg font-semibold'>הוספת הוצאה</h2>
          <button onClick={onClose} className='p-2 -m-2 rounded-xl hover:bg-slate-100'><X className='w-5 h-5'/></button>
        </div>
        <form onSubmit={save} className='space-y-3'>
          <div className='space-y-1'>
            <label className='text-sm text-gray-600'>תיאור</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder='לדוגמה: סופר' className='w-full rounded-xl border px-3 py-3 outline-none focus:ring-2 focus:ring-black' />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1'>
              <label className='text-sm text-gray-600'>סכום (₪)</label>
              <input inputMode='decimal' value={amount} onChange={e => setAmount(e.target.value)} placeholder='לדוגמה: 37.50' className='w-full rounded-xl border px-3 py-3 outline-none focus:ring-2 focus:ring-black' />
            </div>
            <div className='space-y-1'>
              <label className='text-sm text-gray-600'>קטגוריה</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className='w-full rounded-xl border px-3 py-3 outline-none'>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className='space-y-1'>
            <label className='text-sm text-gray-600'>תאריך</label>
            <input type='date' value={date} onChange={e => setDate(e.target.value)} className='w-full rounded-xl border px-3 py-3 outline-none focus:ring-2 focus:ring-black' />
          </div>
          {error && <p className='text-red-600 text-sm'>{error}</p>}
          <button disabled={saving} className='w-full rounded-xl bg-black text-white py-3 font-medium active:scale-[.99]'>{saving ? 'שומר...' : 'שמור הוצאה'}</button>
        </form>
      </div>
    </div>
  )
}
