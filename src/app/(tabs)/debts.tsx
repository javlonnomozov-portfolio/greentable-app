import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, Divider, FAB, List, Portal, Searchbar, Text, TextInput, useTheme } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { EmptyState } from '@/components/ui';
import { useDb, useQuery } from '@/db/hooks';
import { listCustomers, saveCustomer } from '@/services/customers';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatDate } from '@/utils/time';

export default function DebtsScreen() {
  const db = useDb();
  const theme = useTheme();
  const { run } = useFeedback();
  const [search, setSearch] = useState('');
  const [onlyDebtors, setOnlyDebtors] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const { data: customers = [] } = useQuery((d) => listCustomers(d, search), [search]);

  const debtors = customers.filter((c) => c.balance > 0);
  const outstanding = debtors.reduce((s, c) => s + c.balance, 0);
  const shown = onlyDebtors ? debtors : customers;

  const create = async () => {
    const id = await run(() => saveCustomer(db, { name, phone }, Date.now()));
    if (!id) return;
    setCreating(false);
    router.push({ pathname: '/customer/[id]', params: { id } });
  };

  return (
    <View style={styles.root}>
      <View style={[styles.summary, { backgroundColor: palette.debtBg }]}>
        <Text variant="bodyMedium">Umumiy qarz ({debtors.length} kishi)</Text>
        <Text variant="headlineSmall" style={[styles.bold, { color: palette.debt }]}>
          {formatSom(outstanding)}
        </Text>
      </View>
      <Searchbar placeholder="Ism yoki telefon" value={search} onChangeText={setSearch} style={styles.search} />
      <View style={styles.filters}>
        <Chip selected={onlyDebtors} onPress={() => setOnlyDebtors(true)}>
          Qarzdorlar
        </Chip>
        <Chip selected={!onlyDebtors} onPress={() => setOnlyDebtors(false)}>
          Barcha mijozlar
        </Chip>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(c) => String(c.id)}
        ItemSeparatorComponent={Divider}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState icon="notebook-check-outline" title={onlyDebtors ? "Qarzdorlar yo'q" : "Mijozlar yo'q"} />
        }
        renderItem={({ item }) => (
          <List.Item
            title={item.name}
            description={[item.phone, item.last_activity_at ? `oxirgi: ${formatDate(item.last_activity_at)}` : null]
              .filter(Boolean)
              .join(' · ')}
            onPress={() => router.push({ pathname: '/customer/[id]', params: { id: item.id } })}
            left={(p) => <List.Icon {...p} icon="account-circle-outline" />}
            right={() => (
              <Text
                variant="titleMedium"
                style={[
                  styles.amount,
                  { color: item.balance > 0 ? palette.debt : item.balance < 0 ? palette.income : palette.muted },
                ]}
              >
                {item.balance === 0 ? '0' : formatSom(Math.abs(item.balance))}
                {item.balance < 0 ? ' (haqdor)' : ''}
              </Text>
            )}
            style={{ backgroundColor: theme.colors.surface }}
          />
        )}
      />
      <FAB
        icon="account-plus"
        label="Yangi mijoz"
        style={styles.fab}
        onPress={() => {
          setName(search);
          setPhone('');
          setCreating(true);
        }}
      />
      <Portal>
        <Dialog visible={creating} onDismiss={() => setCreating(false)}>
          <Dialog.Title>Yangi mijoz</Dialog.Title>
          <Dialog.Content style={styles.dialog}>
            <TextInput mode="outlined" label="Ism" value={name} onChangeText={setName} autoFocus />
            <TextInput mode="outlined" label="Telefon (ixtiyoriy)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setCreating(false)}>Bekor</Button>
            <Button mode="contained" onPress={create} disabled={!name.trim()}>
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
  summary: { margin: 16, marginBottom: 8, borderRadius: 16, padding: 16 },
  bold: { fontWeight: '700' },
  search: { marginHorizontal: 16 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  list: { paddingBottom: 96 },
  amount: { alignSelf: 'center', fontWeight: '700' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
  dialog: { gap: 12 },
});
