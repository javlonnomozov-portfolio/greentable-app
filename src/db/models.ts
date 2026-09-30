export type PaymentMethod = 'cash' | 'card' | 'transfer';
export type BillKind = 'table' | 'sale';
export type BillStatus = 'open' | 'closed' | 'cancelled';

export interface TableRow {
  id: number;
  name: string;
  hourly_rate: number;
  is_active: number;
  sort_order: number;
}

export interface ProductRow {
  id: number;
  name: string;
  category: string;
  price: number;
  /** Saqlanmaydi — kirim/sanoq harakatlari va sotuvlardan hisoblanadi. */
  stock_qty: number;
  track_stock: number;
  is_active: number;
}

export interface CustomerRow {
  id: number;
  name: string;
  phone: string | null;
  note: string | null;
  created_at: number;
}

export interface BillRow {
  id: number;
  /** Ikki telefon o'rtasida bir xil bo'lgan global identifikator. */
  uid: string;
  updated_at: number;
  kind: BillKind;
  table_id: number | null;
  customer_id: number | null;
  label: string | null;
  status: BillStatus;
  started_at: number;
  ended_at: number | null;
  paused_at: number | null;
  paused_ms: number;
  carried_ms: number;
  carried_amount: number;
  hourly_rate: number;
  time_minutes: number;
  time_amount: number;
  items_amount: number;
  discount: number;
  rounding_adj: number;
  total: number;
  paid_amount: number;
  debt_amount: number;
  closed_at: number | null;
  cancel_reason: string | null;
}

export interface BillItemRow {
  id: number;
  bill_id: number;
  product_id: number | null;
  name: string;
  qty: number;
  unit_price: number;
  created_at: number;
}

export interface PaymentRow {
  id: number;
  bill_id: number | null;
  customer_id: number | null;
  amount: number;
  method: PaymentMethod;
  kind: 'bill' | 'debt_repayment';
  note: string | null;
  created_at: number;
}

export interface DebtRow {
  id: number;
  customer_id: number;
  bill_id: number | null;
  amount: number;
  note: string | null;
  created_at: number;
}

export interface ExpenseCategoryRow {
  id: number;
  name: string;
  is_active: number;
}

export interface ExpenseRow {
  id: number;
  category_id: number | null;
  amount: number;
  method: PaymentMethod;
  note: string | null;
  created_at: number;
}
