import {
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Discount } from '../api.ts';
import { date, dateInputToIso, isoToDateInput, som } from '../format.ts';

interface Form {
  kind: 'promo' | 'campaign';
  code: string;
  mode: 'percent' | 'amount';
  value: number | '';
  validFrom: string;
  validTo: string;
  benefitMonths: number | '';
  maxUses: number | '';
  newOnly: boolean;
  active: boolean;
  note: string;
}

const empty: Form = {
  kind: 'promo',
  code: '',
  mode: 'percent',
  value: 20,
  validFrom: '',
  validTo: '',
  benefitMonths: 3,
  maxUses: '',
  newOnly: false,
  active: true,
  note: '',
};

const toForm = (d: Discount): Form => ({
  kind: d.kind,
  code: d.code ?? '',
  mode: d.percent != null ? 'percent' : 'amount',
  value: d.percent ?? d.amount ?? '',
  validFrom: isoToDateInput(d.validFrom),
  validTo: isoToDateInput(d.validTo),
  benefitMonths: d.benefitMonths ?? '',
  maxUses: d.maxUses ?? '',
  newOnly: d.newOnly,
  active: d.active,
  note: d.note ?? '',
});

const toBody = (f: Form) => ({
  kind: f.kind,
  code: f.kind === 'promo' ? f.code.trim() || null : null,
  percent: f.mode === 'percent' && f.value !== '' ? f.value : null,
  amount: f.mode === 'amount' && f.value !== '' ? f.value : null,
  validFrom: dateInputToIso(f.validFrom),
  validTo: dateInputToIso(f.validTo, true),
  benefitMonths: f.benefitMonths === '' ? null : f.benefitMonths,
  maxUses: f.maxUses === '' ? null : f.maxUses,
  newOnly: f.newOnly,
  active: f.active,
  note: f.note.trim() || null,
});

const value = (d: Discount) => (d.percent != null ? `−${d.percent}%` : `−${som(d.amount)}`);

function windowText(d: Discount) {
  if (!d.validFrom && !d.validTo) return 'doimiy';
  return `${d.validFrom ? date(d.validFrom) : '…'} – ${d.validTo ? date(d.validTo) : '…'}`;
}

