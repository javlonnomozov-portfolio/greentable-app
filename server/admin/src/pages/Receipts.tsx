import {
  Anchor,
  Badge,
  Button,
  Card,
  Chip,
  Grid,
  Group,
  Image,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { api, type Quote, type Receipt, type ReceiptStatus } from '../api.ts';
import { STATE, date, dateTime, som, tgLink } from '../format.ts';

const REASONS = ["Summa ko'rinmayapti", "To'lov kelib tushmagan", 'Boshqa kartaga o‘tkazilgan', 'Chek takrorlangan'];

export function Receipts() {
  const [status, setStatus] = useState<ReceiptStatus>('pending');
  const { data } = useQuery({
    queryKey: ['receipts', status],
    queryFn: () => api<Receipt[]>(`/receipts?status=${status}`),
    refetchInterval: status === 'pending' ? 20_000 : false,
  });
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Cheklar</Title>
        <SegmentedControl
          value={status}
          onChange={(v) => setStatus(v as ReceiptStatus)}
          data={[
            { value: 'pending', label: 'Kutilmoqda' },
            { value: 'approved', label: 'Tasdiqlangan' },
            { value: 'rejected', label: 'Rad etilgan' },
          ]}
        />
      </Group>
      {!data ? (
        <Loader />
      ) : data.length === 0 ? (
        <Text c="dimmed">Chek yo'q</Text>
      ) : status === 'pending' ? (
        data.map((r) => <PendingReceipt key={r.id} r={r} />)
      ) : (
        <History rows={data} />
      )}
    </Stack>
  );
}

function ReceiptFile({ r, h }: { r: Pick<Receipt, 'id' | 'fileKind' | 'mimeType'>; h: number }) {
  const url = `/admin/api/receipts/${r.id}/file`;
  const isImage = r.fileKind === 'photo' || r.mimeType?.startsWith('image/');
  return isImage ? (
    <Anchor href={url} target="_blank">
      <Image src={url} h={h} fit="contain" radius="md" bg="dark.8" alt={`Chek ${r.id}`} />
    </Anchor>
  ) : (
    <Button component="a" href={url} target="_blank" variant="light">
      Faylni ochish ({r.mimeType ?? 'hujjat'})
    </Button>
  );
}

