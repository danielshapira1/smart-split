import { createClient } from '@supabase/supabase-js';
import type { Profile } from './types';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

// ודא פרופיל למשתמש המחובר (קריאה לפונקציה שיצרת ב-SQL)
export async function ensureProfileForCurrentUser() {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess?.session?.user?.id;
  if (!uid) return;

  // יש? מצוין. אין? ניצור דרך ה-RPC הבטוח
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', uid)
    .maybeSingle<Pick<Profile,'id'>>();

  if (!data) {
    await supabase.rpc('ensure_profile');
  }
}
