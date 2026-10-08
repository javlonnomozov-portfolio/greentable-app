import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, IconButton, Text } from 'react-native-paper';
import { useDb } from '@/db/hooks';
import { saveTable } from '@/services/catalog';
import { palette } from '@/theme';
import { useFeedback } from './FeedbackProvider';
import { useSync } from './SyncProvider';
import { AmountInput } from './ui';

/**
 * Bo'sh biliardxona: egasi bir bosishda stollarni yaratadi (nomlari "Stol 1…N", keyin Sozlamalarda o'zgaradi).
 * Sherik (admin) telefonida — egasi qo'shgach serverdan keladi.
 */
export function QuickSetup() {
  const db = useDb();
  const { run } = useFeedback();
  const { me, lastSyncAt, status } = useSync();
  const [count, setCount] = useState(4);
  const [rate, setRate] = useState(30000);
  const [busy, setBusy] = useState(false);

  if (lastSyncAt == null && status === 'syncing') {
    return (
      <Card mode="contained" style={styles.card}>
        <Card.Content style={styles.row}>
          <ActivityIndicator />
          <Text variant="bodyMedium">Biliardxona ma'lumotlari yuklanmoqda…</Text>
        </Card.Content>
      </Card>
    );
  }
  if (me?.user.role !== 'owner') {
    return (
      <Card mode="contained" style={styles.card}>
        <Card.Content>
          <Text variant="bodyMedium" style={styles.muted}>
            Stollar hali qo'shilmagan. Biliardxona egasi qo'shgach, shu yerda paydo bo'ladi.
          </Text>
        </Card.Content>
      </Card>
    );
  }

  const create = async () => {
    setBusy(true);
    await run(async () => {
      for (let i = 1; i <= count; i++) await saveTable(db, { name: `Stol ${i}`, hourly_rate: rate });
    }, `${count} ta stol qo'shildi`);
    setBusy(false);
  };

  return (
    <Card mode="contained" style={styles.card}>
      <Card.Content style={styles.gap}>
        <Text variant="titleMedium">Biliardxonani sozlash</Text>
        <Text variant="bodyMedium" style={styles.muted}>
          Nechta stol bor va 1 soati necha pul? Nomi va narxini keyin har bir stol uchun alohida o'zgartirish mumkin.
        </Text>
        <View style={styles.row}>
          <IconButton icon="minus" mode="outlined" disabled={count <= 1} onPress={() => setCount((c) => c - 1)} />
          <Text variant="headlineSmall" style={styles.count}>
            {count} ta stol
          </Text>
          <IconButton icon="plus" mode="outlined" disabled={count >= 50} onPress={() => setCount((c) => c + 1)} />
        </View>
        <AmountInput label="1 soat narxi" value={rate} onChange={setRate} />
        <Button mode="contained" icon="check" onPress={create} loading={busy} disabled={busy || rate <= 0}>
          Stollarni yaratish
        </Button>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, marginTop: 8 },
  gap: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  count: { minWidth: 120, textAlign: 'center' },
  muted: { color: palette.muted },
});
