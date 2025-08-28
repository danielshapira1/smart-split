import React, { useState } from 'react'
import { Link2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'

export function InviteButton({ groupId, isAdmin }:{ groupId: string, isAdmin: boolean }) {
  const [link, setLink] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setError(null)
    const { data, error } = await supabase.rpc('create_invite', { p_group_id: groupId, p_role: 'member' })
    if (error) { setError(error.message); return }
    const url = new URL(window.location.href)
    url.searchParams.set('invite', data as unknown as string)
    setLink(url.toString())
    try { await navigator.clipboard.writeText(url.toString()) } catch {}
  }

  if (!isAdmin) return null
  return (
    <div className='flex items-center gap-2'>
      <button onClick={create} className='text-sm bg-slate-900 text-white rounded-full px-3 py-1.5 flex items-center gap-1'>
        <Link2 className='w-4 h-4'/> הזמנה
      </button>
      {link && <span className='text-[10px] text-gray-500 truncate max-w-[120px]'>{link}</span>}
      {error && <span className='text-xs text-red-600'>{error}</span>}
    </div>
  )
}
