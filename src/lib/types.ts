// src/lib/types.ts
export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at?: string;
};

export type Group = {
  id: string;
  name: string;
  created_by?: string | null;
  created_at?: string;
};

export type Expense = {
  id: string;
  group_id: string;
  user_id: string;
  amount_cents: number;
  currency: string | null;
  description: string | null;
  category: string | null;
  occurred_on: string;
  created_at: string;

  // מה-join ל-profiles דרך FK: expenses.user_id -> profiles.id
  payer?: { display_name: string | null; email: string | null } | null;

  // תאימות לאחור אם נשמר בעבר שם משלם בעמודה נפרדת
  payer_name?: string | null;
};
