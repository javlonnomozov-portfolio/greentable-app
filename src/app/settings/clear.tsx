import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Checkbox, Text, TextInput } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { useSync } from '@/components/SyncProvider';
import { EmptyState, PinGate } from '@/components/ui';
import { api } from '@/sync/api';
import { palette } from '@/theme';

const CONFIRM_WORD = "O'CHIRISH";

/** Serverda o'chiriladigan jadvallar (katalog belgilansa — stollar, mahsulotlar, xarajat turlari ham). */
const HISTORY = ['bills', 'bill_items', 'payments', 'debts', 'expenses', 'stock_moves', 'customers'];
const CATALOG = ['tables', 'products', 'expense_categories'];

/** Telefon klaviaturasidagi har xil apostroflar (', ʻ, ’, `) bir xil hisoblanadi. */
const normalize = (text: string) => text.toUpperCase().replace(/[^A-Z]/g, '');

export default function ClearHistorySettings() {
  return (
    <PinGate>
      <ClearHistoryScreen />
    </PinGate>
  );
}

function ClearHistoryScreen() {
  const { run } = useFeedback();
  const { me, withToken, syncNow } = useSync();
  const [includeCatalog, setIncludeCatalog] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmed = normalize(typed) === normalize(CONFIRM_WORD);

  const clear = async () => {
    setBusy(true);
    const done = await run(async () => {
      // Server epoch'ni oshiradi: barcha qurilmalar (shu jumladan bu) lokal bazani tozalab, qaytadan yuklaydi.
      await withToken((t) => api.resetHall(t, includeCatalog ? [...HISTORY, ...CATALOG] : HISTORY));
      await syncNow();
      return true;
    }, "Tarix o'chirildi");
    setBusy(false);
    if (done) router.back();
  };

  if (me?.user.role !== 'owner') {
    return <EmptyState icon="account-lock-outline" title="Tarixni faqat biliardxona egasi tozalay oladi" />;
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card mode="contained" style={{ backgroundColor: palette.dangerBg }}>
        <Card.Content style={styles.warn}>
          <MaterialCommunityIcons name="alert-octagon" size={48} color={palette.danger} />
          <Text variant="titleLarge" style={[styles.center, { color: palette.danger }]}>
            Diqqat! Ma'lumotlar butunlay o'chiriladi
          </Text>
          <Text variant="bodyLarge" style={styles.center}>
            Barcha cheklar, to'lovlar, qarz daftari (mijozlar va ularning qarzlari), xarajatlar, ombor harakatlari va
            ochiq stollar <Text style={styles.bold}>barcha qurilmalarda</Text> o'chiriladi. Hisobotlar bo'm-bo'sh bo'ladi.
          </Text>
          <Text variant="titleMedium" style={[styles.center, { color: palette.danger }]}>
            Bu amalni qaytarib bo'lmaydi.
          </Text>
        </Card.Content>
      </Card>

      <View style={styles.checkRow}>
        <Checkbox.Android
          status={includeCatalog ? 'checked' : 'unchecked'}
          onPress={() => setIncludeCatalog((v) => !v)}
          color={palette.danger}
        />
        <Text variant="bodyLarge" style={styles.flex} onPress={() => setIncludeCatalog((v) => !v)}>
          Stollar, mahsulotlar va xarajat turlarini ham o'chirish
        </Text>
      </View>
      <Text variant="bodySmall" style={styles.muted}>
        Belgilanmasa ular (narxlari bilan) saqlanib qoladi. Sozlamalar va PIN kod har doim saqlanadi.
      </Text>
      <Text variant="bodySmall" style={styles.muted}>
        Internet kerak. Boshqa telefonlarda yuborilmagan o'zgarishlar bo'lsa, ular ham o'chib ketadi.
      </Text>

      <TextInput
        mode="outlined"
        label={`Tasdiqlash uchun ${CONFIRM_WORD} deb yozing`}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Button
        mode="contained"
        icon="delete-forever"
        buttonColor={palette.danger}
        textColor="#FFFFFF"
        disabled={!confirmed || busy}
        loading={busy}
        onPress={clear}
        contentStyle={styles.btn}
      >
        {includeCatalog ? "Hammasini o'chirish" : "Tarixni o'chirish"}
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  warn: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  center: { textAlign: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex: { flex: 1 },
  muted: { color: palette.muted },
  bold: { fontWeight: '700' },
  btn: { paddingVertical: 6 },
});
