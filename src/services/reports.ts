import dayjs from 'dayjs';
import type { PaymentMethod } from '@/db/models';
import type { Db } from '@/db/types';

// ---------- Davrlar ----------

export type PeriodKind = 'day' | 'week' | 'month';

export interface Period {
  from: number;
  to: number;
  label: string;
}

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

/** Ish kuni `dayStartHour` da boshlanadi: soat 02:00 dagi o'yin kechagi kunga yoziladi. */
export function businessDayStart(ts: number, dayStartHour: number): dayjs.Dayjs {
  let d = dayjs(ts);
  if (d.hour() < dayStartHour) d = d.subtract(1, 'day');
  return d.startOf('day').add(dayStartHour, 'hour');
}

/** `offset` = 0 joriy davr, -1 oldingisi va h.k. */
export function periodFor(kind: PeriodKind, offset: number, now: number, dayStartHour: number): Period {
  const today = businessDayStart(now, dayStartHour);
  if (kind === 'day') {
    const start = today.add(offset, 'day');
    const label = offset === 0 ? 'Bugun' : offset === -1 ? 'Kecha' : start.format('DD.MM.YYYY');
    return { from: start.valueOf(), to: start.add(1, 'day').valueOf(), label };
  }
  if (kind === 'week') {
    const monday = today.subtract((today.day() + 6) % 7, 'day').add(offset, 'week');
    const end = monday.add(1, 'week');
    const label = offset === 0 ? 'Shu hafta' : `${monday.format('DD.MM')} – ${end.subtract(1, 'day').format('DD.MM')}`;
    return { from: monday.valueOf(), to: end.valueOf(), label };
  }
  const start = today.startOf('month').add(dayStartHour, 'hour').add(offset, 'month');
  return {
    from: start.valueOf(),
    to: start.add(1, 'month').valueOf(),
    label: `${MONTHS[start.month()]} ${start.year()}`,
  };
}

export interface DailyPoint {
  dayStart: number;
  label: string;
  total: number;
}

/** Tushumni ish kunlari bo'yicha guruhlaydi (bo'sh kunlar 0 bilan). */
export function groupDaily(
  rows: { closed_at: number; total: number }[],
  period: { from: number; to: number },
  dayStartHour: number,
): DailyPoint[] {
  const points: DailyPoint[] = [];
  const index = new Map<number, DailyPoint>();
  for (let d = dayjs(period.from); d.valueOf() < period.to; d = d.add(1, 'day')) {
    const p = { dayStart: d.valueOf(), label: d.format('DD'), total: 0 };
    points.push(p);
    index.set(p.dayStart, p);
  }
  for (const r of rows) {
    const p = index.get(businessDayStart(r.closed_at, dayStartHour).valueOf());
    if (p) p.total += r.total;
  }
  return points;
}

// ---------- Hisobot ----------

export type ByMethod = Record<PaymentMethod, number> & { total: number };

const emptyByMethod = (): ByMethod => ({ cash: 0, card: 0, transfer: 0, total: 0 });

export interface Report {
  revenue: {
    tableTime: number;
    tableBar: number;
    sales: number;
    /** Hisoblangan summadan kam olingani (chegirmalar). */
    discount: number;
    /** Hisoblangan summadan ko'p olingani (ustamalar). */
    extra: number;
    total: number;
    billCount: number;
    tableMinutes: number;
  };
  /** Haqiqiy pul harakati: kirim (cheklar + qaytarilgan qarz) va chiqim (xarajatlar). */
  cash: {
    income: ByMethod;
    fromBills: number;
    fromDebtRepayments: number;
    expenses: ByMethod;
    net: ByMethod;
  };
  expensesByCategory: { name: string; amount: number }[];
  debts: { given: number; repaid: number; outstanding: number };
  /** Tushum − xarajatlar. */
  profit: number;
  tables: { name: string; sessions: number; minutes: number; amount: number }[];
  products: { name: string; qty: number; amount: number }[];
  daily: DailyPoint[];
}

