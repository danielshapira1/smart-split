import React, { useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'

type Group = { id: string; name: string }

export function GroupSwitcher({ groups, current, onSelect, onCreated }:{ groups: Group[], current: Group|null, onSelect: (g: Group)=>void, onCreated: (g: Group)=>void }) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const create = async () => {
    if (!name.trim()) return
    const { data: g, error } = await supabase.from('groups').insert({ name }).select().single()
    if (!error && g) {
      const { error: mErr } = await supabase.from('memberships').insert({ group_id: g.id, user_id: (await supabase.auth.getUser()).data.user?.id, role: 'owner' })
      if (!mErr) onCreated(g as Group)
    }
    setCreating(false); setName(''); setOpen(false)
  }

  return (
    <div className='relative'>
      <button onClick={()=>setOpen(o=>!o)} className='flex items-center gap-1 text-left'>
        <span className='font-semibold'>{current?.name || 'בחר קבוצה'}</span>
        <ChevronDown className='w-4 h-4'/>
      </button>
      {open && (
        <div className='absolute right-0 mt-2 w-56 bg-white rounded-xl shadow border p-2 z-20'>
          <div className='max-h-60 overflow-auto'>
            {groups.map(g => (
              <button key={g.id} onClick={()=>{ onSelect(g); setOpen(false); }} className='w-full text-right px-2 py-2 rounded-lg hover:bg-slate-100'>
                {g.name}
              </button>
            ))}
          </div>
          {!creating ? (
            <button onClick={()=>setCreating(true)} className='mt-2 w-full px-2 py-2 rounded-lg bg-black text-white flex items-center justify-center gap-1'>
              <Plus className='w-4 h-4'/> קבוצה חדשה
            </button>
          ) : (
            <div className='mt-2 space-y-2'>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder='שם הקבוצה' className='w-full rounded-lg border px-2 py-2'/>
              <button onClick={create} className='w-full px-2 py-2 rounded-lg bg-black text-white'>צור</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
