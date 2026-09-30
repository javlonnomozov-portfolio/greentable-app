import dayjs from 'dayjs';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Dialog, Portal, Switch, Text } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { PeriodSwitcher } from '@/components/PeriodSwitcher';
import { PinGate, SectionTitle } from '@/components/ui';
import { useDb, useQuery } from '@/db/hooks';
import { useSettings } from '@/hooks/useSettings';
import {
  countOpenBills,
  exportData,
  importData,
  parseBackup,
  type BackupFile,
  type MergeCounts,
  type MergeStats,
} from '@/services/backup';
import { periodFor, type PeriodKind } from '@/services/reports';
import { setSetting } from '@/services/settings';
import { palette } from '@/theme';
import { formatDate, formatDateTime } from '@/utils/time';

export default function BackupSettings() {
  return (
    <PinGate>
      <BackupScreen />
    </PinGate>
  );
}

const COUNT_LABELS: Record<keyof MergeCounts, string> = {
  bills: 'chek',
  payments: "to'lov",
  debts: 'qarz yozuvi',
  expenses: 'xarajat',
  customers: 'mijoz',
  tables: 'stol',
  products: 'mahsulot',
  expenseCategories: 'xarajat turi',
  stockMoves: 'ombor harakati',
};

function describeCounts(counts: Partial<MergeCounts>): string {
  const parts = (Object.keys(COUNT_LABELS) as (keyof MergeCounts)[])
    .filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => `${counts[k]} ${COUNT_LABELS[k]}`);
  return parts.length ? parts.join(', ') : "yo'q";
}

function fileCounts(file: BackupFile): Partial<MergeCounts> {
  return {
    bills: file.bills.length,
    payments: file.payments.length,
    debts: file.debts.length,
    expenses: file.expenses.length,
    customers: file.customers.length,
  };
}

/** Fayl matnini o'qiydi: tanlangan fayl ham, boshqa ilova (Telegram) bergan content:// manzil ham. */
async function readText(uri: string): Promise<string> {
  try {
    return await new File(uri).text();
  } catch {
    return readAsStringAsync(uri);
  }
}

