import * as Sharing from 'expo-sharing';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, Text, ThemeProvider } from 'react-native-paper';
import { captureRef } from 'react-native-view-shot';
import { errorMessage, useFeedback } from '@/components/FeedbackProvider';
import { usePin } from '@/components/PinProvider';
import { EmptyState, METHOD_LABELS, MoneyRow, Row } from '@/components/ui';
import { useDb, useQuery } from '@/db/hooks';
import { useSettings } from '@/hooks/useSettings';
import { cancelBill, getBillDetail, getBillPayments } from '@/services/bills';
import { palette, receiptTheme } from '@/theme';
import { formatDateTime, formatMinutes, formatTime } from '@/utils/time';

/** Oq qog'ozda o'qiladigan to'q oltin (qarz). */
const DEBT_ON_PAPER = '#8A6D00';

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const billId = Number(id);
  const db = useDb();
  const { hallName } = useSettings();
  const { run, confirm, toast } = useFeedback();
  const { requirePin } = usePin();
  const receiptRef = useRef<View>(null);
  const { data } = useQuery(
    async (d) => {
      const detail = await getBillDetail(d, billId);
      return detail ? { detail, payments: await getBillPayments(d, billId) } : null;
    },
    [billId],
  );

  if (data === undefined) return null;
  if (data === null) return <EmptyState icon="file-question-outline" title="Chek topilmadi" />;

  const { detail, payments } = data;
  const { bill, table, customer, items } = detail;
  const cancelled = bill.status === 'cancelled';

  const share = async () => {
    try {
      const uri = await captureRef(receiptRef, { format: 'png', quality: 1, fileName: `chek-${billId}` });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `Chek #${billId}` });
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const cancel = async () => {
    const ok = await confirm({
      title: `Chek #${billId} ni bekor qilish?`,
      message: "To'lovlar va qarz yozuvi o'chiriladi, mahsulotlar omborga qaytadi. Bu amalni qaytarib bo'lmaydi.",
      confirmLabel: 'Bekor qilish',
      destructive: true,
    });
    if (!ok || !(await requirePin())) return;
    await run(() => cancelBill(db, billId, 'Yopilgandan keyin bekor qilindi', Date.now()), 'Chek bekor qilindi');
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ThemeProvider theme={receiptTheme}>
        <View ref={receiptRef} collapsable={false} style={styles.paper}>
          <Text variant="titleLarge" style={styles.center}>
            {hallName}
          </Text>
          <Text variant="bodyMedium" style={[styles.center, styles.muted]}>
            Chek #{bill.id} · {formatDateTime(bill.closed_at ?? bill.started_at)}
          </Text>
          {/* Ikki telefonda chek raqami har xil bo'ladi — shu kod bo'yicha bir-birini topish mumkin. */}
          <Text variant="bodySmall" style={[styles.center, styles.muted]}>
            Kod: {bill.uid.slice(0, 6).toUpperCase()}
          </Text>
          {cancelled && (
            <Text variant="titleMedium" style={[styles.center, { color: palette.danger }]}>
              BEKOR QILINGAN
            </Text>
          )}
          <Divider style={styles.divider} />
          {table && (
            <>
              <Row label={table.name} value={`${formatTime(bill.started_at)} – ${bill.ended_at ? formatTime(bill.ended_at) : '…'}`} />
              <MoneyRow label={`O'yin vaqti · ${formatMinutes(bill.time_minutes)}`} amount={bill.time_amount} />
            </>
          )}
          {items.map((i) => (
            <MoneyRow key={i.id} label={`${i.name} × ${i.qty}`} amount={i.qty * i.unit_price} />
          ))}
          {bill.discount !== 0 && (
            <>
              <MoneyRow label="Hisoblangan" amount={bill.total + bill.discount} />
              <MoneyRow
                label={bill.discount > 0 ? 'Chegirma' : 'Ustama'}
                amount={-bill.discount}
                color={bill.discount > 0 ? DEBT_ON_PAPER : receiptTheme.colors.primary}
              />
            </>
          )}
          <Divider style={styles.divider} />
          <MoneyRow label="JAMI" amount={bill.total} strong />
          {payments.map((p) => (
            <MoneyRow key={p.method} label={METHOD_LABELS[p.method]} amount={p.amount} />
          ))}
          {bill.debt_amount > 0 && <MoneyRow label="Qarzga" amount={bill.debt_amount} color={DEBT_ON_PAPER} strong />}
          {(customer || bill.label) && (
            <Row label="Mijoz" value={customer?.name ?? bill.label ?? ''} />
          )}
          <Text variant="bodySmall" style={[styles.center, styles.muted, styles.thanks]}>
            Rahmat! Yana kutib qolamiz.
          </Text>
          <Text variant="labelSmall" style={[styles.center, styles.brand]}>
            GreenTable · biliardxona boshqaruv tizimi
          </Text>
        </View>
      </ThemeProvider>

      <View style={styles.actions}>
        {!cancelled && (
          <Button mode="contained" icon="share-variant" onPress={share}>
            Rasm sifatida ulashish
          </Button>
        )}
        {customer && (
          <Button
            mode="outlined"
            icon="notebook-outline"
            onPress={() => router.push({ pathname: '/customer/[id]', params: { id: customer.id } })}
          >
            Mijoz qarz daftari
          </Button>
        )}
        {!cancelled && bill.status === 'closed' && (
          <Button textColor={palette.danger} icon="close-circle-outline" onPress={cancel}>
            Chekni bekor qilish
          </Button>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  paper: { backgroundColor: 'white', borderRadius: 12, padding: 20, elevation: 2 },
  center: { textAlign: 'center' },
  muted: { color: palette.muted },
  divider: { marginVertical: 10 },
  thanks: { marginTop: 16 },
  brand: { marginTop: 4, color: receiptTheme.colors.primary, letterSpacing: 0.5 },
  actions: { gap: 8 },
});
