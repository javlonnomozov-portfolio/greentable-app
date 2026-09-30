import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, Text, TextInput } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { AmountInput, MethodPicker, SectionTitle } from '@/components/ui';
import type { PaymentMethod } from '@/db/models';
import { useDb, useQuery } from '@/db/hooks';
import { listExpenseCategories } from '@/services/catalog';
import { addExpense } from '@/services/expenses';

/** Xarajat qo'shish kassirga ham ochiq: kassadan chiqqan pul darhol yozilishi kerak. */
export default function NewExpenseScreen() {
  const db = useDb();
  const { run } = useFeedback();
  const { data: categories = [] } = useQuery((d) => listExpenseCategories(d), []);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');

  const save = async () => {
    const id = await run(() => addExpense(db, { categoryId, amount, method, note, now: Date.now() }), 'Xarajat yozildi');
    if (id) router.back();
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <AmountInput label="Summa" value={amount} onChange={setAmount} autoFocus />
      <SectionTitle>Turi</SectionTitle>
      <View style={styles.chips}>
        {categories.map((c) => (
          <Chip key={c.id} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)}>
            {c.name}
          </Chip>
        ))}
      </View>
      <SectionTitle>Qayerdan to'landi</SectionTitle>
      <MethodPicker value={method} onChange={setMethod} />
      <TextInput mode="outlined" label="Izoh (masalan: 20 ta Coca-Cola)" value={note} onChangeText={setNote} />
      <Button mode="contained" icon="check" onPress={save} disabled={amount <= 0} contentStyle={styles.btn}>
        Saqlash
      </Button>
      {categoryId == null && (
        <Text variant="bodySmall" style={styles.hint}>
          Turini tanlamasangiz «Boshqa» sifatida hisoblanadi
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: { paddingVertical: 6 },
  hint: { textAlign: 'center', opacity: 0.7 },
});
