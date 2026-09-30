import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Divider, HelperText, Text, useTheme } from 'react-native-paper';
import { CustomerPicker } from '@/components/CustomerPicker';
import { useFeedback } from '@/components/FeedbackProvider';
import { TimePickerDialog } from '@/components/TimePickerDialog';
import { AmountInput, EmptyState, MoneyRow, SectionTitle } from '@/components/ui';
import { useDb, useQuery } from '@/db/hooks';
import { useSettings } from '@/hooks/useSettings';
import { amountSuggestions, PaymentError, splitPayment, type PaymentInput, type PaymentSplit } from '@/services/billing';
import { closeBill, computeTotals, getBillDetail } from '@/services/bills';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatAgo, formatMinutes, formatTime } from '@/utils/time';

export default function CheckoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const billId = Number(id);
  const db = useDb();
  const theme = useTheme();
  const { rounding } = useSettings();
  const { run, toast } = useFeedback();
  // Vaqt shu ekran ochilgan paytda to'xtatiladi — ko'rsatilgan summa aynan to'lanadigan summa.
  const [frozenAt] = useState(() => Date.now());
  const { data: detail } = useQuery((d) => getBillDetail(d, billId), [billId]);
  /** O'yin tugagan vaqt: admin kechikib yopayotgan bo'lsa qo'lda tanlanadi. */
  const [endAt, setEndAt] = useState<number | null>(null);
  const [pickingEnd, setPickingEnd] = useState(false);
  /** Admin kelishgan summa; null — hisoblangan summa olinadi. */
  const [finalTotal, setFinalTotal] = useState<number | null>(null);
  const [payment, setPayment] = useState<PaymentInput | null>(null);
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [saving, setSaving] = useState(false);

  if (detail === undefined) return null;
  if (detail === null || detail.bill.status !== 'open') {
    return <EmptyState icon="file-check-outline" title="Bu hisob allaqachon yopilgan" />;
  }

  const { bill } = detail;
  const isTable = bill.kind === 'table';
  const endedAt = endAt ?? frozenAt;
  const totals = computeTotals(detail, endedAt, rounding);
  const total = finalTotal ?? totals.subtotal;
  const adjustment = total - totals.subtotal;
  // Kassir o'zgartirmaguncha butun summa naqd deb olinadi.
  const pay = payment ?? { cash: total, card: 0, transfer: 0 };
  const chosenCustomer = customer ?? (detail.customer ? { id: detail.customer.id, name: detail.customer.name } : null);

  let split: PaymentSplit | null = null;
  let payError: string | null = null;
  try {
    split = splitPayment(total, pay);
  } catch (e) {
    payError = e instanceof PaymentError ? e.message : String(e);
  }
  const needsCustomer = !!split && split.debt > 0 && !chosenCustomer;
  const canSubmit = !!split && !needsCustomer && !saving;

  const setAll = (method: keyof PaymentInput | null) =>
    setPayment({ cash: 0, card: 0, transfer: 0, ...(method ? { [method]: total } : {}) });

  const chooseTotal = (value: number | null) => {
    setFinalTotal(value);
    // To'lov summasi yangi yakuniy summaga moslashadi.
    setPayment(null);
  };

  const submit = async () => {
    setSaving(true);
    const res = await run(() =>
      closeBill(db, billId, {
        now: Date.now(),
        endedAt,
        rounding,
        finalTotal: total,
        payment: pay,
        customerId: chosenCustomer?.id ?? null,
      }),
    );
    setSaving(false);
    if (!res) return;
    const parts = ['Hisob yopildi'];
    if (res.change > 0) parts.push(`Qaytim: ${formatSom(res.change)}`);
    if (res.debt > 0) parts.push(`Qarzga: ${formatSom(res.debt)}`);
    toast(parts.join(' · '));
    router.dismissAll();
    router.push({ pathname: '/receipt/[id]', params: { id: billId } });
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card mode="outlined">
          <Card.Content>
            {isTable && totals.time && (
              <>
                <MoneyRow
                  label="Stol vaqti"
                  hint={`${detail.table?.name ?? ''} · ${formatMinutes(totals.time.minutes)}${
                    totals.time.roundingAdj
                      ? ` · yaxlitlash ${totals.time.roundingAdj > 0 ? '+' : ''}${formatSom(totals.time.roundingAdj, false)}`
                      : ''
                  }`}
                  amount={totals.time.amount}
                />
                <View style={styles.timeRow}>
                  <Text variant="bodyMedium" style={styles.muted}>
                    {formatTime(bill.started_at)} → {formatTime(endedAt)}
                  </Text>
                  <Button
                    compact
                    icon="clock-edit-outline"
                    textColor={endAt ? palette.paused : undefined}
                    onPress={() => setPickingEnd(true)}
                  >
                    {endAt ? `Tugagan: ${formatAgo(frozenAt - endAt)}` : 'Tugash vaqti'}
                  </Button>
                </View>
              </>
            )}
            {detail.items.map((i) => (
              <MoneyRow key={i.id} label={`${i.name} × ${i.qty}`} amount={i.qty * i.unit_price} />
            ))}
            <Divider style={styles.divider} />
            <MoneyRow label="Hisoblangan summa" amount={totals.subtotal} strong />
          </Card.Content>
        </Card>

        <SectionTitle>To'lanadigan summa</SectionTitle>
        <AmountInput label="Mijoz to'laydi" value={total} onChange={(v) => chooseTotal(v)} />
        <View style={styles.quick}>
          {finalTotal != null && finalTotal !== totals.subtotal && (
            <Chip icon="calculator-variant-outline" onPress={() => chooseTotal(null)}>
              Hisoblangan: {formatSom(totals.subtotal, false)}
            </Chip>
          )}
          {amountSuggestions(totals.subtotal).map((v) => (
            <Chip key={v} selected={total === v} onPress={() => chooseTotal(v)}>
              {formatSom(v, false)}
            </Chip>
          ))}
        </View>
        {adjustment !== 0 && (
          <HelperText type="info" style={{ color: adjustment < 0 ? palette.debt : palette.income }}>
            {adjustment < 0 ? `Chegirma: ${formatSom(-adjustment)}` : `Ustama: ${formatSom(adjustment)}`}
          </HelperText>
        )}

        <View style={[styles.totalBox, { backgroundColor: theme.colors.primaryContainer }]}>
          <Text variant="titleMedium">To'lanadi</Text>
          <Text variant="headlineMedium" style={[styles.bold, styles.amount]} numberOfLines={1} adjustsFontSizeToFit>
            {formatSom(total)}
          </Text>
        </View>

        <SectionTitle>To'lov</SectionTitle>
        <View style={styles.quick}>
          <Chip icon="cash" onPress={() => setAll('cash')}>
            Hammasi naqd
          </Chip>
          <Chip icon="credit-card-outline" onPress={() => setAll('card')}>
            Hammasi karta
          </Chip>
          <Chip icon="notebook-outline" onPress={() => setAll(null)}>
            Hammasi qarzga
          </Chip>
        </View>
        <AmountInput label="Naqd" value={pay.cash} onChange={(v) => setPayment({ ...pay, cash: v })} />
        <AmountInput label="Karta" value={pay.card} onChange={(v) => setPayment({ ...pay, card: v })} />
        <AmountInput label="O'tkazma (Click, Payme)" value={pay.transfer} onChange={(v) => setPayment({ ...pay, transfer: v })} />
        {payError && <HelperText type="error">{payError}</HelperText>}

        {split && split.change > 0 && (
          <View style={[styles.infoBox, { backgroundColor: palette.incomeBg }]}>
            <View style={styles.flex}>
              <Text variant="titleMedium">Qaytim</Text>
              <Text variant="bodySmall" style={styles.muted}>
                Mijoz qaytimni olmasa — yuqorida summani {formatSom(total + split.change, false)} qiling
              </Text>
            </View>
            <Text variant="headlineSmall" style={[styles.bold, { color: palette.income }]} numberOfLines={1}>
              {formatSom(split.change)}
            </Text>
          </View>
        )}

        {split && split.debt > 0 && (
          <View style={[styles.infoBox, styles.debtBox, { backgroundColor: palette.debtBg }]}>
            <View style={styles.debtHead}>
              <Text variant="titleMedium">Qarzga yoziladi</Text>
              <Text
                variant="headlineSmall"
                style={[styles.bold, styles.amount, { color: palette.debt }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatSom(split.debt)}
              </Text>
            </View>
            {chosenCustomer ? (
              <Chip icon="account" onPress={() => setPickingCustomer(true)} onClose={customer ? () => setCustomer(null) : undefined}>
                {chosenCustomer.name}
              </Chip>
            ) : (
              <Button mode="contained" icon="account-search" buttonColor={palette.debt} onPress={() => setPickingCustomer(true)}>
                Mijozni tanlang
              </Button>
            )}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.colors.surface }]}>
        <Button mode="contained" icon="check" disabled={!canSubmit} loading={saving} onPress={submit} contentStyle={styles.submit}>
          {split && split.debt > 0 && split.paid === 0 ? 'Qarzga yozish' : "To'landi — yopish"}
        </Button>
      </View>

      {isTable && (
        <TimePickerDialog
          visible={pickingEnd}
          title="Tugash vaqti"
          hint="Stol qachon bo'shagan bo'lsa, o'sha vaqtni tanlang"
          value={endedAt}
          min={bill.started_at}
          max={frozenAt}
          onDismiss={() => setPickingEnd(false)}
          onConfirm={(ts) => {
            setEndAt(frozenAt - ts < 60_000 ? null : ts);
            setPayment(null);
            setPickingEnd(false);
          }}
        />
      )}
      <CustomerPicker
        visible={pickingCustomer}
        suggestedName={bill.label}
        onDismiss={() => setPickingCustomer(false)}
        onPick={(c) => {
          setCustomer(c);
          setPickingCustomer(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  divider: { marginVertical: 6 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  totalBox: {
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  amount: { flexShrink: 1, textAlign: 'right' },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoBox: { borderRadius: 16, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  debtBox: { flexDirection: 'column', alignItems: 'stretch', gap: 12 },
  debtHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  muted: { color: palette.muted },
  bold: { fontWeight: '700' },
  footer: { padding: 16, elevation: 8 },
  submit: { paddingVertical: 8 },
});
