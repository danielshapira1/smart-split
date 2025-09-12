import { supabase } from "./supabaseClient";

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!URL || !KEY) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

// אם המשתמש מחובר – נשתמש ב-access_token שלו (כדי ש-RLS עם auth.uid() יעבוד)
async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? KEY;
  return `Bearer ${token}`;
}

async function rest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("apikey", KEY);
  headers.set("Authorization", await getAuthHeader());
  if (!headers.has("Content-Type") && init.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${URL}${path}`, { ...init, headers });
}

/* ---------- Types ---------- */
export type Group = {
  id: string;
  name: string;
  created_at?: string;        // השאר אופציונלי להיות גמישים
  created_by?: string | null;
};

/* ---------- API ---------- */
export async function fetchGroups(): Promise<Group[]> {
  const res = await rest(`/rest/v1/groups?select=*&order=created_at.desc`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** RPC: create_group(p_name text) -> uuid, ואז נחזיר את הרשומה המלאה */
export async function createGroupFull(name: string): Promise<Group> {
  const rpc = await rest(`/rest/v1/rpc/create_group`, {
    method: "POST",
    body: JSON.stringify({ p_name: name.trim() }),
  });
  if (!rpc.ok) throw new Error(await rpc.text());
  const newId: string = await rpc.json();

  const r = await rest(`/rest/v1/groups?id=eq.${newId}&select=*`);
  if (!r.ok) throw new Error(await r.text());
  const rows: Group[] = await r.json();
  if (!rows[0]) throw new Error("Failed to load created group");
  return rows[0];
}
