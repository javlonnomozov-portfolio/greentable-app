import {
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  MultiSelect,
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
import { api, type Audience, type Discount, type HallRow } from '../api.ts';
import { date, dateInputToIso, isoToDateInput, som } from '../format.ts';

type EditableKind = 'promo' | 'campaign' | 'global';

interface Form {
  kind: EditableKind;
  code: string;
  mode: 'percent' | 'amount';
  value: number | '';
  validFrom: string;
  validTo: string;
  benefitDays: number | '';
  audience: Audience;
  hallIds: string[];
  maxUses: number | '';
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
  benefitDays: 90,
  audience: 'all',
  hallIds: [],
  maxUses: '',
  active: true,
  note: '',
};

const toForm = (d: Discount): Form => ({
  kind: d.kind === 'personal' ? 'promo' : d.kind,
  code: d.code ?? '',
  mode: d.percent != null ? 'percent' : 'amount',
  value: d.percent ?? d.amount ?? '',
  validFrom: isoToDateInput(d.validFrom),
  validTo: isoToDateInput(d.validTo),
  benefitDays: d.benefitDays ?? '',
  audience: d.audience,
  hallIds: d.targets.map((t) => t.hallId),
  maxUses: d.maxUses ?? '',
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
  benefitDays: f.kind === 'global' || f.benefitDays === '' ? null : f.benefitDays,
  audience: f.audience,
  hallIds: f.audience === 'selected' ? f.hallIds : [],
  maxUses: f.kind === 'global' || f.maxUses === '' ? null : f.maxUses,
  active: f.active,
  note: f.note.trim() || null,
});

const KIND: Record<Discount['kind'], { label: string; color: string }> = {
  promo: { label: 'Promo kod', color: 'gold' },
  campaign: { label: 'Yangilarga', color: 'blue' },
  global: { label: 'Hammaga', color: 'emerald' },
  personal: { label: 'Shaxsiy', color: 'grape' },
};

const AUDIENCE: Record<Audience, string> = { all: 'hamma', new: "hali to'lov qilmaganlar", selected: 'tanlanganlar' };

const value = (d: Discount) => (d.percent != null ? `−${d.percent}%` : `−${som(d.amount)}`);

function windowText(d: Discount) {
  if (!d.validFrom && !d.validTo) return 'doimiy';
  return `${d.validFrom ? date(d.validFrom) : '…'} – ${d.validTo ? date(d.validTo) : '…'}`;
}

export function Discounts() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['discounts'], queryFn: () => api<Discount[]>('/discounts') });
  const halls = useQuery({ queryKey: ['halls'], queryFn: () => api<HallRow[]>('/halls') });
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
  const list = (data ?? []).filter((d) => d.kind !== 'personal');

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Chegirmalar</Title>
        <Button onClick={() => setEditing({ id: null, form: empty })}>Yangi chegirma</Button>
      </Group>
      <Text size="sm" c="dimmed">
        <b>Promo kod</b> — mijoz botda «🎟 Promo kod» orqali kiritadi. <b>Yangilarga</b> — ko'rsatilgan oraliqda ro'yxatdan o'tgan har bir
        biliardxonaga avtomatik. <b>Hammaga</b> — oraliq davomida barcha (yoki tanlangan) biliardxonalarga birdan. Bitta biliardxonaga
        alohida chegirma — biliardxona sahifasidan. Bir nechta chegirma bo'lsa eng kattasi amal qiladi.
      </Text>
      {!data ? (
        <Loader />
      ) : (
        <Table.ScrollContainer minWidth={900}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Turi</Table.Th>
                <Table.Th>Chegirma</Table.Th>
                <Table.Th>Kimga</Table.Th>
                <Table.Th>Amal qilish oynasi</Table.Th>
                <Table.Th>Davomiyligi</Table.Th>
                <Table.Th>Ishlatilgan</Table.Th>
                <Table.Th>Holat</Table.Th>
                <Table.Th>Izoh</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((d) => (
                <Table.Tr key={d.id} onClick={() => setEditing({ id: d.id, form: toForm(d) })} style={{ cursor: 'pointer' }}>
                  <Table.Td>
                    <Badge color={KIND[d.kind].color} variant="light">{d.kind === 'promo' ? d.code : KIND[d.kind].label}</Badge>
                  </Table.Td>
                  <Table.Td fw={700}>{value(d)}</Table.Td>
                  <Table.Td>
                    {AUDIENCE[d.audience]}
                    {d.audience === 'selected' && <Text size="xs" c="dimmed">{d.targets.map((t) => t.name).join(', ')}</Text>}
                  </Table.Td>
                  <Table.Td>{windowText(d)}</Table.Td>
                  <Table.Td>{d.kind === 'global' ? 'oyna davomida' : d.benefitDays ? `${d.benefitDays} kun` : 'cheksiz'}</Table.Td>
                  <Table.Td>
                    {d.usedCount}
                    {d.maxUses ? ` / ${d.maxUses}` : ''}
                  </Table.Td>
                  <Table.Td>{d.active ? <Badge color="emerald">faol</Badge> : <Badge color="gray">o'chirilgan</Badge>}</Table.Td>
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
              onChange={(v) => set({ kind: v as EditableKind })}
              data={[
                { value: 'promo', label: 'Promo kod' },
                { value: 'campaign', label: "Yangi ro'yxatdan o'tganlarga" },
                { value: 'global', label: 'Hammaga birdan' },
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
                label={f.mode === 'percent' ? 'Chegirma, %' : "30 kunlik narxdan, so'm"}
                value={f.value}
                onChange={(v) => set({ value: v === '' ? '' : Number(v) })}
                min={1}
                max={f.mode === 'percent' ? 100 : undefined}
                thousandSeparator={f.mode === 'amount' ? ' ' : undefined}
                w={200}
              />
            </Group>
            <SegmentedControl
              value={f.audience}
              onChange={(v) => set({ audience: v as Audience })}
              data={[
                { value: 'all', label: 'Hammaga' },
                { value: 'new', label: "Hali to'lov qilmaganlarga" },
                { value: 'selected', label: 'Tanlangan biliardxonalarga' },
              ]}
            />
            {f.audience === 'selected' && (
              <MultiSelect
                label="Biliardxonalar"
                searchable
                value={f.hallIds}
                onChange={(v) => set({ hallIds: v })}
                data={(halls.data ?? []).map((h) => ({ value: h.id, label: `${h.name} — ${h.owner.name}` }))}
              />
            )}
            <SimpleGrid cols={2}>
              <TextInput
                type="date"
                label={f.kind === 'promo' ? 'Kod qachondan' : f.kind === 'campaign' ? "Ro'yxatdan o'tish qachondan" : 'Aksiya qachondan'}
                value={f.validFrom}
                onChange={(e) => set({ validFrom: e.currentTarget.value })}
              />
              <TextInput
                type="date"
                label={f.kind === 'promo' ? 'Kod qachongacha' : f.kind === 'campaign' ? "Ro'yxatdan o'tish qachongacha" : 'Aksiya qachongacha'}
                value={f.validTo}
                onChange={(e) => set({ validTo: e.currentTarget.value })}
              />
              {f.kind !== 'global' && (
                <NumberInput
                  label="Chegirma necha kun amal qiladi"
                  description="Biriktirilgandan keyin. Bo'sh — cheksiz"
                  value={f.benefitDays}
                  onChange={(v) => set({ benefitDays: v === '' ? '' : Number(v) })}
                  min={1}
                />
              )}
              {f.kind !== 'global' && (
                <NumberInput
                  label="Necha marta ishlatiladi"
                  description="Bo'sh — cheksiz"
                  value={f.maxUses}
                  onChange={(v) => set({ maxUses: v === '' ? '' : Number(v) })}
                  min={1}
                />
              )}
            </SimpleGrid>
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
