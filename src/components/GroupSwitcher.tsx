import React from 'react'
import { Plus } from 'lucide-react'
import type { Group } from '../lib/types'

type Props = {
  groups: Group[]
  current: Group | null
  onSelect: (g: Group) => void
  onCreated?: (g: Group) => void
  onCreateNew?: () => void
}

export function GroupSwitcher({ groups, current, onSelect, onCreateNew }: Props) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={current?.id ?? ''}
        onChange={(e) => {
          const g = groups.find((x) => x.id === e.target.value)
          if (g) onSelect(g)
        }}
        className="rounded-xl border border-zinc-600 bg-zinc-700/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {groups.length === 0 ? (
          <option value="" disabled className="bg-zinc-800 text-zinc-500">
            אין קבוצות
          </option>
        ) : null}
        {groups.map((g) => (
          <option key={g.id} value={g.id} className="bg-zinc-800 text-zinc-100">
            {g.name}
          </option>
        ))}
      </select>

      {onCreateNew && (
        <button
          onClick={onCreateNew}
          className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors border border-zinc-700"
          title="צור קבוצה חדשה"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

export default GroupSwitcher