export async function getReport(db: Db, period: { from: number; to: number }, dayStartHour: number): Promise<Report> {
  const range = [period.from, period.to];

  const revenueRows = await db.getAllAsync<{
    kind: 'table' | 'sale';
    n: number;
    time: number;
    items: number;
    discount: number;
    extra: number;
    total: number;
    minutes: number;
  }>(
    `SELECT kind, COUNT(*) AS n, SUM(time_amount) AS time, SUM(items_amount) AS items,
       SUM(CASE WHEN discount > 0 THEN discount ELSE 0 END) AS discount,
       SUM(CASE WHEN discount < 0 THEN -discount ELSE 0 END) AS extra,
       SUM(total) AS total, SUM(time_minutes) AS minutes
     FROM bills WHERE status = 'closed' AND closed_at >= ? AND closed_at < ? GROUP BY kind`,
    range,
  );
  const revenue = { tableTime: 0, tableBar: 0, sales: 0, discount: 0, extra: 0, total: 0, billCount: 0, tableMinutes: 0 };
  for (const r of revenueRows) {
    if (r.kind === 'table') {
      revenue.tableTime += r.time;
      revenue.tableBar += r.items;
      revenue.tableMinutes += r.minutes;
    } else {
      revenue.sales += r.items;
    }
    revenue.discount += r.discount;
    revenue.extra += r.extra;
    revenue.total += r.total;
    revenue.billCount += r.n;
  }

  const paymentRows = await db.getAllAsync<{ method: PaymentMethod; kind: 'bill' | 'debt_repayment'; amount: number }>(
    `SELECT method, kind, SUM(amount) AS amount FROM payments
     WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ? GROUP BY method, kind`,
    range,
  );
  const income = emptyByMethod();
  let fromBills = 0;
  let fromDebtRepayments = 0;
  for (const p of paymentRows) {
    income[p.method] += p.amount;
    income.total += p.amount;
    if (p.kind === 'bill') fromBills += p.amount;
    else fromDebtRepayments += p.amount;
  }

  const expenseRows = await db.getAllAsync<{ name: string | null; method: PaymentMethod; amount: number }>(
    `SELECT c.name AS name, e.method, SUM(e.amount) AS amount
     FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
     WHERE e.deleted_at IS NULL AND e.created_at >= ? AND e.created_at < ? GROUP BY e.category_id, e.method`,
    range,
  );
  const expenses = emptyByMethod();
  const byCategory = new Map<string, number>();
  for (const e of expenseRows) {
    expenses[e.method] += e.amount;
    expenses.total += e.amount;
    const name = e.name ?? 'Boshqa';
    byCategory.set(name, (byCategory.get(name) ?? 0) + e.amount);
  }
  const net: ByMethod = {
    cash: income.cash - expenses.cash,
    card: income.card - expenses.card,
    transfer: income.transfer - expenses.transfer,
    total: income.total - expenses.total,
  };

  const debtRow = await db.getFirstAsync<{ given: number; repaid: number; outstanding: number }>(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM debts
                 WHERE deleted_at IS NULL AND created_at >= ?1 AND created_at < ?2), 0) AS given,
       COALESCE((SELECT SUM(amount) FROM payments
                 WHERE kind = 'debt_repayment' AND deleted_at IS NULL AND created_at >= ?1 AND created_at < ?2), 0) AS repaid,
       COALESCE((SELECT SUM(amount) FROM debts WHERE deleted_at IS NULL), 0)
         - COALESCE((SELECT SUM(amount) FROM payments WHERE kind = 'debt_repayment' AND deleted_at IS NULL), 0)
         AS outstanding`,
    range,
  );

  const tables = await db.getAllAsync<{ name: string; sessions: number; minutes: number; amount: number }>(
    `SELECT t.name, COUNT(b.id) AS sessions, SUM(b.time_minutes) AS minutes, SUM(b.time_amount) AS amount
     FROM bills b JOIN tables t ON t.id = b.table_id
     WHERE b.status = 'closed' AND b.kind = 'table' AND b.closed_at >= ? AND b.closed_at < ?
     GROUP BY b.table_id ORDER BY amount DESC`,
    range,
  );

  const products = await db.getAllAsync<{ name: string; qty: number; amount: number }>(
    `SELECT i.name, SUM(i.qty) AS qty, SUM(i.qty * i.unit_price) AS amount
     FROM bill_items i JOIN bills b ON b.id = i.bill_id
     WHERE b.status = 'closed' AND b.closed_at >= ? AND b.closed_at < ?
     GROUP BY i.name ORDER BY amount DESC LIMIT 10`,
    range,
  );

  const dailyRows = await db.getAllAsync<{ closed_at: number; total: number }>(
    "SELECT closed_at, total FROM bills WHERE status = 'closed' AND closed_at >= ? AND closed_at < ?",
    range,
  );

  return {
    revenue,
    cash: { income, fromBills, fromDebtRepayments, expenses, net },
    expensesByCategory: [...byCategory.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount),
    debts: debtRow ?? { given: 0, repaid: 0, outstanding: 0 },
    profit: revenue.total - expenses.total,
    tables,
    products,
    daily: groupDaily(dailyRows, period, dayStartHour),
  };
}
