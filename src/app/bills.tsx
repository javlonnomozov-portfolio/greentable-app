import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, StyleSheet } from 'react-native';
import { Divider, List, Text } from 'react-native-paper';
import { EmptyState, PinGate } from '@/components/ui';
import { useQuery } from '@/db/hooks';
import { listBills } from '@/services/bills';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatDateTime } from '@/utils/time';

export default function BillsScreen() {
  const params = useLocalSearchParams<{ from: string; to: string; label: string }>();
  return (
    <PinGate>
      <Stack.Screen options={{ title: `Cheklar · ${params.label ?? ''}` }} />
      <BillList from={Number(params.from)} to={Number(params.to)} />
    </PinGate>
  );
}

function BillList({ from, to }: { from: number; to: number }) {
  const { data: bills = [] } = useQuery((d) => listBills(d, from, to), [from, to]);
  return (
    <FlatList
      data={bills}
      keyExtractor={(b) => String(b.id)}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={<EmptyState icon="receipt" title="Bu davrda chek yo'q" />}
      renderItem={({ item }) => {
        const cancelled = item.status === 'cancelled';
        const who = item.customer_name ?? item.label;
        return (
          <List.Item
            title={`#${item.id} · ${item.table_name ?? 'Stolsiz savdo'}${who ? ` · ${who}` : ''}`}
            description={[
              formatDateTime(item.closed_at),
              cancelled ? 'BEKOR QILINGAN' : null,
              item.debt_amount > 0 && !cancelled ? `qarz ${formatSom(item.debt_amount)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            onPress={() => router.push({ pathname: '/receipt/[id]', params: { id: item.id } })}
            left={(p) => <List.Icon {...p} icon={item.table_name ? 'billiards' : 'cart-outline'} />}
            right={() => (
              <Text
                style={[
                  styles.amount,
                  cancelled ? styles.cancelled : { color: item.debt_amount > 0 ? palette.debt : palette.income },
                ]}
              >
                {formatSom(item.total, false)}
              </Text>
            )}
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  amount: { alignSelf: 'center', fontWeight: '700', fontSize: 16 },
  cancelled: { color: palette.muted, textDecorationLine: 'line-through' },
});
