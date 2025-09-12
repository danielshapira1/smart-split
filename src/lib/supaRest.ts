// src/lib/supaRest.ts
import { supabase } from "./supabaseClient";

/** ENV */
const URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!URL || !KEY) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

/** החזרת Authorization עם access_token אם יש סשן, אחרת anon key */
async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? KEY;
  return `Bearer ${token}`;
}

/** מעטפת fetch שמוסיפה apikey + Authorization לכל בקשה */
async function rest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("apikey", KEY);
  headers.set("Authorization", await getAuthHeader());
  if (!headers.has("Content-Type") && init.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${URL}${path}`, { ...init, headers });
}

/** ---------- Types ---------- */
export type Group = {
  id: string;
  name: string;
  created_at: string;
  created_by?: string | null;
};

/** רשימת קבוצות למשתמש המחובר (מוגבל ע"י RLS) */
export async function fetchGroups(): Promise<Group[]> {
  const res = await rest(`/rest/v1/groups?select=*&order=created_at.desc`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** יוצר קבוצה, ואז מחזיר את *האובייקט המלא* של הקבוצה החדשה */
export async function createGroupFull(name: string): Promise<Group> {
  // 1) קריאה ל-RPC שמחזירה UUID
  const rpc = await rest(`/rest/v1/rpc/create_group`, {
    method: "POST",
    body: JSON.stringify({ p_name: name.trim() }),
  });
  if (!rpc.ok) throw new Error(await rpc.text());
  const newId: string = await rpc.json();

  // 2) שליפה של הרשומה המלאה (RLS: אחרי יצירה אתה Owner => רואה אותה)
  const r = await rest(`/rest/v1/groups?id=eq.${newId}&select=*`);
  if (!r.ok) throw new Error(await r.text());
  const rows: Group[] = await r.json();
  const g = rows[0];
  if (!g) throw new Error("Failed to load created group");
  return g;
}
