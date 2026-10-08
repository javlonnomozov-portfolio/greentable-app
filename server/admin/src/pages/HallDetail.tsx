import {
  Anchor,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  NumberInput,
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
import { api, type Discount, type HallDetail as Data } from '../api.ts';
import { STATE, date, dateInputToIso, dateTime, isoToDateInput, som, tgLink } from '../format.ts';

const EVENT: Record<Data['events'][number]['kind'], string> = {
  trial: 'Sinov',
  payment: "To'lov",
  extend: "Qo'lda uzaytirish",
  set: 'Sana qo‘yildi',
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

export function HallDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['hall', id], queryFn: () => api<Data>(`/halls/${id}`) });
  const discounts = useQuery({ queryKey: ['discounts'], queryFn: () => api<Discount[]>('/discounts') });
  const [days, setDays] = useState<number | ''>(30);
  const [note, setNote] = useState('');
  const [setTo, setSetTo] = useState('');
  const [attach, setAttach] = useState<string | null>(null);

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
          <Section title="Obuna">
            <Stack gap={4}>
              <Text>Muddat: <b>{sub.endsAt ? date(sub.endsAt) : '—'}</b> ({sub.daysLeft} kun)</Text>
              {sub.graceEndsAt && <Text size="sm" c="dimmed">Imtiyoz: {date(sub.graceEndsAt)} gacha</Text>}
              <Text size="sm" c="dimmed">Sinov: {date(hall.trialEndsAt)} · To'langan: {date(hall.paidUntil)}</Text>
              <Text>
                Narx: <b>{som(sub.price)}</b>/oy {sub.discount && <Text span c="gold.5">({sub.discount.label}{sub.discount.endsAt ? `, ${date(sub.discount.endsAt)} gacha` : ''})</Text>}
              </Text>
            </Stack>
            <Group align="flex-end" mt="md">
              <NumberInput label="Kun qo'shish (− ayirish)" value={days} onChange={(v) => setDays(v === '' ? '' : Number(v))} w={170} />
              <TextInput label="Izoh" value={note} onChange={(e) => setNote(e.currentTarget.value)} style={{ flex: 1 }} />
              <Button
                disabled={!days}
                onClick={() => act.mutate(() => api(`/halls/${id}/subscription`, { body: { days: Number(days), note: note || undefined } }))}
              >
                Qo'shish
              </Button>
            </Group>
            <Group align="flex-end" mt="sm">
              <TextInput label="To'langan muddatni qo'yish" type="date" value={setTo || isoToDateInput(hall.paidUntil)} onChange={(e) => setSetTo(e.currentTarget.value)} />
              <Button
                variant="light"
                disabled={!setTo}
                onClick={() => act.mutate(() => api(`/halls/${id}/subscription`, { body: { paidUntil: dateInputToIso(setTo, true), note: note || undefined } }))}
              >
                Qo'yish
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
              data={(discounts.data ?? []).map((d) => ({
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
        {data.discounts.length === 0 ? (
          <Text c="dimmed" size="sm">Yo'q</Text>
        ) : (
          data.discounts.map((d) => {
            const live = !d.endsAt || new Date(d.endsAt) > new Date();
            return (
              <Group key={d.id} justify="space-between" py={2}>
                <Text size="sm" c={live ? undefined : 'dimmed'}>
                  {d.label} · {date(d.startsAt)} – {d.endsAt ? date(d.endsAt) : 'cheksiz'}
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

      <Section title="Tarix">
        <Table.ScrollContainer minWidth={600}>
          <Table>
            <Table.Tbody>
              {data.events.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>{dateTime(e.createdAt)}</Table.Td>
                  <Table.Td>{EVENT[e.kind]}</Table.Td>
                  <Table.Td>{e.amount != null ? som(e.amount) : ''}</Table.Td>
                  <Table.Td>{e.days != null ? `${e.days} kun` : ''}</Table.Td>
                  <Table.Td>{e.toDate ? `→ ${date(e.toDate)}` : ''}</Table.Td>
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
