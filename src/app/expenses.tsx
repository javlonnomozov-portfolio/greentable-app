import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, StyleSheet } from 'react-native';
import { Divider, List, Text } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { usePin } from '@/components/PinProvider';
import { EmptyState, METHOD_LABELS, PinGate } from '@/components/ui';
import { useDb, useQuery } from '@/db/hooks';
import { deleteExpense, listExpenses, type ExpenseListItem } from '@/services/expenses';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatDateTime } from '@/utils/time';

export default function ExpensesScreen() {
  const params = useLocalSearchParams<{ from: string; to: string; label: string }>();
  return (
    <PinGate>
      <Stack.Screen options={{ title: `Xarajatlar · ${params.label ?? ''}` }} />
      <ExpenseList from={Number(params.from)} to={Number(params.to)} />
    </PinGate>
  );
}

function ExpenseList({ from, to }: { from: number; to: number }) {
  const db = useDb();
  const { run, confirm } = useFeedback();
  const { requirePin } = usePin();
  const { data: expenses = [] } = useQuery((d) => listExpenses(d, from, to), [from, to]);

  const remove = async (e: ExpenseListItem) => {
    const ok = await confirm({
      title: "Xarajatni o'chirish?",
      message: `${e.category_name ?? 'Boshqa'}: ${formatSom(e.amount)}`,
      confirmLabel: "O'chirish",
      destructive: true,
    });
    if (ok && (await requirePin())) await run(() => deleteExpense(db, e.id), "O'chirildi");
  };

  return (
    <FlatList
      data={expenses}
      keyExtractor={(e) => String(e.id)}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={<EmptyState icon="cash-minus" title="Bu davrda xarajat yo'q" />}
      ListHeaderComponent={
        expenses.length ? (
          <Text variant="labelLarge" style={styles.header}>
            Jami: {formatSom(expenses.reduce((s, e) => s + e.amount, 0))} · o'chirish uchun bosib turing
          </Text>
        ) : null
      }
      renderItem={({ item }) => (
        <List.Item
          title={item.category_name ?? 'Boshqa'}
          description={[formatDateTime(item.created_at), METHOD_LABELS[item.method], item.note].filter(Boolean).join(' · ')}
          onLongPress={() => remove(item)}
          right={() => <Text style={styles.amount}>−{formatSom(item.amount, false)}</Text>}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  header: { padding: 16, color: palette.muted },
  amount: { alignSelf: 'center', color: palette.expense, fontWeight: '700', fontSize: 16 },
});
