// src/lib/colors.ts
/** hash יציב למחרוזת -> מספר חיובי */
function hash32(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return (h >>> 0); // unsigned
}

/** צבע בסיס (טקסט/נקודה) לפי משתמש */
export function userColor(uid: string) {
  const h = hash32(uid) % 360;
  return `hsl(${h} 70% 45%)`;
}

/** צבע רקע עדין */
export function userBg(uid: string) {
  const h = hash32(uid) % 360;
  return `hsl(${h} 95% 96%)`;
}

/** צבע גבול בהיר */
export function userBorder(uid: string) {
  const h = hash32(uid) % 360;
  return `hsl(${h} 80% 80%)`;
}

/** תגית משתמש מוכנה לשימוש חוזר */
export function UserChip({ uid, name }: { uid: string; name: string }) {
  const fg = userColor(uid);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border"
      style={{
        color: fg,
        backgroundColor: userBg(uid),
        borderColor: userBorder(uid),
      }}
      title={name}
      dir="auto"
    >
      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: fg }} />
      {name}
    </span>
  );
}
