// src/lib/colors.tsx
import React from 'react';

/** צבע דטרמיניסטי לכל uid מתוך פאלטה */
const PALETTE = [
  '#2563eb', // blue-600
  '#16a34a', // green-600
  '#d97706', // amber-600
  '#db2777', // pink-600
  '#0ea5e9', // sky-500
  '#7c3aed', // violet-600
  '#ef4444', // red-500
  '#059669', // emerald-600
  '#f59e0b', // amber-500
  '#06b6d4', // cyan-500
];

const colorCache = new Map<string, string>();

function hashUid(uid: string) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) {
    h = (h * 31 + uid.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export function userColor(uid: string): string {
  if (!uid) return '#475569'; // slate-600 fallback
  if (!colorCache.has(uid)) {
    const idx = hashUid(uid) % PALETTE.length;
    colorCache.set(uid, PALETTE[idx]);
  }
  return colorCache.get(uid)!;
}

// רקע עדין עם alpha
export function userBg(uid: string, alpha = 0.06): string {
  const hex = userColor(uid).replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// צבע גבול/הצללה (קצת כהה יותר)
export function userBorder(uid: string, alpha = 0.25): string {
  const hex = userColor(uid).replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** תגית שם קטנה עם צבע המזהה של המשתמש */
export function UserChip({
  uid,
  name,
  className,
  title,
}: {
  uid: string;
  name?: string;
  className?: string;
  title?: string;
}) {
  const fg = userColor(uid);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${className ?? ''}`}
      style={{
        color: fg,
        backgroundColor: userBg(uid),
        borderColor: userBorder(uid),
      }}
      title={title ?? name}
      dir="auto"
    >
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ backgroundColor: fg }}
      />
      {name}
    </span>
  );
}
