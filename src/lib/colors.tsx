// src/lib/colors.tsx
const PALETTE = [
  '#2563eb', '#16a34a', '#d97706', '#db2777', '#0ea5e9',
  '#7c3aed', '#ef4444', '#059669', '#f59e0b', '#06b6d4',
] as const;

const DEFAULT_COLOR = '#475569'; // slate-600
const colorCache = new Map<string, string>();

function hashUid(uid: string) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
  return h >>> 0;
}

export function userColor(uid: string): string {
  if (!uid) return DEFAULT_COLOR;
  if (!colorCache.has(uid)) {
    const idx = hashUid(uid) % PALETTE.length;
    const color = PALETTE[idx] ?? DEFAULT_COLOR; // fallback בטוח
    colorCache.set(uid, color);
  }
  return colorCache.get(uid)!;
}

export function userBg(uid: string, alpha = 0.06): string {
  const hex = userColor(uid).replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function userBorder(uid: string, alpha = 0.25): string {
  const hex = userColor(uid).replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** תגית קטנה עם צבע לפי המשתמש */
export function UserChip({
  uid,
  name,
  size = 'sm',
}: {
  uid: string;
  name: string;
  size?: 'sm' | 'md';
}) {
  const fg = userColor(uid);
  const bg = userBg(uid, 0.12);
  const br = userBorder(uid, 0.4);

  const px = size === 'md' ? 'px-2' : 'px-1.5';
  const py = size === 'md' ? 'py-1' : 'py-0.5';
  const text = size === 'md' ? 'text-[13px]' : 'text-[12px]';

  return (
    <span
      title={name}
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${px} ${py} ${text}`}
      style={{ color: fg, backgroundColor: bg, borderColor: br }}
    >
      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: fg }} />
      {name}
    </span>
  );
}
