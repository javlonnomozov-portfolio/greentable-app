import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { PinPad } from '@/components/PinPad';
import { usePin } from '@/components/PinProvider';
import { PinGate } from '@/components/ui';
import { palette } from '@/theme';

export default function PinSettings() {
  return (
    <PinGate>
      <PinEditor />
    </PinGate>
  );
}

function PinEditor() {
  const { hasPin, savePin, removePin } = usePin();
  const { run, confirm } = useFeedback();
  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onChange = async (next: string) => {
    setValue(next);
    setError(null);
    if (next.length < 4) return;
    if (first == null) {
      setFirst(next);
      setValue('');
      return;
    }
    if (next !== first) {
      setFirst(null);
      setValue('');
      setError('PINlar mos kelmadi, qaytadan kiriting');
      return;
    }
    const done = await run(async () => {
      await savePin(next);
      return true;
    }, "PIN o'rnatildi");
    if (done) router.back();
  };

  const remove = async () => {
    const ok = await confirm({
      title: "PINni o'chirish?",
      message: "Hisobot, sozlamalar va cheklarni bekor qilish hamma uchun ochiq bo'lib qoladi.",
      confirmLabel: "O'chirish",
      destructive: true,
    });
    if (!ok) return;
    await run(removePin, "PIN o'chirildi");
  };

  if (editing) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <PinPad
          title={first == null ? 'Yangi 4 xonali PIN' : 'PINni takrorlang'}
          value={value}
          onChange={onChange}
          error={error}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text variant="bodyLarge" style={styles.text}>
        PIN o'rnatilsa Kassa (hisobot), Sozlamalar, chekni bekor qilish va yozuvlarni o'chirish faqat PIN bilan ochiladi.
        Zal, savdo va qarz daftari kassir uchun ochiq qoladi.
      </Text>
      <Text variant="bodyMedium" style={[styles.text, { color: palette.muted }]}>
        PINni unutmang: uni tiklashning yagona yo'li ilova ma'lumotlarini o'chirib, zaxiradan qayta tiklash.
      </Text>
      <Button mode="contained" icon="dialpad" onPress={() => setEditing(true)}>
        {hasPin ? "PINni o'zgartirish" : "PIN o'rnatish"}
      </Button>
      {hasPin && (
        <Button textColor={palette.danger} onPress={remove}>
          PINni o'chirish
        </Button>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 16 },
  text: { textAlign: 'center' },
});
