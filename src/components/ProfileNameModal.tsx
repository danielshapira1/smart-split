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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[999]">
      <div className="bg-zinc-900 border border-zinc-800 w-full max-w-sm rounded-2xl shadow-xl p-4">
        <h2 className="text-lg font-semibold mb-2 text-zinc-100">ברוך הבא! ✨</h2>
        <p className="text-sm text-zinc-400 mb-3">
          כדי שידעו מי שילם – הזן שם תצוגה. אם לא תכתוב, יוצג המייל ({currentEmail || '—'}).
        </p>
        <form onSubmit={save} className="space-y-3">
          <input
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-600 placeholder-zinc-500"
            placeholder="שם תצוגה"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          {error && <p className='text-red-500 text-sm'>{error}</p>}
          <button className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white py-3 font-medium active:scale-[.99] transition-colors" disabled={saving}>
            {saving ? 'שומר…' : 'שמור'}
          </button>
        </form>
      </div>
    </div>
  )
}
