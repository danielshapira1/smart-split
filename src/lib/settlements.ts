// חישוב נטו וסגירות חשבון – נקי, בטוח טיפוסים ומאוד קריא.

export type Member = {
  user_id: string;
  name: string;            // display_name או מייל
};

export type Expense = {
  id: string;
  user_id: string;         // המשלם
  amount_cents: number;
  occurred_on: string;
  description?: string;
  category?: string;
  currency: string;        // "ILS"
};

export type Net = {
  uid: string;
  name: string;
  net_cents: number;       // + מגיע לו, - חייב
};

export type Transfer = {
  from_uid: string;
  from_name: string;
  to_uid: string;
  to_name: string;
  amount_cents: number;
};

/** נטו לכל משתמש לפי חלוקה שווה של כל הוצאה בין כל חברי הקבוצה */
export function computeNet(members: Member[], expenses: Expense[]): Net[] {
  const byId = new Map<string, Net>();
  for (const m of members) {
    byId.set(m.user_id, { uid: m.user_id, name: m.name, net_cents: 0 });
  }
  if (members.length === 0) return [];

  for (const e of expenses) {
    const share = Math.round(e.amount_cents / members.length);

    // המשלם מקבל פלוס מלא
    const payer = byId.get(e.user_id);
    if (payer) payer.net_cents += e.amount_cents;

    // כל המשתתפים (כולל המשלם) משלמים חלק שווה
    for (const m of members) {
      const n = byId.get(m.user_id);
      if (n) n.net_cents -= share;
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'he')
  );
}

/** יצירת סט העברות מינימלי לסגירת חשבון */
export function computeSettlements(nets: Net[]): Transfer[] {
  const creditors = nets
    .filter(n => n.net_cents > 0)
    .map(n => ({ ...n }))
    .sort((a, b) => b.net_cents - a.net_cents);

  const debtors = nets
    .filter(n => n.net_cents < 0)
    .map(n => ({ ...n }))
    .sort((a, b) => a.net_cents - b.net_cents); // יותר שלילי קודם

  const transfers: Transfer[] = [];

  for (const d of debtors) {
    let debt = -d.net_cents; // חיובי
    if (debt === 0) continue;

    for (const c of creditors) {
      if (debt <= 0) break;
      if (c.net_cents <= 0) continue;

      const take = Math.min(c.net_cents, debt);
      transfers.push({
        from_uid: d.uid,
        from_name: d.name,
        to_uid: c.uid,
        to_name: c.name,
        amount_cents: take,
      });

      c.net_cents -= take;
      debt       -= take;
    }
  }

  return transfers;
}
