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
        className="rounded-xl border px-3 py-2 text-sm outline-none"
      >
        {groups.length === 0 ? (
          <option value="" disabled>
            אין קבוצות
          </option>
        ) : null}
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      {onCreateNew && (
        <button
          onClick={onCreateNew}
          className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700"
          title="צור קבוצה חדשה"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

export default GroupSwitcher
