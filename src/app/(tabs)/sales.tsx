import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Dialog, IconButton, Portal, Text, TextInput } from 'react-native-paper';
import { CustomerPicker } from '@/components/CustomerPicker';
import { useFeedback } from '@/components/FeedbackProvider';
import { EmptyState } from '@/components/ui';
import { SubscriptionBanner } from '@/components/SubscriptionStatus';
import { useDb, useQuery } from '@/db/hooks';
import { useWriteGuard } from '@/hooks/useWriteGuard';
import { listOpenSales, openSale } from '@/services/bills';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatTime } from '@/utils/time';

export default function SalesScreen() {
  const db = useDb();
  const { run } = useFeedback();
  const guard = useWriteGuard();
  const { data: sales = [] } = useQuery((d) => listOpenSales(d), []);
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState('');
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null);
  const [pickingCustomer, setPickingCustomer] = useState(false);

  const open = async (opts: { label?: string; customerId?: number | null } = {}) => {
    const id = await run(() => openSale(db, Date.now(), opts));
    if (id) router.push({ pathname: '/bill/[id]', params: { id } });
  };

  const openNamed = async () => {
    setNaming(false);
    await open({ label, customerId: customer?.id ?? null });
  };

  return (
    <View style={styles.root}>
      <SubscriptionBanner />
      <View style={styles.actions}>
        <Button mode="contained" icon="lightning-bolt" contentStyle={styles.big} onPress={guard(() => open())} style={styles.flex}>
          Tezkor savdo
        </Button>
        <Button
          mode="contained-tonal"
          icon="account-plus"
          contentStyle={styles.big}
          style={styles.flex}
          onPress={guard(() => {
            setLabel('');
            setCustomer(null);
            setNaming(true);
          })}
        >
          Odam nomiga
        </Button>
      </View>
      <View style={styles.headerRow}>
        <Text variant="titleMedium">Ochiq hisoblar</Text>
        <IconButton icon="cash-minus" onPress={() => router.push('/expense/new')} accessibilityLabel="Xarajat qo'shish" />
      </View>
      <FlatList
        data={sales}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="cart-outline"
            title="Ochiq hisob yo'q"
            hint="Stolsiz savdo uchun «Tezkor savdo», keyin to'laydigan odam uchun «Odam nomiga» ni bosing"
          />
        }
        renderItem={({ item }) => (
          <Card mode="outlined" onPress={() => router.push({ pathname: '/bill/[id]', params: { id: item.id } })}>
            <Card.Title
              title={item.customer_name ?? item.label ?? `Nomsiz hisob #${item.id}`}
              subtitle={`${formatTime(item.started_at)} dan · ${item.items_count} dona`}
              right={() => (
                <Text variant="titleMedium" style={styles.sum}>
                  {formatSom(item.items_amount)}
                </Text>
              )}
            />
          </Card>
        )}
      />

      <Portal>
        <Dialog visible={naming} onDismiss={() => setNaming(false)}>
          <Dialog.Title>Kimning hisobi?</Dialog.Title>
          <Dialog.Content style={styles.dialog}>
            {customer ? (
              <Chip icon="account" onClose={() => setCustomer(null)}>
                {customer.name}
              </Chip>
            ) : (
              <>
                <TextInput mode="outlined" label="Ismi" value={label} onChangeText={setLabel} autoFocus />
                <Button icon="notebook-outline" onPress={() => setPickingCustomer(true)}>
                  Qarz daftaridan tanlash
                </Button>
              </>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setNaming(false)}>Bekor</Button>
            <Button mode="contained" onPress={openNamed} disabled={!customer && !label.trim()}>
              Hisob ochish
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 16, paddingBottom: 4 },
  flex: { flexGrow: 1 },
  big: { paddingVertical: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  sum: { marginRight: 16, fontWeight: '700', color: palette.timer },
  dialog: { gap: 12 },
});