function PendingReceipt({ r }: { r: Receipt }) {
  const qc = useQueryClient();
  const sub = r.subscription!;
  const [amount, setAmount] = useState<number | ''>('');
  const [days, setDays] = useState<number | ''>('');
  const [daysTouched, setDaysTouched] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [debAmount] = useDebouncedValue(amount, 300);

  const quote = useQuery({
    queryKey: ['quote', r.id, debAmount, daysTouched ? days : null],
    queryFn: () => api<Quote>(`/receipts/${r.id}/quote`, { body: { amount: Number(debAmount) || 0, days: daysTouched && days ? days : undefined } }),
    enabled: debAmount !== '',
  });
  useEffect(() => {
    if (!daysTouched && quote.data) setDays(quote.data.days);
  }, [quote.data, daysTouched]);

  const done = (msg: string) => {
    notifications.show({ message: msg, color: 'emerald' });
    qc.invalidateQueries({ queryKey: ['receipts'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const approve = useMutation({
    mutationFn: () => api(`/receipts/${r.id}/approve`, { body: { amount: Number(amount), days: Number(days) } }),
    onSuccess: () => done(`Chek №${r.id} tasdiqlandi`),
    onError: (e) => notifications.show({ message: e.message, color: 'red' }),
  });
  const reject = useMutation({
    mutationFn: () => api(`/receipts/${r.id}/reject`, { body: { reason } }),
    onSuccess: () => done(`Chek №${r.id} rad etildi`),
    onError: (e) => notifications.show({ message: e.message, color: 'red' }),
  });

  return (
    <Card withBorder>
      <Grid>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <ReceiptFile r={r} h={420} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="xs">
            <Group justify="space-between">
              <Title order={4}>Chek №{r.id}</Title>
              <Text size="sm" c="dimmed">{dateTime(r.createdAt)}</Text>
            </Group>
            <Text>
              🏢 <Anchor component={Link} href={`/halls/${r.hall.id}`}>{r.hall.name}</Anchor>
            </Text>
            <Text size="sm">
              👤 <Anchor href={tgLink(r.user)} target="_blank">{r.user.name}</Anchor>
              {r.user.username && ` @${r.user.username}`} {r.user.phone && <Anchor href={`tel:${r.user.phone}`}>{r.user.phone}</Anchor>}
            </Text>
            {r.caption && <Text size="sm">💬 {r.caption}</Text>}
            <Group gap="xs">
              <Badge color={STATE[sub.state].color}>{STATE[sub.state].label}</Badge>
              <Text size="sm">
                {sub.endsAt ? `${date(sub.endsAt)} gacha` : 'muddat yo‘q'} · narx {som(sub.price)}/oy
                {sub.discount && <Text span c="gold.5"> ({sub.discount.label})</Text>}
              </Text>
            </Group>

            <Group align="flex-end" mt="sm">
              <NumberInput
                label="To'langan summa"
                value={amount}
                onChange={(v) => setAmount(v === '' ? '' : Number(v))}
                thousandSeparator=" "
                suffix=" so'm"
                min={0}
                step={10_000}
                w={200}
                autoFocus
              />
              <NumberInput
                label="Qo'shiladigan kunlar"
                value={days}
                onChange={(v) => {
                  setDaysTouched(true);
                  setDays(v === '' ? '' : Number(v));
                }}
                min={1}
                w={170}
              />
            </Group>
            {quote.data && amount !== '' && (
              <Text size="sm" c="dimmed">
                {som(Number(amount))} ÷ {som(quote.data.price)}/oy × 30 = <b>{quote.data.days} kun</b> → yangi muddat{' '}
                <Text span c="emerald.5" fw={700}>{date(quote.data.paidUntil)} gacha</Text>
              </Text>
            )}
            <Group mt="sm">
              <Button onClick={() => approve.mutate()} loading={approve.isPending} disabled={amount === '' || !days}>
                Tasdiqlash
              </Button>
              <Button variant="light" color="red" onClick={() => setRejecting(true)}>
                Rad etish
              </Button>
            </Group>
          </Stack>
        </Grid.Col>
      </Grid>

      <Modal opened={rejecting} onClose={() => setRejecting(false)} title={`Chek №${r.id} ni rad etish`}>
        <Stack>
          <Chip.Group value={reason} onChange={(v) => setReason(String(v))}>
            <Group gap="xs">
              {REASONS.map((x) => (
                <Chip key={x} value={x} size="sm">{x}</Chip>
              ))}
            </Group>
          </Chip.Group>
          <Textarea label="Sabab (mijozga yuboriladi)" value={reason} onChange={(e) => setReason(e.currentTarget.value)} autosize minRows={2} />
          <Button color="red" loading={reject.isPending} onClick={() => reject.mutate()}>
            Rad etish va xabar yuborish
          </Button>
        </Stack>
      </Modal>
    </Card>
  );
}

function History({ rows }: { rows: Receipt[] }) {
  const [open, setOpen] = useState<Receipt | null>(null);
  return (
    <>
      <Table.ScrollContainer minWidth={760}>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>№</Table.Th>
              <Table.Th>Biliardxona</Table.Th>
              <Table.Th>Yuborgan</Table.Th>
              <Table.Th>Summa</Table.Th>
              <Table.Th>Kun</Table.Th>
              <Table.Th>Ko'rib chiqilgan</Table.Th>
              <Table.Th>Izoh</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id} onClick={() => setOpen(r)} style={{ cursor: 'pointer' }}>
                <Table.Td>{r.id}</Table.Td>
                <Table.Td>{r.hall.name}</Table.Td>
                <Table.Td>{r.user.name}</Table.Td>
                <Table.Td>{som(r.amount)}</Table.Td>
                <Table.Td>{r.daysAdded ?? '—'}</Table.Td>
                <Table.Td>{dateTime(r.reviewedAt)}</Table.Td>
                <Table.Td>{r.rejectReason ?? (r.priceAtReview ? `narx ${som(r.priceAtReview)}/oy` : '')}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Modal opened={!!open} onClose={() => setOpen(null)} title={open ? `Chek №${open.id}` : ''} size="lg">
        {open && <ReceiptFile r={open} h={600} />}
      </Modal>
    </>
  );
}
