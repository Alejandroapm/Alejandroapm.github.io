/** Row-level access: super users see everything; regular users see only their own data. */
export function ownerClause(auth, alias = "") {
  if (auth?.isSuper) return { sql: "", binds: [] };
  const col = alias ? `${alias}.owner_id` : "owner_id";
  return { sql: ` AND ${col} = ?`, binds: [auth.userId] };
}

export async function assertCustomerAccess(db, customerId, auth) {
  const row = await db.prepare("SELECT * FROM customers WHERE id = ?").bind(customerId).first();
  if (!row) return null;
  if (!auth.isSuper && row.owner_id !== auth.userId) return null;
  return row;
}

export async function assertWorkdayAccess(db, workDayId, auth) {
  const row = await db.prepare("SELECT * FROM work_days WHERE id = ?").bind(workDayId).first();
  if (!row) return null;
  if (!auth.isSuper && row.owner_id !== auth.userId) return null;
  return row;
}
