import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Chip, Dialog, Portal, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { CustomerPicker } from '@/components/CustomerPicker';
import { DurationChips } from '@/components/DurationChips';
import { QuickSetup } from '@/components/QuickSetup';
import { SubscriptionBanner } from '@/components/SubscriptionStatus';
import { useFeedback } from '@/components/FeedbackProvider';
import { TableCard } from '@/components/TableCard';
import { TimePickerDialog } from '@/components/TimePickerDialog';
import { useDb, useQuery } from '@/db/hooks';
import { useNow } from '@/hooks/useNow';
import { useSettings } from '@/hooks/useSettings';
import { useWriteGuard } from '@/hooks/useWriteGuard';
import { applyRounding, calcTimeCharge, segmentCharge } from '@/services/billing';
import { listHall, startTableSession, type HallTable } from '@/services/bills';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatAgo, formatMinutes, formatTime } from '@/utils/time';

/** Gridning oxiridagi "Stol qo'shish" kartasi. */
const ADD_TILE = 'add' as const;
type HallItem = HallTable | typeof ADD_TILE;

const DAY_MS = 24 * 60 * 60_000;

export default function HallScreen() {
  const db = useDb();
  const now = useNow();
  const { rounding } = useSettings();
  const { run } = useFeedback();
  const { width } = useWindowDimensions();
  const guard = useWriteGuard();
  const { data: tables } = useQuery((d) => listHall(d), []);
  const [starting, setStarting] = useState<HallTable | null>(null);
  const [label, setLabel] = useState('');
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  /** null — o'yin hozir boshlanadi; aks holda admin kiritgan haqiqiy boshlanish vaqti. */
  const [startAt, setStartAt] = useState<number | null>(null);
  const [pickingTime, setPickingTime] = useState(false);
  /** Vaqtli seans muddati, daqiqa (null — cheksiz). */
  const [planned, setPlanned] = useState<number | null>(null);

  const columns = width >= 1000 ? 4 : width >= 680 ? 3 : 2;
  const list = tables ?? [];
  const busy = list.filter((t) => t.bill_id != null);
  const runningTotal = busy.reduce((sum, t) => {
    if (t.started_at == null) return sum;
    const charge = calcTimeCharge({ ...t, started_at: t.started_at, hourly_rate: t.bill_rate ?? t.hourly_rate }, now, rounding);
    return sum + charge.amount + t.items_amount;
  }, 0);

  const openStart = (table: HallTable) => {
    setLabel('');
    setCustomer(null);
    setStartAt(null);
    setPlanned(null);
    setStarting(table);
  };

  const start = async () => {
    if (!starting) return;
    const table = starting;
    setStarting(null);
    await run(
      () =>
        startTableSession(db, table.id, Date.now(), {
          customerId: customer?.id ?? null,
          label,
          startedAt: startAt ?? undefined,
          plannedMinutes: planned,
        }),
      `${table.name} ${startAt ? `${formatTime(startAt)} dan ` : ''}boshlandi${planned ? ` · ${formatMinutes(planned)}` : ''}`,
    );
  };

  const data: HallItem[] = [...list, ADD_TILE];

  return (
    <View style={styles.root}>
      <SubscriptionBanner />
      {tables && list.length === 0 ? <QuickSetup /> : null}
      <View style={styles.summary}>
        <Text variant="titleSmall">
          Band: {busy.length} / {list.length}
        </Text>
        <Text variant="titleSmall" style={{ color: palette.timer }}>
          Hozirgi hisob: {formatSom(runningTotal)}
        </Text>
      </View>
      <FlatList
        key={columns}
        data={data}
        numColumns={columns}
        keyExtractor={(t) => (t === ADD_TILE ? ADD_TILE : String(t.id))}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <View style={{ width: `${100 / columns}%`, padding: 6 }}>
            {item === ADD_TILE ? (
              <TouchableRipple
                style={styles.addTile}
                borderless
                onPress={guard(() => router.push({ pathname: '/settings/tables', params: { add: '1' } }))}
              >
                <View style={styles.addInner}>
                  <MaterialCommunityIcons name="plus-circle-outline" size={40} color={palette.muted} />
                  <Text variant="titleSmall" style={{ color: palette.muted }}>
                    Stol qo'shish
                  </Text>
                </View>
              </TouchableRipple>
            ) : (
              <TableCard
                table={item}
                now={now}
                rounding={rounding}
                onPress={() =>
                  item.bill_id != null
                    ? router.push({ pathname: '/bill/[id]', params: { id: item.bill_id } })
                    : guard(openStart)(item)
                }
              />
            )}
          </View>
        )}
      />

      <Portal>
        <Dialog visible={starting != null} onDismiss={() => setStarting(null)} style={styles.dialogBox}>
          <Dialog.Title>{starting?.name} — boshlash</Dialog.Title>
          {/* Muddat va mijoz qo'shilganda oyna kichik ekranga sig'masligi mumkin — ichi aylantiriladi. */}
          <Dialog.ScrollArea style={styles.scrollArea}>
            <ScrollView contentContainerStyle={styles.dialog} keyboardShouldPersistTaps="handled">
              <Text variant="bodyMedium" style={{ color: palette.muted }}>
                Narx: {formatSom(starting?.hourly_rate ?? 0)} / soat
              </Text>
              <Button
                mode="outlined"
                icon="clock-edit-outline"
                onPress={() => setPickingTime(true)}
                textColor={startAt ? palette.paused : undefined}
              >
                {startAt ? `Boshlangan: ${formatTime(startAt)}` : 'Boshlanish: hozir'}
              </Button>
              {startAt ? (
                <Text variant="bodySmall" style={{ color: palette.paused, textAlign: 'center' }}>
                  {formatAgo(now - startAt)} — vaqt shundan hisoblanadi
                </Text>
              ) : null}
              <Text variant="labelLarge">Muddat</Text>
              <DurationChips value={planned} onChange={setPlanned} />
              {planned ? (
                <Text variant="bodySmall" style={{ color: palette.timer }}>
                  {formatMinutes(planned)} ≈ {formatSom(applyRounding(segmentCharge(planned * 60_000, starting?.hourly_rate ?? 0), rounding))}
                  {' '}— vaqt tugaganda ovozli xabar beriladi
                </Text>
              ) : null}
              {customer ? (
                <Chip icon="account" onClose={() => setCustomer(null)}>
                  {customer.name}
                </Chip>
              ) : (
                <>
                  <TextInput mode="outlined" label="Kim o'ynayapti? (ixtiyoriy)" value={label} onChangeText={setLabel} />
                  <Button icon="notebook-outline" onPress={() => setPickingCustomer(true)}>
                    Qarz daftaridan tanlash
                  </Button>
                </>
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setStarting(null)}>Bekor</Button>
            <Button mode="contained" icon="play" onPress={start}>
              Boshlash
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <TimePickerDialog
        visible={pickingTime}
        title="Boshlanish vaqti"
        hint="O'yin oldinroq boshlangan bo'lsa, haqiqiy vaqtni tanlang"
        value={startAt ?? now}
        min={now - DAY_MS}
        onDismiss={() => setPickingTime(false)}
        onConfirm={(ts) => {
          setStartAt(Date.now() - ts < 60_000 ? null : ts);
          setPickingTime(false);
        }}
      />
      <CustomerPicker
        visible={pickingCustomer}
        suggestedName={label}
        onDismiss={() => setPickingCustomer(false)}
        onPick={(c) => {
          setCustomer(c);
          setPickingCustomer(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexWrap: 'wrap',
    gap: 8,
  },
  grid: { paddingHorizontal: 10, paddingBottom: 24 },
  dialogBox: { maxHeight: '88%' },
  scrollArea: { paddingHorizontal: 0, borderTopWidth: 0, borderBottomWidth: 0 },
  dialog: { gap: 12, paddingHorizontal: 24, paddingVertical: 4 },
  addTile: {
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: palette.muted,
    minHeight: 150,
    justifyContent: 'center',
  },
  addInner: { alignItems: 'center', gap: 6, padding: 12 },
});
