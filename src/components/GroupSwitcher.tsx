// src/components/GroupSwitcher.tsx
import React from "react";
import type { Group } from "../lib/supaRest";
import { Plus } from "lucide-react";

type Props = {
  /** כל הקבוצות שנטענו ע"י ההורה */
  groups: Group[];
  /** הקבוצה הנוכחית */
  current: Group | null;
  /** החלפת קבוצה נבחרת */
  onSelect: (g: Group) => void;
  /** בקשה מההורה ליצור קבוצה חדשה (ההורה עושה RPC ומעדכן state) */
  onCreated?: () => void;
};

export function GroupSwitcher({ groups, current, onSelect, onCreated }: Props) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const g = groups.find((x) => x.id === e.target.value);
    if (g) onSelect(g);
  };

  return (
    <div className="flex items-center gap-2">
      <select
        value={current?.id ?? ""}
        onChange={handleChange}
        className="rounded-xl border px-3 py-2 text-sm"
        aria-label="בחירת קבוצה"
      >
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      {onCreated && (
        <button
          type="button"
          onClick={() => onCreated()}
          className="rounded-full bg-black text-white px-3 py-2 text-sm flex items-center gap-1 active:scale-[.98]"
          title="צור קבוצה חדשה"
        >
          <Plus className="w-4 h-4" />
          חדש
        </button>
      )}
    </div>
  );
}
