import {
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { api, type Discount, type HallDetail as Data } from '../api.ts';
import { STATE, date, dateTime, som, tgLink } from '../format.ts';

const EVENT: Record<Data['events'][number]['kind'], string> = {
  trial: 'Sinov boshlandi',
  trial_extend: 'Sinov uzaytirildi',
  payment: "To'lov (chek)",
  charge: 'Kunlik yechim',
  adjust: 'Balans qo‘lda',
  discount: 'Chegirma',
};

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={5}>{title}</Title>
        {right}
      </Group>
      {children}
    </Card>
  );
}

/** Test yoki keraksiz biliardxonani butunlay o'chirish: nomini yozib tasdiqlanadi. */
function DeleteHall({ id, name }: { id: string; name: string }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [resetTrial, setResetTrial] = useState(true);
  const del = useMutation({
    mutationFn: () => api(`/halls/${id}`, { method: 'DELETE', body: { resetTrial } }),
    onSuccess: () => {
      notifications.show({ message: `«${name}» o'chirildi`, color: 'emerald' });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      navigate('/halls');
    },
    onError: (e) => notifications.show({ message: e.message, color: 'red' }),
  });
  return (
    <>
      <Card withBorder style={{ borderColor: 'var(--mantine-color-red-9)' }}>
        <Group justify="space-between">
          <div>
            <Title order={5} c="red.5">Biliardxonani o'chirish</Title>
            <Text size="sm" c="dimmed">Qurilmalar, cheklar, sinxron ma'lumot va tarix butunlay o'chadi. Qaytarib bo'lmaydi.</Text>
          </div>
          <Button color="red" variant="light" onClick={() => setOpen(true)}>
            O'chirish
          </Button>
        </Group>
      </Card>
      <Modal opened={open} onClose={() => setOpen(false)} title="Biliardxonani o'chirish">
        <Stack>
          <Text size="sm">
            Tasdiqlash uchun nomini yozing: <b>{name}</b>
          </Text>
          <TextInput value={typed} onChange={(e) => setTyped(e.currentTarget.value)} />
          <Checkbox
            label="Egasining sinov huquqini qaytarish (qayta ro'yxatdan o'tsa yana bepul sinov oladi)"
            checked={resetTrial}
            onChange={(e) => setResetTrial(e.currentTarget.checked)}
          />
          <Button color="red" disabled={typed.trim() !== name.trim()} loading={del.isPending} onClick={() => del.mutate()}>
            Butunlay o'chirish
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

export function HallDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['hall', id], queryFn: () => api<Data>(`/halls/${id}`) });
  const discounts = useQuery({ queryKey: ['discounts'], queryFn: () => api<Discount[]>('/discounts') });
  const [amount, setAmount] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [trialDays, setTrialDays] = useState<number | ''>(7);
  const [attach, setAttach] = useState<string | null>(null);
  const [showCharges, setShowCharges] = useState(false);
  const [personal, setPersonal] = useState<{ mode: 'percent' | 'amount'; value: number | ''; days: number | ''; note: string }>({
    mode: 'percent',
    value: 20,
    days: 30,
    note: '',
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['hall', id] });
    qc.invalidateQueries({ queryKey: ['halls'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      notifications.show({ message: 'Saqlandi', color: 'emerald' });
      refresh();
    },
    onError: (e) => notifications.show({ message: e.message, color: 'red' }),
  });

  if (!data) return <Loader />;
  const { hall, subscription: sub } = data;
  const charges = data.events.filter((e) => e.kind === 'charge');
  const chargedSum = charges.reduce((s, e) => s + (e.amount ?? 0), 0);

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Title order={2}>{hall.name}</Title>
          <Badge color={STATE[sub.state].color} size="lg">{STATE[sub.state].label}</Badge>
        </Group>
        <Switch
          label="Bloklangan"
          color="red"
          checked={hall.blocked}
          onChange={(e) => {
            const blocked = e.currentTarget.checked;
            act.mutate(() => api(`/halls/${id}`, { method: 'PATCH', body: { blocked } }));
          }}
        />
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Section title="Balans">
            <Stack gap={4}>
              <Text size="xl" fw={700} c={hall.balance < 0 ? 'red.5' : 'emerald.5'}>
                {som(hall.balance)}
              </Text>
              <Text>
                Kuniga <b>{som(sub.dailyPrice)}</b> · 30 kunlik narx {som(sub.price)}{' '}
                {sub.discount && <Text span c="gold.5">({sub.discount.label}{sub.discount.endsAt ? `, ${date(sub.discount.endsAt)} gacha` : ''})</Text>}
              </Text>
              {sub.state === 'grace' || sub.state === 'expired' ? (
                <Text size="sm" c="red.4">Balans {date(hall.debtSince)} dan minusda · imtiyoz {date(sub.graceEndsAt)} gacha</Text>
              ) : (
                <Text size="sm">
                  Pul taxminan <b>{sub.endsAt ? date(sub.endsAt) : 'muddatsiz'}</b> gacha yetadi{sub.endsAt ? ` (${sub.daysLeft} kun)` : ''}
                </Text>
              )}
              <Text size="sm" c="dimmed">
                Sinov: {date(hall.trialEndsAt)} · yechilgan: {hall.paidThrough ? `${dateTime(hall.paidThrough)} gacha` : 'hali boshlanmagan'}
              </Text>
            </Stack>
            <Group align="flex-end" mt="md">
              <NumberInput
                label="Balansga qo'shish (− ayirish)"
                value={amount}
                onChange={(v) => setAmount(v === '' ? '' : Number(v))}
                thousandSeparator=" "
                suffix=" so'm"
                step={10_000}
                w={200}
              />
              <TextInput label="Izoh" placeholder="naqd to'lov, bonus…" value={note} onChange={(e) => setNote(e.currentTarget.value)} style={{ flex: 1 }} />
              <Button disabled={!amount} onClick={() => act.mutate(() => api(`/halls/${id}/balance`, { body: { amount: Number(amount), note: note || undefined } }))}>
                Saqlash
              </Button>
            </Group>
            <Group align="flex-end" mt="sm">
              <NumberInput label="Sinovni uzaytirish (kun)" value={trialDays} onChange={(v) => setTrialDays(v === '' ? '' : Number(v))} min={1} w={200} />
              <Button variant="light" disabled={!trialDays} onClick={() => act.mutate(() => api(`/halls/${id}/trial`, { body: { days: Number(trialDays), note: note || undefined } }))}>
                Uzaytirish
              </Button>
            </Group>
          </Section>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Section
            title={`Qurilmalar (${data.devices.length} / ${data.deviceLimit})`}
            right={
              <NumberInput
                size="xs"
                w={150}
                placeholder="umumiy limit"
                min={1}
                value={hall.deviceLimit ?? ''}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  const deviceLimit = v ? Number(v) : null;
                  if (deviceLimit !== hall.deviceLimit) act.mutate(() => api(`/halls/${id}`, { method: 'PATCH', body: { deviceLimit } }));
                }}
              />
            }
          >
            {data.devices.length === 0 ? (
              <Text c="dimmed" size="sm">Ulangan qurilma yo'q</Text>
            ) : (
              data.devices.map((d) => (
                <Group key={d.id} justify="space-between" py={4}>
                  <div>
                    <Text size="sm">{d.model ?? 'Telefon'} — {d.userName}</Text>
                    <Text size="xs" c="dimmed">oxirgi faollik {dateTime(d.lastSeenAt)}</Text>
                  </div>
                  <Button size="xs" variant="subtle" color="red" onClick={() => act.mutate(() => api(`/halls/${id}/devices/${d.id}`, { method: 'DELETE' }))}>
                    O'chirish
                  </Button>
                </Group>
              ))
            )}
          </Section>
          <Section title="A'zolar">
            {data.members.map((m) => (
              <Group key={m.id} justify="space-between" py={2}>
                <Text size="sm">
                  <Anchor href={tgLink(m)} target="_blank">{m.name}</Anchor> {m.phone && <Anchor href={`tel:${m.phone}`} size="xs">{m.phone}</Anchor>}
                </Text>
                <Badge variant="light" color={m.role === 'owner' ? 'gold' : 'gray'}>{m.role === 'owner' ? 'egasi' : 'admin'}</Badge>
              </Group>
            ))}
          </Section>
        </Grid.Col>
      </Grid>

      <Section
        title="Chegirmalar"
        right={
          <Group gap="xs">
            <Select
              size="xs"
              placeholder="Chegirma tanlang"
              value={attach}
              onChange={setAttach}
              data={(discounts.data ?? [])
                .filter((d) => d.kind === 'promo' || d.kind === 'campaign')
                .map((d) => ({
                  value: String(d.id),
                  label: `${d.kind === 'promo' ? d.code : 'Kampaniya'} ${d.percent != null ? `−${d.percent}%` : `−${som(d.amount)}`}`,
                }))}
            />
            <Button size="xs" disabled={!attach} onClick={() => act.mutate(() => api(`/halls/${id}/discounts`, { body: { discountId: Number(attach) } }))}>
              Biriktirish
            </Button>
          </Group>
        }
      >
        {data.globalDiscount && (
          <Text size="sm" c="gold.5" mb={4}>
            Hammaga aksiya amal qilmoqda: {data.globalDiscount}
          </Text>
        )}
        <Group align="flex-end" mb="sm" gap="xs">
          <SegmentedControl
            size="xs"
            value={personal.mode}
            onChange={(v) => setPersonal({ ...personal, mode: v as 'percent' | 'amount' })}
            data={[
              { value: 'percent', label: '%' },
              { value: 'amount', label: "so'm" },
            ]}
          />
          <NumberInput size="xs" label="Shaxsiy chegirma" value={personal.value} onChange={(v) => setPersonal({ ...personal, value: v === '' ? '' : Number(v) })} min={1} w={130} thousandSeparator=" " />
          <NumberInput size="xs" label="Necha kun (bo'sh — cheksiz)" value={personal.days} onChange={(v) => setPersonal({ ...personal, days: v === '' ? '' : Number(v) })} min={1} w={170} />
          <TextInput size="xs" label="Izoh" value={personal.note} onChange={(e) => setPersonal({ ...personal, note: e.currentTarget.value })} />
          <Button
            size="xs"
            disabled={!personal.value}
            onClick={() =>
              act.mutate(() =>
                api(`/halls/${id}/personal-discount`, {
                  body: {
                    percent: personal.mode === 'percent' ? Number(personal.value) : null,
                    amount: personal.mode === 'amount' ? Number(personal.value) : null,
                    days: personal.days === '' ? null : Number(personal.days),
                    note: personal.note || null,
                  },
                }),
              )
            }
          >
            Berish
          </Button>
        </Group>
        {data.discounts.length === 0 ? (
          <Text c="dimmed" size="sm">Biriktirilgan chegirma yo'q</Text>
        ) : (
          data.discounts.map((d) => {
            const live = !d.endsAt || new Date(d.endsAt) > new Date();
            return (
              <Group key={d.id} justify="space-between" py={2}>
                <Text size="sm" c={live ? undefined : 'dimmed'}>
                  {d.kind === 'personal' ? 'Shaxsiy ' : ''}
                  {d.label} · {date(d.startsAt)} – {d.endsAt ? date(d.endsAt) : 'cheksiz'}
                  {d.note ? ` · ${d.note}` : ''}
                </Text>
                {live && (
                  <Button size="xs" variant="subtle" color="red" onClick={() => act.mutate(() => api(`/hall-discounts/${d.id}`, { method: 'DELETE' }))}>
                    To'xtatish
                  </Button>
                )}
              </Group>
            );
          })
        )}
      </Section>

      <DeleteHall id={id} name={hall.name} />

      <Section
        title="Tarix"
        right={<Switch size="xs" label={`Kunlik yechimlar (${charges.length} kun, ${som(chargedSum)})`} checked={showCharges} onChange={(e) => setShowCharges(e.currentTarget.checked)} />}
      >
        <Table.ScrollContainer minWidth={640}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Vaqt</Table.Th>
                <Table.Th>Amal</Table.Th>
                <Table.Th>Summa</Table.Th>
                <Table.Th>Balans</Table.Th>
                <Table.Th>Izoh</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.events
                .filter((e) => showCharges || e.kind !== 'charge')
                .map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>{dateTime(e.kind === 'charge' && e.fromDate ? e.fromDate : e.createdAt)}</Table.Td>
                    <Table.Td>{EVENT[e.kind]}</Table.Td>
                    <Table.Td c={e.kind === 'charge' || (e.amount ?? 0) < 0 ? 'red.4' : undefined}>
                      {e.amount != null ? `${e.kind === 'charge' ? '−' : e.amount > 0 && e.kind !== 'payment' ? '+' : ''}${som(e.amount)}` : ''}
                      {e.days != null ? `${e.days} kun` : ''}
                    </Table.Td>
                    <Table.Td>{e.balanceAfter != null ? som(e.balanceAfter) : e.toDate ? `→ ${date(e.toDate)}` : ''}</Table.Td>
                    <Table.Td>{e.note}</Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Section>
    </Stack>
  );
}
