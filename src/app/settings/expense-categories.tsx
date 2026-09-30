import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Button, Dialog, Divider, FAB, List, Portal, Switch, TextInput } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { PinGate } from '@/components/ui';
import { useDb, useQuery } from '@/db/hooks';
import { listExpenseCategories, saveExpenseCategory, setExpenseCategoryActive } from '@/services/catalog';
import { palette } from '@/theme';

export default function ExpenseCategoriesSettings() {
  return (
    <PinGate>
      <CategoriesEditor />
    </PinGate>
  );
}

function CategoriesEditor() {
  const db = useDb();
  const { run } = useFeedback();
  const { data: categories = [] } = useQuery((d) => listExpenseCategories(d, true), []);
  const [editing, setEditing] = useState<{ id?: number; name: string } | null>(null);

  const save = async () => {
    if (!editing) return;
    const id = await run(() => saveExpenseCategory(db, editing), 'Saqlandi');
    if (id) setEditing(null);
  };

  return (
    <View style={styles.root}>
      <FlatList
        data={categories}
        keyExtractor={(c) => String(c.id)}
        ItemSeparatorComponent={Divider}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <List.Item
            title={item.name}
            titleStyle={!item.is_active && styles.inactive}
            onPress={() => setEditing({ id: item.id, name: item.name })}
            right={() => (
              <Switch
                value={item.is_active === 1}
                onValueChange={(v) => run(() => setExpenseCategoryActive(db, item.id, v))}
                style={styles.switch}
              />
            )}
          />
        )}
      />
      <FAB icon="plus" label="Qo'shish" style={styles.fab} onPress={() => setEditing({ name: '' })} />
      <Portal>
        <Dialog visible={editing != null} onDismiss={() => setEditing(null)}>
          <Dialog.Title>Xarajat turi</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="Nomi"
              value={editing?.name ?? ''}
              onChangeText={(name) => setEditing((e) => e && { ...e, name })}
              autoFocus
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditing(null)}>Bekor</Button>
            <Button mode="contained" onPress={save}>
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
  list: { paddingBottom: 96 },
  inactive: { color: palette.muted, textDecorationLine: 'line-through' },
  switch: { alignSelf: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
