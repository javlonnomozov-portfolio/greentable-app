import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Checkbox, Text, TextInput } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { PinGate } from '@/components/ui';
import { useDb } from '@/db/hooks';
import { clearHistory } from '@/services/backup';
import { palette } from '@/theme';

const CONFIRM_WORD = "O'CHIRISH";

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
  const db = useDb();
  const { run } = useFeedback();
  const [includeCatalog, setIncludeCatalog] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmed = normalize(typed) === normalize(CONFIRM_WORD);

  const clear = async () => {
    setBusy(true);
    const done = await run(async () => {
      await clearHistory(db, { includeCatalog });
      return true;
    }, "Tarix o'chirildi");
    setBusy(false);
    if (done) router.back();
  };

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
            ochiq stollar o'chiriladi. Hisobotlar bo'm-bo'sh bo'ladi.
          </Text>
          <Text variant="titleMedium" style={[styles.center, { color: palette.danger }]}>
            Bu amalni qaytarib bo'lmaydi.
          </Text>
        </Card.Content>
      </Card>

      <Button mode="contained-tonal" icon="cloud-upload-outline" onPress={() => router.push('/settings/backup')}>
        Avval zaxira oling
      </Button>

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
        Eslatma: keyin sherigingizning telefonidan zaxira qo'shsangiz, uning telefonidagi ma'lumotlar bu yerga qaytib keladi.
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
  btn: { paddingVertical: 6 },
});
