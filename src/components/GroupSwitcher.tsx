import React from 'react'
import type { Group } from '../lib/types'

type Props = {
  groups: Group[]
  current: Group | null
  onSelect: (g: Group) => void
  /** ייקרא מההורה אחרי שנוצרה קבוצה חדשה, ומקבל את הקבוצה שנוצרה */
  onCreated?: (g: Group) => void
}

export function GroupSwitcher({ groups, current, onSelect }: Props) {
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
    </div>
  )
}

export default GroupSwitcher
