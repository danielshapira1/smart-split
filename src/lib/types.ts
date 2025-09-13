export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at?: string;
};

export type Group = {
  id: string;
  name: string;
  created_by?: string | null;   // אופציונלי, כדי להתאים ל־DB
  created_at?: string;          // אופציונלי, כדי להתאים ל־DB
};
