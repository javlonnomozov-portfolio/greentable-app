import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Button, Divider, List, Modal, Portal, Searchbar, Text, TextInput, useTheme } from 'react-native-paper';
import { useDb, useQuery } from '@/db/hooks';
import { listCustomers, saveCustomer, type CustomerWithBalance } from '@/services/customers';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { useFeedback } from './FeedbackProvider';

interface Props {
  visible: boolean;
  onDismiss(): void;
  onPick(customer: { id: number; name: string }): void;
  /** Yangi mijoz formasi uchun boshlang'ich ism (masalan ochiq hisob nomi). */
  suggestedName?: string | null;
}

export function CustomerPicker({ visible, onDismiss, onPick, suggestedName }: Props) {
  const theme = useTheme();
  const db = useDb();
  const { run } = useFeedback();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const { data: customers = [] } = useQuery((d) => listCustomers(d, search), [search]);

  const reset = () => {
    setSearch('');
    setCreating(false);
    setName('');
    setPhone('');
  };
  const close = () => {
    reset();
    onDismiss();
  };
  const pick = (c: { id: number; name: string }) => {
    reset();
    onPick(c);
  };

  const create = async () => {
    const id = await run(() => saveCustomer(db, { name, phone }, Date.now()));
    if (id) pick({ id, name: name.trim() });
  };

  const startCreate = () => {
    setName(search.trim() || suggestedName || '');
    setCreating(true);
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={close} contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.background }]}>
        {creating ? (
          <View style={styles.form}>
            <Text variant="titleMedium">Yangi mijoz</Text>
            <TextInput mode="outlined" label="Ism" value={name} onChangeText={setName} autoFocus />
            <TextInput mode="outlined" label="Telefon (ixtiyoriy)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <View style={styles.actions}>
              <Button onPress={() => setCreating(false)}>Orqaga</Button>
              <Button mode="contained" onPress={create} disabled={!name.trim()}>
                Saqlash
              </Button>
            </View>
          </View>
        ) : (
          <>
            <Searchbar placeholder="Ism yoki telefon" value={search} onChangeText={setSearch} autoFocus={false} />
            <Button icon="account-plus" mode="contained-tonal" onPress={startCreate} style={styles.newBtn}>
              Yangi mijoz
            </Button>
            <FlatList
              data={customers}
              keyExtractor={(c) => String(c.id)}
              ItemSeparatorComponent={Divider}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.empty}>Mijoz topilmadi</Text>}
              renderItem={({ item }) => <CustomerItem customer={item} onPress={() => pick(item)} />}
            />
            <Button onPress={close}>Yopish</Button>
          </>
        )}
      </Modal>
    </Portal>
  );
}

function CustomerItem({ customer, onPress }: { customer: CustomerWithBalance; onPress(): void }) {
  return (
    <List.Item
      title={customer.name}
      description={customer.phone ?? undefined}
      onPress={onPress}
      left={(p) => <List.Icon {...p} icon="account" />}
      right={() =>
        customer.balance > 0 ? (
          <Text style={[styles.debt, { color: palette.debt }]}>{formatSom(customer.balance)}</Text>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  modal: { margin: 16, padding: 16, borderRadius: 20, maxHeight: '90%', flex: 1 },
  newBtn: { marginVertical: 8 },
  form: { gap: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  empty: { textAlign: 'center', padding: 24, color: palette.muted },
  debt: { alignSelf: 'center', fontWeight: '600' },
});
