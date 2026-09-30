import {
  amountSuggestions,
  applyRounding,
  calcElapsedMs,
  calcTimeCharge,
  PaymentError,
  splitPayment,
  type TimerState,
} from '@/services/billing';
import { clockToTimestamp, formatAgo, formatDuration, formatMinutes } from '@/utils/time';
import { formatSom, parseSom } from '@/utils/money';

const MIN = 60_000;
const timer = (over: Partial<TimerState> = {}): TimerState => ({
  started_at: 0,
  ended_at: null,
  paused_at: null,
  paused_ms: 0,
  carried_ms: 0,
  ...over,
});

describe('applyRounding', () => {
  it.each([
    [30500, 1000, 'up', 31000],
    [30500, 1000, 'down', 30000],
    [30499, 1000, 'nearest', 30000],
    [30500, 1000, 'nearest', 31000],
    [31000, 1000, 'up', 31000],
    [12345, 500, 'up', 12500],
    [12345, 0, 'up', 12345],
    [0, 1000, 'up', 0],
  ] as const)('%d step=%d %s -> %d', (amount, step, mode, expected) => {
    expect(applyRounding(amount, { step, mode })).toBe(expected);
  });
});

describe('calcElapsedMs', () => {
  it('ochiq seans', () => {
    expect(calcElapsedMs(timer(), 10 * MIN)).toBe(10 * MIN);
  });
  it('yopilgan pauzalar ayiriladi', () => {
    expect(calcElapsedMs(timer({ paused_ms: 3 * MIN }), 10 * MIN)).toBe(7 * MIN);
  });
  it('pauza vaqtida taymer to‘xtaydi', () => {
    const t = timer({ paused_at: 4 * MIN, paused_ms: 1 * MIN });
    expect(calcElapsedMs(t, 4 * MIN)).toBe(3 * MIN);
    expect(calcElapsedMs(t, 60 * MIN)).toBe(3 * MIN);
  });
  it('oldingi stoldagi vaqt qo‘shiladi', () => {
    expect(calcElapsedMs(timer({ carried_ms: 20 * MIN, started_at: 100 * MIN }), 105 * MIN)).toBe(25 * MIN);
  });
});

describe('calcTimeCharge', () => {
  const rounding = { step: 1000, mode: 'up' as const };
  it('boshlangan daqiqa to‘liq hisoblanadi va yaxlitlanadi', () => {
    const t = { ...timer(), hourly_rate: 30000, carried_amount: 0 };
    const c = calcTimeCharge(t, 60 * MIN + 1, rounding);
    expect(c.minutes).toBe(61);
    expect(c.raw).toBe(30500);
    expect(c.amount).toBe(31000);
    expect(c.roundingAdj).toBe(500);
  });
  it('stol almashtirilganda ikki xil narx', () => {
    // 30 daqiqa 30 000 lik stolda (15 000), keyin 30 daqiqa 50 000 lik stolda (25 000)
    const t = { ...timer({ started_at: 0, carried_ms: 30 * MIN }), hourly_rate: 50000, carried_amount: 15000 };
    const c = calcTimeCharge(t, 30 * MIN, rounding);
    expect(c.minutes).toBe(60);
    expect(c.amount).toBe(40000);
  });
});

describe('splitPayment', () => {
  it('to‘liq naqd', () => {
    expect(splitPayment(50000, { cash: 50000, card: 0, transfer: 0 })).toMatchObject({ paid: 50000, debt: 0, change: 0 });
  });
  it('ortiqcha naqd qaytim bo‘ladi', () => {
    const s = splitPayment(73000, { cash: 100000, card: 0, transfer: 0 });
    expect(s).toMatchObject({ cash: 73000, paid: 73000, debt: 0, change: 27000 });
  });
  it('qisman to‘lov qarzga o‘tadi', () => {
    expect(splitPayment(80000, { cash: 30000, card: 20000, transfer: 0 })).toMatchObject({ paid: 50000, debt: 30000 });
  });
  it('kartadan ortiqcha to‘lab bo‘lmaydi', () => {
    expect(() => splitPayment(10000, { cash: 0, card: 20000, transfer: 0 })).toThrow(PaymentError);
  });
});

describe('amountSuggestions', () => {
  it('yaxlit summalarni taklif qiladi', () => {
    expect(amountSuggestions(112000)).toEqual([100000, 110000, 115000, 120000]);
    expect(amountSuggestions(40000)).toEqual([]);
    expect(amountSuggestions(3000)).toEqual([5000, 10000]);
  });
});

describe('formatlash', () => {
  it('so‘m', () => {
    expect(formatSom(1234567)).toBe("1 234 567 so'm");
    expect(formatSom(-5000, false)).toBe('−5 000');
    expect(parseSom('45 000 so‘m')).toBe(45000);
  });
  it('qo‘lda kiritilgan soat', () => {
    const ref = new Date(2026, 8, 30, 0, 30).getTime();
    expect(clockToTimestamp(23, 40, ref)).toBe(new Date(2026, 8, 29, 23, 40).getTime());
    expect(clockToTimestamp(0, 15, ref)).toBe(new Date(2026, 8, 30, 0, 15).getTime());
    expect(clockToTimestamp(0, 31, ref)).toBe(new Date(2026, 8, 30, 0, 31).getTime());
    expect(formatAgo(65 * 60_000)).toBe('1 soat 5 daq oldin');
  });
  it('vaqt', () => {
    expect(formatDuration(3_909_000)).toBe('1:05:09');
    expect(formatMinutes(65)).toBe('1 soat 5 daq');
    expect(formatMinutes(45)).toBe('45 daq');
  });
});
