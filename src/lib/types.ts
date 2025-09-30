// src/lib/types.ts

// הוצאה
export type Expense = {
  id: string;
  group_id: string;
  user_id: string;

  amount_cents: number;          // סכום באגורות
  currency: string;              // למשל: "ILS"

  description: string | null;    // תיאור חופשי
  category: string | null;       // קטגוריה (אם קיימת)

  occurred_on: string;           // תאריך ההוצאה (YYYY-MM-DD)
  created_at?: string;           // חותמת זמן יצירה (אופציונלי)

  // שדה נוח שמגיע מג'וין (לא נשמר בטבלת expenses עצמה)
  payer_name?: string | null;
};

// פרופיל משתמש
export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at?: string;
};

// קבוצה
export type Group = {
  id: string;
  name: string;
  created_by?: string | null;   // אופציונלי, כדי להתאים ל־DB
  created_at?: string;          // אופציונלי, כדי להתאים ל־DB
};
