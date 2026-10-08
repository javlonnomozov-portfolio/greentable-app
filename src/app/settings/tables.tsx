import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { Button, Dialog, Divider, FAB, IconButton, List, Portal, Text, TextInput } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { TABLE_KINDS, kindIcon } from '@/components/tableKinds';
import { AmountInput, ChoiceChip, EmptyState, PinGate } from '@/components/ui';
import type { TableKind, TableRow } from '@/db/models';
import { useDb, useQuery } from '@/db/hooks';
import { useWriteGuard } from '@/hooks/useWriteGuard';
import { listTables, saveTable, setTableActive } from '@/services/catalog';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';

/** Yangi joyga nom yozilmasa: «Stol 3», «PS 2», «Kompyuter 1». */
const NAME_PREFIX: Record<TableKind, string> = { billiard: 'Stol', ps: 'PS', pc: 'Kompyuter', other: 'Joy' };

export default function TablesSettings() {
  return (
    <PinGate>
      <TablesEditor />
    </PinGate>
  );
}

function TablesEditor() {
  const db = useDb();
  const guard = useWriteGuard();
  const { run, confirm } = useFeedback();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const { data: tables = [] } = useQuery((d) => listTables(d, true), []);
  // Zaldagi "Stol qo'shish" kartasidan kelinganda forma darhol ochiladi.
  const [editing, setEditing] = useState<Partial<TableRow> | null>(() => (add === '1' ? {} : null));

  const active = tables.filter((t) => t.is_active === 1);
  const removed = tables.filter((t) => t.is_active !== 1);
  const kind = editing?.kind ?? 'billiard';
  const defaultName = `${NAME_PREFIX[kind]} ${tables.filter((t) => t.kind === kind).length + 1}`;
  const defaultRate = active[active.length - 1]?.hourly_rate ?? 30000;

  const save = async () => {
    if (!editing) return;
    const input = {
      id: editing.id,
      name: editing.name?.trim() || (editing.id ? '' : defaultName),
      hourly_rate: editing.hourly_rate ?? defaultRate,
      kind,
    };
    const id = await run(() => saveTable(db, input), editing.id ? 'Saqlandi' : `${input.name} qo'shildi`);
    if (id) setEditing(null);
  };

  const remove = async (table: TableRow) => {
    const ok = await confirm({
      title: `${table.name} ni olib tashlash?`,
      message: "Stol zaldan yo'qoladi. Uning cheklari va hisobotlari saqlanib qoladi, xohlasangiz qaytarish mumkin.",
      confirmLabel: 'Olib tashlash',
      destructive: true,
    });
    if (ok) await run(() => setTableActive(db, table.id, false), `${table.name} olib tashlandi`);
  };

  const sections = [
    { key: 'active', title: `Zaldagi stollar (${active.length})`, data: active },
    ...(removed.length ? [{ key: 'removed', title: 'Olib tashlangan stollar', data: removed }] : []),
  ];

  return (
    <View style={styles.root}>
      <SectionList
        sections={sections}
        keyExtractor={(t) => String(t.id)}
        ItemSeparatorComponent={Divider}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => <List.Subheader>{section.title}</List.Subheader>}
        renderSectionFooter={({ section }) =>
          section.key === 'active' && section.data.length === 0 ? (
            <EmptyState icon="billiards" title="Zalda stol yo'q" hint="Pastdagi tugma bilan qo'shing" />
          ) : null
        }
        renderItem={({ item }) =>
          item.is_active ? (
            <List.Item
              title={item.name}
              description={`${formatSom(item.hourly_rate)} / soat`}
              onPress={() => setEditing(item)}
              left={(p) => <List.Icon {...p} icon={kindIcon(item.kind)} />}
              right={() => (
                <IconButton icon="delete-outline" iconColor={palette.danger} onPress={() => remove(item)} />
              )}
            />
          ) : (
            <List.Item
              title={item.name}
              titleStyle={styles.inactive}
              description={`${formatSom(item.hourly_rate)} / soat`}
              left={(p) => <List.Icon {...p} icon={kindIcon(item.kind)} color={palette.muted} />}
              right={() => (
                <Button icon="restore" compact onPress={() => run(() => setTableActive(db, item.id, true), `${item.name} qaytarildi`)}>
                  Qaytarish
                </Button>
              )}
            />
          )
        }
      />
      <FAB icon="plus" label="Stol qo'shish" style={styles.fab} onPress={guard(() => setEditing({}))} />
      <Portal>
        <Dialog visible={editing != null} onDismiss={() => setEditing(null)}>
          <Dialog.Title>{editing?.id ? 'Stolni tahrirlash' : 'Yangi stol'}</Dialog.Title>
          <Dialog.Content style={styles.dialog}>
            <View style={styles.kinds}>
              {TABLE_KINDS.map((k) => (
                <ChoiceChip
                  key={k.value}
                  icon={k.icon}
                  selected={kind === k.value}
                  onPress={() => setEditing((e) => ({ ...e, kind: k.value }))}
                >
                  {k.label}
                </ChoiceChip>
              ))}
            </View>
            <TextInput
              mode="outlined"
              label="Nomi"
              placeholder={editing?.id ? undefined : defaultName}
              value={editing?.name ?? ''}
              onChangeText={(name) => setEditing((e) => ({ ...e, name }))}
            />
            <AmountInput
              label="1 soat narxi"
              value={editing?.hourly_rate ?? (editing?.id ? 0 : defaultRate)}
              onChange={(hourly_rate) => setEditing((e) => ({ ...e, hourly_rate }))}
            />
            {!editing?.id && (
              <Text variant="bodySmall" style={styles.muted}>
                Nom yozilmasa «{defaultName}» deb saqlanadi.
              </Text>
            )}
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
  fab: { position: 'absolute', right: 16, bottom: 16 },
  dialog: { gap: 12 },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  muted: { color: palette.muted },
});
