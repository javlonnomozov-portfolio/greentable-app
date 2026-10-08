import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Dialog, Divider, IconButton, Menu, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import { CustomerPicker } from '@/components/CustomerPicker';
import { useFeedback } from '@/components/FeedbackProvider';
import { usePin } from '@/components/PinProvider';
import { ProductPicker } from '@/components/ProductPicker';
import { TimePickerDialog } from '@/components/TimePickerDialog';
import { EmptyState, MoneyRow } from '@/components/ui';
import { useDb, useQuery } from '@/db/hooks';
import { useWriteGuard } from '@/hooks/useWriteGuard';
import { useNow } from '@/hooks/useNow';
import { useSettings } from '@/hooks/useSettings';
import { calcElapsedMs } from '@/services/billing';
import {
  addItem,
  cancelBill,
  changeItemQty,
  computeTotals,
  getBillDetail,
  listHall,
  moveSession,
  pauseSession,
  resumeSession,
  setBillCustomer,
  setSessionStart,
} from '@/services/bills';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatDuration, formatTime } from '@/utils/time';

/** Ochiq seans birinchi daqiqalarda PINsiz bekor qilinishi mumkin (xato bosilgan bo'lsa). */
const FREE_CANCEL_MS = 3 * 60_000;

export default function BillScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const billId = Number(id);
  const db = useDb();
  const guard = useWriteGuard();
  const theme = useTheme();
  const now = useNow();
  const { rounding } = useSettings();
  const { run, confirm } = useFeedback();
  const { requirePin } = usePin();
  const { data: detail, reload } = useQuery((d) => getBillDetail(d, billId), [billId]);
  const [picking, setPicking] = useState(false);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [moving, setMoving] = useState(false);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const [editingStart, setEditingStart] = useState(false);

  useEffect(() => {
    if (detail && detail.bill.status !== 'open') {
      router.replace({ pathname: '/receipt/[id]', params: { id: billId } });
    }
  }, [detail, billId]);

  if (detail === undefined) return null;
  if (detail === null) return <EmptyState icon="file-question-outline" title="Hisob topilmadi" />;

  const { bill, table, customer, items } = detail;
  const isTable = bill.kind === 'table';
  const paused = bill.paused_at != null;
  const totals = computeTotals(detail, now, rounding);
  const title = isTable ? (table?.name ?? 'Stol') : (customer?.name ?? bill.label ?? `Savdo #${bill.id}`);

  const act = (fn: () => Promise<unknown>) => run(fn).then(reload);

  const cancel = async () => {
    setMenu(false);
    const trivial = items.length === 0 && (!isTable || calcElapsedMs(bill, Date.now()) < FREE_CANCEL_MS);
    const ok = await confirm({
      title: 'Hisobni bekor qilish?',
      message: trivial ? undefined : "Hisob to'lovsiz yopiladi va hisobotga kirmaydi. Mahsulotlar omborga qaytadi.",
      confirmLabel: 'Bekor qilish',
      destructive: true,
    });
    if (!ok || (!trivial && !(await requirePin()))) return;
    const done = await run(async () => {
      await cancelBill(db, billId, 'Bekor qilindi', Date.now());
      return true;
    }, 'Hisob bekor qilindi');
    if (done) router.back();
  };

  const saveLabel = async () => {
    setRenaming(false);
    await act(() => setBillCustomer(db, billId, bill.customer_id, labelDraft));
  };

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <Menu visible={menu} onDismiss={() => setMenu(false)} anchor={<IconButton icon="dots-vertical" onPress={() => setMenu(true)} />}>
              {isTable && <Menu.Item leadingIcon="swap-horizontal" title="Stolni almashtirish" onPress={() => { setMenu(false); setMoving(true); }} />}
              <Menu.Item leadingIcon="close-circle-outline" title="Bekor qilish" onPress={cancel} />
            </Menu>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {isTable && totals.time && (
          <Card mode="contained" style={{ backgroundColor: paused ? palette.pausedBg : palette.busyBg }}>
            <Card.Content style={styles.timerCard}>
              <Text variant="displayMedium" style={[styles.timer, { color: palette.timer, opacity: paused ? 0.6 : 1 }]}>
                {formatDuration(calcElapsedMs(bill, now))}
              </Text>
              <Button compact icon="clock-edit-outline" textColor={palette.muted} onPress={() => setEditingStart(true)}>
                {bill.carried_ms > 0 ? 'Bu stolda' : 'Boshlandi'} {formatTime(bill.started_at)}
              </Button>
              <Text variant="bodyMedium" style={styles.muted}>
                {formatSom(bill.hourly_rate)} / soat
                {paused ? ' · PAUZA' : ''}
              </Text>
              <Text variant="headlineSmall" style={styles.bold}>
                {formatSom(totals.time.amount)}
              </Text>
              <Button
                mode="contained"
                icon={paused ? 'play' : 'pause'}
                buttonColor={paused ? palette.busy : palette.paused}
                onPress={() => act(() => (paused ? resumeSession(db, billId, Date.now()) : pauseSession(db, billId, Date.now())))}
                style={styles.pauseBtn}
              >
                {paused ? 'Davom ettirish' : 'Pauza'}
              </Button>
            </Card.Content>
          </Card>
        )}

        <View style={styles.who}>
          {customer ? (
            <Chip icon="account" onPress={() => setPickingCustomer(true)} onClose={() => act(() => setBillCustomer(db, billId, null))}>
              {customer.name}
            </Chip>
          ) : (
            <>
              {bill.label ? (
                <Chip icon="tag-outline" onPress={() => { setLabelDraft(bill.label ?? ''); setRenaming(true); }}>
                  {bill.label}
                </Chip>
              ) : (
                <Chip icon="pencil-outline" onPress={() => { setLabelDraft(''); setRenaming(true); }}>
                  Nom berish
                </Chip>
              )}
              <Chip icon="notebook-outline" onPress={() => setPickingCustomer(true)}>
                Mijozni tanlash
              </Chip>
            </>
          )}
        </View>

        <Card mode="outlined">
          <Card.Title title="Mahsulotlar" subtitle={items.length ? undefined : "Hali hech narsa qo'shilmagan"} />
          {items.map((item, i) => (
            <View key={item.id}>
              {i > 0 && <Divider />}
              <View style={styles.item}>
                <View style={styles.itemInfo}>
                  <Text variant="bodyLarge">{item.name}</Text>
                  <Text variant="bodySmall" style={styles.muted}>
                    {item.qty} × {formatSom(item.unit_price)}
                  </Text>
                </View>
                <IconButton icon="minus" mode="outlined" size={18} onPress={() => act(() => changeItemQty(db, item.id, -1))} />
                <Text variant="titleMedium" style={styles.qty}>
                  {item.qty}
                </Text>
                <IconButton icon="plus" mode="outlined" size={18} onPress={guard(() => act(() => changeItemQty(db, item.id, 1)))} />
                <Text variant="titleSmall" style={styles.itemSum}>
                  {formatSom(item.qty * item.unit_price, false)}
                </Text>
              </View>
            </View>
          ))}
          <Card.Actions>
            <Button icon="plus" mode="contained-tonal" onPress={guard(() => setPicking(true))}>
              Mahsulot qo'shish
            </Button>
          </Card.Actions>
        </Card>

        <Card mode="outlined">
          <Card.Content>
            {totals.time && <MoneyRow label="Stol vaqti" amount={totals.time.amount} />}
            <MoneyRow label="Mahsulotlar" amount={totals.itemsAmount} />
            <Divider style={styles.divider} />
            <MoneyRow label="Jami" amount={totals.subtotal} strong />
          </Card.Content>
        </Card>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.colors.surface }]}>
        <Button
          mode="contained"
          icon="cash-register"
          contentStyle={styles.payContent}
          labelStyle={styles.payLabel}
          disabled={!isTable && items.length === 0}
          onPress={() => router.push({ pathname: '/checkout/[id]', params: { id: billId } })}
        >
          Hisobni yopish · {formatSom(totals.subtotal)}
        </Button>
      </View>

      <ProductPicker
        visible={picking}
        onDismiss={() => setPicking(false)}
        onPick={(p) => act(() => addItem(db, billId, p.id, 1, Date.now()))}
      />
      <CustomerPicker
        visible={pickingCustomer}
        suggestedName={bill.label}
        onDismiss={() => setPickingCustomer(false)}
        onPick={(c) => {
          setPickingCustomer(false);
          act(() => setBillCustomer(db, billId, c.id));
        }}
      />
      {isTable && (
        <MoveDialog
          visible={moving}
          currentTableId={bill.table_id}
          onDismiss={() => setMoving(false)}
          onMove={(tableId) => {
            setMoving(false);
            act(() => moveSession(db, billId, tableId, Date.now()));
          }}
        />
      )}
      <TimePickerDialog
        visible={editingStart}
        title="Boshlanish vaqti"
        hint="Vaqt va summa qayta hisoblanadi"
        value={bill.started_at}
        min={now - 24 * 60 * 60_000}
        max={bill.paused_at ?? undefined}
        onDismiss={() => setEditingStart(false)}
        onConfirm={(ts) => {
          setEditingStart(false);
          act(() => setSessionStart(db, billId, ts, Date.now()));
        }}
      />
      <Portal>
        <Dialog visible={renaming} onDismiss={() => setRenaming(false)}>
          <Dialog.Title>Hisob nomi</Dialog.Title>
          <Dialog.Content>
            <TextInput mode="outlined" label="Masalan: Aziz aka" value={labelDraft} onChangeText={setLabelDraft} autoFocus />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRenaming(false)}>Bekor</Button>
            <Button mode="contained" onPress={saveLabel}>
              Saqlash
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

