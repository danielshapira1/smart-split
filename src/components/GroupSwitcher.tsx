import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { fetchGroups, createGroupFull, type Group } from "../lib/supaRest";

/**
 * דו-מצבי:
 * - Controlled: אם מעבירים groups/current/onSelect/onCreate -> המרכיב נשלט ע"י ההורה.
 * - Auto: אם לא מעבירים groups/current -> המרכיב טוען לבד מהשרת, עם selectedGroupId/onChange.
 */
type Props = {
  className?: string;

  // --- Controlled props (כמו שיש לך ב-App.tsx) ---
  groups?: Group[];
  current?: string | null;
  onSelect?: (groupId: string | null) => void;
  onCreate?: (g: Group) => void;

  // --- Auto props (אם רוצים שהמרכיב ינהל לבד) ---
  selectedGroupId?: string | null;
  onChange?: (groupId: string | null) => void;
};

export function GroupSwitcher(props: Props) {
  const controlled = Array.isArray(props.groups);

  // --- State פנימי למצב Auto בלבד ---
  const [autoGroups, setAutoGroups] = useState<Group[]>([]);
  const [autoCurrent, setAutoCurrent] = useState<string | null>(props.selectedGroupId ?? null);
  const [loading, setLoading] = useState<boolean>(!controlled);
  const [creating, setCreating] = useState<boolean>(false);

  // טעינה אוטומטית רק במצב Auto
  useEffect(() => {
    if (!controlled) {
      (async () => {
        setLoading(true);
        try {
          const data = await fetchGroups();
          setAutoGroups(data);
          if (autoCurrent == null && data[0]) {
            setAutoCurrent(data[0].id);
            props.onChange?.(data[0].id);
          }
        } catch (e: any) {
          alert(e?.message ?? "שגיאה בטעינת קבוצות");
        } finally {
          setLoading(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled]);

  // סנכרון selectedGroupId חיצוני במצב Auto
  useEffect(() => {
    if (!controlled && props.selectedGroupId !== undefined) {
      setAutoCurrent(props.selectedGroupId ?? null);
    }
  }, [controlled, props.selectedGroupId]);

  const list: Group[] = controlled ? (props.groups ?? []) : autoGroups;
  const current: string | null = controlled ? (props.current ?? null) : autoCurrent;

  const hasGroups = useMemo(() => list.length > 0, [list]);

  async function handleCreate() {
    const name = window.prompt("שם קבוצה:");
    if (!name || !name.trim()) return;

    setCreating(true);
    try {
      const g = await createGroupFull(name);

      if (controlled) {
        // הורה מנהל State -> מעבירים לו את האובייקט
        props.onCreate?.(g);
        props.onSelect?.(g.id);
      } else {
        // מצב Auto: העדכון קורה מקומית + emit ל-onChange
        setAutoGroups((prev) => [g, ...prev]);
        setAutoCurrent(g.id);
        props.onChange?.(g.id);
      }
    } catch (e: any) {
      alert(e?.message ?? "שגיאה ביצירת קבוצה");
    } finally {
      setCreating(false);
    }
  }

  function handleSelect(id: string | null) {
    if (controlled) {
      props.onSelect?.(id);
    } else {
      setAutoCurrent(id);
      props.onChange?.(id);
    }
  }

  return (
    <div className={clsx("flex items-center gap-3", props.className)}>
      {controlled ? null : loading ? (
        <span className="text-sm opacity-70">טוען קבוצות…</span>
      ) : null}

      {hasGroups ? (
        <>
          <select
            className="rounded-xl border px-3 py-2 text-sm"
            value={current ?? ""}
            onChange={(e) => handleSelect(e.target.value || null)}
          >
            {list.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-60"
            title="צור קבוצה חדשה"
          >
            <Plus size={16} />
            {creating ? "יוצר…" : "קבוצה חדשה"}
          </button>
        </>
      ) : (
        <>
          <span className="text-sm opacity-70">אין עדיין קבוצות</span>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-60"
          >
            <Plus size={16} />
            {creating ? "יוצר…" : "קבוצה חדשה"}
          </button>
        </>
      )}
    </div>
  );
}
