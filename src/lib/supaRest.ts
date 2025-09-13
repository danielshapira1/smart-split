// src/lib/supaRest.ts
import { supabase } from "./supabaseClient";

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!URL || !KEY) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

// Attach apikey + Authorization (access_token אם יש, אחרת anon key)
async function authHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return `Bearer ${session?.access_token ?? KEY}`;
}

async function rest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("apikey", KEY);
  headers.set("Authorization", await authHeader());
  if (!headers.has("Content-Type") && init.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${URL}${path}`, { ...init, headers });
}

/* ---------- Types ---------- */
export type Group = {
  id: string;
  name: string;
  created_at?: string;
  created_by?: string | null;
};

export type ExpenseInsert = {
  group_id: string;
  user_id: string;        // תמיד auth.uid()
  amount_cents: number;
  currency: string;       // לדוגמה 'ILS'
  description?: string;
  category?: string;
  occurred_on?: string;   // YYYY-MM-DD
};

/* ---------- API ---------- */

// יוצר קבוצה ע"י RPC שמחזיר את השורה המלאה (ללא SELECT נוסף)
export async function createGroupFull(name: string): Promise<Group> {
  const res = await rest(`/rest/v1/rpc/create_group`, {
    method: "POST",
    body: JSON.stringify({ p_name: name.trim() }),
  });
  if (!res.ok) throw new Error(await res.text());
  const g = await res.json();
  if (!g || !g.id) throw new Error("RPC did not return group");
  return g as Group;
}

// שליפת כל הקבוצות של המשתמש דרך memberships→groups(*)
export async function fetchGroups(): Promise<Group[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) throw new Error("Not authenticated");

  const res = await rest(
    `/rest/v1/memberships?select=groups(*)&user_id=eq.${uid}`
  );
  if (!res.ok) throw new Error(await res.text());
  const rows = await res.json();
  const groups = (rows ?? [])
    .map((r: any) => r?.groups)
    .filter(Boolean);
  return groups as Group[];
}

// יוצר הזמנה ומחזיר token (uuid)
export async function createInvite(
  groupId: string,
  role: "member" | "admin" | "owner" = "member"
): Promise<string> {
  const res = await rest(`/rest/v1/rpc/create_invite`, {
    method: "POST",
    body: JSON.stringify({ p_group_id: groupId, p_role: role }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // uuid string
}

// מקבל הזמנה לפי token
export async function acceptInvite(token: string): Promise<void> {
  const res = await rest(`/rest/v1/rpc/accept_invite`, {
    method: "POST",
    body: JSON.stringify({ p_token: token }),
  });
  if (!res.ok) throw new Error(await res.text());
}

// הוספת הוצאה לטבלת expenses (שימו לב: בלי payer_name)
export async function saveExpenseRow(exp: ExpenseInsert): Promise<void> {
  const res = await rest(`/rest/v1/expenses`, {
    method: "POST",
    body: JSON.stringify([exp]),
  });
  if (!res.ok) throw new Error(await res.text());
}
