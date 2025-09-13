import React from "react";
import { createInvite } from "../lib/supaRest";

type Props = {
  groupId: string;
  isAdmin?: boolean; // owner/admin בלבד יתנו תוקן
};

export function InviteButton({ groupId, isAdmin }: Props) {
  const onInvite = async () => {
    try {
      if (!isAdmin) {
        alert("רק מנהל/בעלים יכול ליצור הזמנה");
        return;
      }
      const token = await createInvite(groupId, "member");
      const base = import.meta.env.BASE_URL || "/";
      const link = `${window.location.origin}${base}?invite=${token}`;
      await navigator.clipboard.writeText(link);
      alert("קישור הזמנה הועתק ללוח:\n" + link);
    } catch (e: any) {
      alert(e?.message ?? "Invite failed");
    }
  };

  return (
    <button
      onClick={onInvite}
      className="rounded-full bg-slate-100 px-3 py-2 text-sm"
      title="יצירת קישור הזמנה"
    >
      הזמן +
    </button>
  );
}
