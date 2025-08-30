import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

type Props = {
  userId: string
  currentEmail: string | null
  onDone: () => void
}

export function ProfileNameModal({ userId, currentEmail, onDone }: Props) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) { setError('נא למלא שם תצוגה'); return }
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: name.trim() })
      .eq('id', userId)
    setSaving(false)
    if (error) setError(error.message)
    else onDone()
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[999]">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow p-4">
        <h2 className="text-lg font-semibold mb-2">ברוך הבא! ✨</h2>
        <p className="text-sm text-gray-600 mb-3">
          כדי שידעו מי שילם – הזן שם תצוגה. אם לא תכתוב, יוצג המייל ({currentEmail || '—'}).
        </p>
        <form onSubmit={save} className="space-y-3">
          <input
            className="w-full rounded-xl border px-3 py-3 outline-none focus:ring-2 focus:ring-black"
            placeholder="שם תצוגה"
            value={name}
            onChange={e=>setName(e.target.value)}
          />
          {error && <p className='text-red-600 text-sm'>{error}</p>}
          <button className="w-full rounded-xl bg-black text-white py-3 font-medium active:scale-[.99]" disabled={saving}>
            {saving ? 'שומר…' : 'שמור'}
          </button>
        </form>
      </div>
    </div>
  )
}
