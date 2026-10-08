import { Button, Card, Group, Loader, NumberInput, SimpleGrid, Stack, Text, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Pricing } from '../api.ts';

export function PricingPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['pricing'], queryFn: () => api<Pricing>('/pricing') });
  const [form, setForm] = useState<Pricing | null>(null);
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);
  const save = useMutation({
    mutationFn: (p: Pricing) => api<Pricing>('/pricing', { method: 'PUT', body: p }),
    onSuccess: (p) => {
      qc.setQueryData(['pricing'], p);
      qc.invalidateQueries({ queryKey: ['halls'] });
      notifications.show({ message: 'Narxlar saqlandi', color: 'emerald' });
    },
    onError: (e) => notifications.show({ message: e.message, color: 'red' }),
  });
  if (!form) return <Loader />;
  const num = (key: 'monthlyPrice' | 'trialDays' | 'graceDays' | 'defaultDeviceLimit') => (v: string | number) =>
    setForm({ ...form, [key]: Number(v) || 0 });

  return (
    <Stack maw={760}>
      <Title order={2}>Narxlar va sozlamalar</Title>
      <Card withBorder>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput label="30 kunlik narx" description={`Chegirmasiz. Har kuni balansdan ${Math.round(form.monthlyPrice / 30).toLocaleString('ru-RU')} so'm yechiladi`} value={form.monthlyPrice} onChange={num('monthlyPrice')} thousandSeparator=" " suffix=" so'm" min={0} step={10_000} />
          <NumberInput label="Qurilma limiti" description="Biliardxona sahifasida alohida o'zgartirish mumkin" value={form.defaultDeviceLimit} onChange={num('defaultDeviceLimit')} min={1} />
          <NumberInput label="Bepul sinov (kun)" description="Birinchi marta ro'yxatdan o'tganlarga. 0 — sinov yo'q" value={form.trialDays} onChange={num('trialDays')} min={0} />
          <NumberInput label="Imtiyoz kunlari" description="Balans tugagach (minusga ketib) faqat-ko'rish rejimigacha" value={form.graceDays} onChange={num('graceDays')} min={0} />
        </SimpleGrid>
      </Card>
      <Card withBorder>
        <Stack>
          <Textarea
            label="To'lov rekvizitlari (botda chiqadi)"
            description="Masalan: karta raqami, qabul qiluvchi ismi, izoh"
            placeholder={'Karta: 8600 1234 5678 9012\nQabul qiluvchi: Ism Familiya'}
            autosize
            minRows={3}
            value={form.paymentText}
            onChange={(e) => setForm({ ...form, paymentText: e.currentTarget.value })}
          />
          <Textarea
            label="Yordam matni (botdagi «Yordam» tugmasi)"
            placeholder="Savollar uchun: @username yoki +998 …"
            autosize
            minRows={2}
            value={form.supportText}
            onChange={(e) => setForm({ ...form, supportText: e.currentTarget.value })}
          />
        </Stack>
      </Card>
      <Group>
        <Button onClick={() => save.mutate(form)} loading={save.isPending}>Saqlash</Button>
        <Text size="sm" c="dimmed">O'zgarish yangi to'lovlar va narx hisoblariga darhol ta'sir qiladi.</Text>
      </Group>
    </Stack>
  );
}
