import React from "react";
import { createInvite } from "../lib/supaRest";

type Props = {
  groupId: string;
  isAdmin?: boolean; // kept for prop compatibility — no longer enforced here
};

async function copyToClipboard(text: string): Promise<void> {
  // Modern Clipboard API
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to legacy
    }
  }
  // Legacy fallback (works on most mobile browsers)
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.cssText = "position:fixed;top:-9999px;left:-9999px";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

export function InviteButton({ groupId }: Props) {
  const onInvite = async () => {
    try {
      const token = await createInvite(groupId, "member");
      const base = import.meta.env.BASE_URL || "/";
      const link = `${window.location.origin}${base}?invite=${token}`;
      await copyToClipboard(link);
      alert("קישור הזמנה הועתק ללוח:\n" + link);
    } catch (e: any) {
      alert(e?.message ?? "Invite failed");
    }
  };

  return (
    <button
      onClick={onInvite}
      className="rounded-full bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 border border-zinc-700 transition-colors"
      title="יצירת קישור הזמנה"
    >
      הזמן +
    </button>
  );
}