function MoveDialog({
  visible,
  currentTableId,
  onDismiss,
  onMove,
}: {
  visible: boolean;
  currentTableId: number | null;
  onDismiss(): void;
  onMove(tableId: number): void;
}) {
  const { data: tables = [] } = useQuery((d) => listHall(d), []);
  const free = tables.filter((t) => t.bill_id == null && t.id !== currentTableId);
  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>Qaysi stolga o'tkazamiz?</Dialog.Title>
        <Dialog.Content style={styles.moveList}>
          {free.length === 0 ? (
            <Text>Bo'sh stol yo'q</Text>
          ) : (
            free.map((t) => (
              <Button key={t.id} mode="outlined" onPress={() => onMove(t.id)}>
                {t.name} · {formatSom(t.hourly_rate)} / soat
              </Button>
            ))
          )}
          <Text variant="bodySmall" style={styles.muted}>
            O'tgan vaqt eski stol narxida hisoblanadi, keyingisi yangi stol narxida.
          </Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Bekor</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  timerCard: { alignItems: 'center', gap: 4, paddingVertical: 8 },
  timer: { fontVariant: ['tabular-nums'], fontWeight: '700' },
  pauseBtn: { marginTop: 8, alignSelf: 'stretch' },
  who: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 4 },
  itemInfo: { flex: 1 },
  qty: { minWidth: 24, textAlign: 'center' },
  itemSum: { minWidth: 72, textAlign: 'right' },
  divider: { marginVertical: 6 },
  footer: { padding: 16, elevation: 8 },
  payContent: { paddingVertical: 8 },
  payLabel: { fontSize: 16 },
  muted: { color: palette.muted },
  bold: { fontWeight: '700' },
  moveList: { gap: 8 },
});
