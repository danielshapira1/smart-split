// טיפוסים אחידים לכל האפליקציה

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

// סכום נשמר תמיד בסנטים (מספר שלם)
export type Expense = {
  id: string;
  group_id: string;
  user_id: string;
  amount_cents: number;      // ALWAYS number (parsed)
  currency: string;
  description: string | null;
  category: string | null;
  occurred_on: string;
  created_at?: string;
  payer_name?: string | null; // display_name/email של המשלם לצורך תצוגה
};

// לשימוש במסכי מאזן/קבוצה
export type Member = {
  uid: string;
  name: string; // display_name/email/fallback uid
};