function BackupScreen() {
  const db = useDb();
  const { lastBackupAt, dayStartHour } = useSettings();
  const { run, toast } = useFeedback();
  const { data: openBills = 0 } = useQuery((d) => countOpenBills(d), []);
  const [busy, setBusy] = useState(false);
  const [allTime, setAllTime] = useState(false);
  const [kind, setKind] = useState<PeriodKind>('day');
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const period = periodFor(kind, offset, now, dayStartHour);
  /** Tanlangan, lekin hali qo'shilmagan fayl (tasdiqlash oynasi uchun). */
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [result, setResult] = useState<MergeStats | null>(null);

  // "Open with → GreenTable" orqali kelgan fayl: darhol o'qib, qo'shishni so'raymiz.
  const { import: incoming } = useLocalSearchParams<{ import?: string }>();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!incoming || handled.current === incoming) return;
    handled.current = incoming;
    run(async () => parseBackup(await readText(incoming))).then((file) => {
      if (file) {
        setResult(null);
        setPending(file);
      }
    });
  }, [incoming, run]);

  const backup = async () => {
    setBusy(true);
    await run(async () => {
      const at = Date.now();
      const data = await exportData(db, at, allTime ? null : period);
      const suffix = allTime ? 'toliq' : kind === 'day' ? 'kun' : kind === 'week' ? 'hafta' : 'oy';
      const file = new File(Paths.cache, `greentable-${dayjs(at).format('YYYY-MM-DD-HHmm')}-${suffix}.json`);
      file.create({ overwrite: true });
      file.write(JSON.stringify(data));
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Zaxira faylini yuborish' });
      await setSetting(db, 'last_backup_at', at);
      toast(`Faylda: ${describeCounts(fileCounts(data))}`);
    });
    setBusy(false);
  };

  const pick = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    const file = await run(async () => parseBackup(await readText(picked.assets[0].uri)));
    if (file) {
      setResult(null);
      setPending(file);
    }
  };

  const merge = async () => {
    const file = pending;
    setPending(null);
    if (!file) return;
    setBusy(true);
    const stats = await run(() => importData(db, file));
    setBusy(false);
    if (stats) {
      setResult(stats);
      toast("Ma'lumotlar birlashtirildi");
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card mode="contained" style={{ backgroundColor: palette.incomeBg }}>
        <Card.Content style={styles.gap}>
          <Text variant="titleSmall">Ikki telefon bilan ishlash</Text>
          <Text variant="bodyMedium">
            Kun oxirida «Bugun» uchun zaxira oling va faylni sherigingizga Telegram orqali yuboring. U «Faylni qo'shish»
            tugmasi bilan qo'shadi: uning ma'lumotlari o'chmaydi, sizning kuningiz qo'shiladi. Bitta faylni ikki marta
            qo'shsa ham takrorlanmaydi.
          </Text>
        </Card.Content>
      </Card>

      <SectionTitle>Zaxira olish</SectionTitle>
      <View style={styles.switchRow}>
        <Text variant="bodyLarge">Butun tarix</Text>
        <Switch value={allTime} onValueChange={setAllTime} />
      </View>
      {!allTime && (
        <PeriodSwitcher
          kind={kind}
          offset={offset}
          period={period}
          onChange={(k, o) => {
            setKind(k);
            setOffset(o);
            setNow(Date.now());
          }}
        />
      )}
      <Text variant="bodySmall" style={styles.muted}>
        {allTime
          ? "Barcha ma'lumotlar — telefon almashtirilganda yoki to'liq zaxira uchun."
          : `${formatDate(period.from)} – ${formatDate(period.to - 1)} oralig'ida yopilgan, o'zgargan yoki o'chirilgan yozuvlar. Stollar, mahsulotlar va mijozlar ro'yxati har doim to'liq qo'shiladi.`}
      </Text>
      {openBills > 0 && (
        <Card mode="contained" style={{ backgroundColor: palette.debtBg }}>
          <Card.Content>
            <Text variant="bodyMedium">
              {openBills} ta ochiq hisob (o'ynalayotgan stol yoki yopilmagan savdo) zaxiraga kirmaydi. Sherigingiz ularni
              ko'rishi uchun avval yoping — to'lanmagan bo'lsa qarzga yozing.
            </Text>
          </Card.Content>
        </Card>
      )}
      <Button mode="contained" icon="share-variant" onPress={backup} loading={busy} disabled={busy} contentStyle={styles.btn}>
        Zaxira olish va yuborish
      </Button>
      <Text variant="bodySmall" style={styles.muted}>
        Oxirgi zaxira: {lastBackupAt ? formatDateTime(lastBackupAt) : 'hali olinmagan'}. Telefon yo'qolsa yoki buzilsa,
        zaxirasiz ma'lumotni tiklab bo'lmaydi — Telegram'dagi «Saved Messages» ga ham yuborib qo'ying.
      </Text>

      <SectionTitle>Sherikdan kelgan faylni qo'shish</SectionTitle>
      <Button mode="outlined" icon="file-import-outline" onPress={pick} disabled={busy} contentStyle={styles.btn}>
        Faylni qo'shish
      </Button>
      {result && (
        <Card mode="outlined">
          <Card.Content style={styles.gap}>
            <Text variant="titleSmall">Natija</Text>
            <Text variant="bodyMedium">Qo'shildi: {describeCounts(result.added)}</Text>
            <Text variant="bodyMedium">Yangilandi: {describeCounts(result.updated)}</Text>
          </Card.Content>
        </Card>
      )}

      <Portal>
        <Dialog visible={pending != null} onDismiss={() => setPending(null)}>
          <Dialog.Title>Faylni qo'shish?</Dialog.Title>
          {pending && (
            <Dialog.Content style={styles.gap}>
              <Text variant="bodyMedium">Olingan vaqti: {formatDateTime(pending.exportedAt)}</Text>
              <Text variant="bodyMedium">
                Davr:{' '}
                {pending.period
                  ? `${formatDate(pending.period.from)} – ${formatDate(pending.period.to - 1)}`
                  : 'butun tarix'}
              </Text>
              <Text variant="bodyMedium">Ichida: {describeCounts(fileCounts(pending))}</Text>
              <Text variant="bodySmall" style={styles.muted}>
                Bu telefondagi ma'lumotlar o'chirilmaydi. Yangi yozuvlar qo'shiladi, ikkala telefonda bo'lganlari esa
                oxirgi o'zgarish bo'yicha yangilanadi.
              </Text>
            </Dialog.Content>
          )}
          <Dialog.Actions>
            <Button onPress={() => setPending(null)}>Bekor</Button>
            <Button mode="contained" onPress={merge}>
              Qo'shish
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  gap: { gap: 6 },
  btn: { paddingVertical: 6 },
  muted: { color: palette.muted },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
