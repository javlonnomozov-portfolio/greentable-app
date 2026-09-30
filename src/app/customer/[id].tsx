import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Linking, StyleSheet, View } from 'react-native';
import { Button, Dialog, Divider, IconButton, List, Portal, Text, TextInput } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { usePin } from '@/components/PinProvider';
import { AmountInput, EmptyState, METHOD_LABELS, MethodPicker } from '@/components/ui';
import type { PaymentMethod } from '@/db/models';
import { useDb, useQuery } from '@/db/hooks';
import {
  addManualDebt,
  deleteLedgerEntry,
  getCustomer,
  getLedger,
  repayDebt,
  saveCustomer,
  type LedgerEntry,
} from '@/services/customers';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatDateTime } from '@/utils/time';

type DialogKind = 'repay' | 'debt' | 'edit' | null;

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const customerId = Number(id);
  const db = useDb();
  const { run, confirm } = useFeedback();
  const { requirePin } = usePin();
  const { data } = useQuery(
    async (d) => {
      const customer = await getCustomer(d, customerId);
      return customer ? { customer, ledger: await getLedger(d, customerId) } : null;
    },
    [customerId],
  );
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  if (data === undefined) return null;
  if (data === null) return <EmptyState icon="account-question-outline" title="Mijoz topilmadi" />;
  const { customer, ledger } = data;

  const openDialog = (kind: DialogKind) => {
    setAmount(kind === 'repay' ? Math.max(0, customer.balance) : 0);
    setMethod('cash');
    setNote('');
    setName(customer.name);
    setPhone(customer.phone ?? '');
    setDialog(kind);
  };

  const submit = async () => {
    const now = Date.now();
    const kind = dialog;
    setDialog(null);
    if (kind === 'repay') {
      await run(() => repayDebt(db, customerId, amount, method, note, now), `To'lov qabul qilindi: ${formatSom(amount)}`);
    } else if (kind === 'debt') {
      await run(() => addManualDebt(db, customerId, amount, note, now), 'Qarz yozildi');
    } else if (kind === 'edit') {
      await run(() => saveCustomer(db, { id: customerId, name, phone, note: customer.note }, now));
    }
  };

  const onEntryPress = (entry: LedgerEntry) => {
    if (entry.bill_id != null) router.push({ pathname: '/receipt/[id]', params: { id: entry.bill_id } });
  };

  const onEntryLongPress = async (entry: LedgerEntry) => {
    if (entry.type === 'debt' && entry.bill_id != null) {
      onEntryPress(entry);
      return;
    }
    const ok = await confirm({
      title: "Yozuvni o'chirish?",
      message: `${entry.type === 'debt' ? 'Qarz' : "To'lov"}: ${formatSom(entry.amount)} (${formatDateTime(entry.created_at)})`,
      confirmLabel: "O'chirish",
      destructive: true,
    });
    if (ok && (await requirePin())) await run(() => deleteLedgerEntry(db, entry), "O'chirildi");
  };

  const balanceColor = customer.balance > 0 ? palette.debt : customer.balance < 0 ? palette.income : palette.muted;

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: customer.name,
          headerRight: () => <IconButton icon="pencil-outline" onPress={() => openDialog('edit')} />,
        }}
      />
      <View style={styles.head}>
        <Text variant="bodyMedium" style={styles.muted}>
          {customer.balance >= 0 ? 'Qarzi' : "Ortiqcha to'lagan (haqdor)"}
        </Text>
        <Text variant="displaySmall" style={[styles.bold, { color: balanceColor }]}>
          {formatSom(Math.abs(customer.balance))}
        </Text>
        {customer.phone ? (
          <Button icon="phone" compact onPress={() => Linking.openURL(`tel:${customer.phone}`)}>
            {customer.phone}
          </Button>
        ) : null}
        <View style={styles.actions}>
          <Button mode="contained" icon="cash-plus" style={styles.flex} onPress={() => openDialog('repay')}>
            Qarzni to'lash
          </Button>
          <Button mode="outlined" icon="plus" style={styles.flex} onPress={() => openDialog('debt')}>
            Qarz yozish
          </Button>
        </View>
      </View>
      <Divider />
      <FlatList
        data={ledger}
        keyExtractor={(e) => `${e.type}-${e.id}`}
        ItemSeparatorComponent={Divider}
        ListHeaderComponent={
          <Text variant="labelLarge" style={styles.listTitle}>
            Tarix (o'chirish uchun bosib turing)
          </Text>
        }
        ListEmptyComponent={<EmptyState icon="notebook-outline" title="Hali yozuv yo'q" />}
        renderItem={({ item }) => (
          <List.Item
            title={item.type === 'debt' ? `Qarz: ${item.note ?? "qo'lda yozilgan"}` : `To'lov · ${METHOD_LABELS[item.method ?? 'cash']}`}
            description={[formatDateTime(item.created_at), item.type === 'payment' ? item.note : null].filter(Boolean).join(' · ')}
            onPress={() => onEntryPress(item)}
            onLongPress={() => onEntryLongPress(item)}
            left={(p) => (
              <List.Icon
                {...p}
                icon={item.type === 'debt' ? 'arrow-top-right' : 'arrow-bottom-left'}
                color={item.type === 'debt' ? palette.debt : palette.income}
              />
            )}
            right={() => (
              <Text style={[styles.amount, { color: item.type === 'debt' ? palette.debt : palette.income }]}>
                {item.type === 'debt' ? '+' : '−'}
                {formatSom(item.amount, false)}
              </Text>
            )}
          />
        )}
      />

      <Portal>
        <Dialog visible={dialog != null} onDismiss={() => setDialog(null)}>
          <Dialog.Title>
            {dialog === 'repay' ? "Qarzni to'lash" : dialog === 'debt' ? 'Qarz yozish' : "Mijozni tahrirlash"}
          </Dialog.Title>
          <Dialog.Content style={styles.dialog}>
            {dialog === 'edit' ? (
              <>
                <TextInput mode="outlined" label="Ism" value={name} onChangeText={setName} />
                <TextInput mode="outlined" label="Telefon" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              </>
            ) : (
              <>
                <AmountInput label="Summa" value={amount} onChange={setAmount} autoFocus />
                {dialog === 'repay' && <MethodPicker value={method} onChange={setMethod} />}
                <TextInput mode="outlined" label="Izoh (ixtiyoriy)" value={note} onChangeText={setNote} />
              </>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialog(null)}>Bekor</Button>
            <Button mode="contained" onPress={submit} disabled={dialog === 'edit' ? !name.trim() : amount <= 0}>
              Saqlash
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { alignItems: 'center', padding: 16, gap: 4 },
  muted: { color: palette.muted },
  bold: { fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12, alignSelf: 'stretch' },
  flex: { flexGrow: 1 },
  listTitle: { paddingHorizontal: 16, paddingTop: 12, color: palette.muted },
  amount: { alignSelf: 'center', fontWeight: '700', fontSize: 16 },
  dialog: { gap: 12 },
});