export function Discounts() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['discounts'], queryFn: () => api<Discount[]>('/discounts') });
  const [editing, setEditing] = useState<{ id: number | null; form: Form } | null>(null);

  const save = useMutation({
    mutationFn: ({ id, form }: { id: number | null; form: Form }) =>
      id ? api(`/discounts/${id}`, { method: 'PATCH', body: toBody(form) }) : api('/discounts', { body: toBody(form) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['discounts'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      setEditing(null);
      notifications.show({ message: 'Chegirma saqlandi', color: 'emerald' });
    },
    onError: (e) => notifications.show({ message: e.message, color: 'red' }),
  });

  const f = editing?.form;
  const set = (patch: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Chegirmalar</Title>
        <Button onClick={() => setEditing({ id: null, form: empty })}>Yangi chegirma</Button>
      </Group>
      <Text size="sm" c="dimmed">
        <b>Promo kod</b> — mijoz botda «🎟 Promo kod» orqali kiritadi. <b>Kampaniya</b> — ko'rsatilgan oraliqda ro'yxatdan o'tgan har bir
        yangi biliardxonaga avtomatik beriladi. Bir nechta chegirma bo'lsa, eng kattasi amal qiladi.
      </Text>
      {!data ? (
        <Loader />
      ) : (
        <Table.ScrollContainer minWidth={820}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Turi</Table.Th>
                <Table.Th>Chegirma</Table.Th>
                <Table.Th>Amal qilish oynasi</Table.Th>
                <Table.Th>Muddati</Table.Th>
                <Table.Th>Ishlatilgan</Table.Th>
                <Table.Th>Holat</Table.Th>
                <Table.Th>Izoh</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((d) => (
                <Table.Tr key={d.id} onClick={() => setEditing({ id: d.id, form: toForm(d) })} style={{ cursor: 'pointer' }}>
                  <Table.Td>{d.kind === 'promo' ? <Badge color="gold" variant="light">{d.code}</Badge> : <Badge variant="light">Kampaniya</Badge>}</Table.Td>
                  <Table.Td fw={700}>{value(d)}</Table.Td>
                  <Table.Td>{windowText(d)}</Table.Td>
                  <Table.Td>{d.benefitMonths ? `${d.benefitMonths} oy` : 'cheksiz'}</Table.Td>
                  <Table.Td>
                    {d.usedCount}
                    {d.maxUses ? ` / ${d.maxUses}` : ''}
                  </Table.Td>
                  <Table.Td>
                    {d.active ? <Badge color="emerald">faol</Badge> : <Badge color="gray">o'chirilgan</Badge>}
                    {d.newOnly && <Badge color="blue" variant="light" ml={4}>yangilar</Badge>}
                  </Table.Td>
                  <Table.Td>{d.note}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal opened={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Chegirmani tahrirlash' : 'Yangi chegirma'} size="lg">
        {f && (
          <Stack>
            <SegmentedControl
              value={f.kind}
              onChange={(v) => set({ kind: v as Form['kind'] })}
              data={[
                { value: 'promo', label: 'Promo kod' },
                { value: 'campaign', label: 'Kampaniya (avtomatik)' },
              ]}
            />
            {f.kind === 'promo' && (
              <TextInput label="Promo kod" placeholder="YANGI20" value={f.code} onChange={(e) => set({ code: e.currentTarget.value.toUpperCase() })} />
            )}
            <Group align="flex-end">
              <SegmentedControl
                value={f.mode}
                onChange={(v) => set({ mode: v as Form['mode'] })}
                data={[
                  { value: 'percent', label: 'Foiz' },
                  { value: 'amount', label: "Summa (so'm)" },
                ]}
              />
              <NumberInput
                label={f.mode === 'percent' ? 'Chegirma, %' : "Chegirma, so'm"}
                value={f.value}
                onChange={(v) => set({ value: v === '' ? '' : Number(v) })}
                min={1}
                max={f.mode === 'percent' ? 100 : undefined}
                thousandSeparator={f.mode === 'amount' ? ' ' : undefined}
                w={180}
              />
            </Group>
            <SimpleGrid cols={2}>
              <TextInput
                type="date"
                label={f.kind === 'promo' ? 'Kod qachondan' : "Ro'yxatdan o'tish qachondan"}
                value={f.validFrom}
                onChange={(e) => set({ validFrom: e.currentTarget.value })}
              />
              <TextInput
                type="date"
                label={f.kind === 'promo' ? 'Kod qachongacha' : "Ro'yxatdan o'tish qachongacha"}
                value={f.validTo}
                onChange={(e) => set({ validTo: e.currentTarget.value })}
              />
              <NumberInput
                label="Chegirma muddati (oy)"
                description="Biriktirilgandan keyin. Bo'sh — cheksiz"
                value={f.benefitMonths}
                onChange={(v) => set({ benefitMonths: v === '' ? '' : Number(v) })}
                min={1}
              />
              <NumberInput
                label="Necha marta ishlatiladi"
                description="Bo'sh — cheksiz"
                value={f.maxUses}
                onChange={(v) => set({ maxUses: v === '' ? '' : Number(v) })}
                min={1}
              />
            </SimpleGrid>
            <Switch label="Faqat hali to'lov qilmaganlar uchun" checked={f.newOnly} onChange={(e) => set({ newOnly: e.currentTarget.checked })} />
            <Switch label="Faol" checked={f.active} onChange={(e) => set({ active: e.currentTarget.checked })} />
            <TextInput label="Izoh (faqat sizga ko'rinadi)" value={f.note} onChange={(e) => set({ note: e.currentTarget.value })} />
            <Button loading={save.isPending} onClick={() => save.mutate({ id: editing!.id, form: f })}>
              Saqlash
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
