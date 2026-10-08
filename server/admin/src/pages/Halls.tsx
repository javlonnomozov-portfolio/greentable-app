import { Badge, Group, Loader, SegmentedControl, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import type { SubState } from '../../../src/contract.ts';
import { api, type HallRow } from '../api.ts';
import { STATE, date, dateTime, som } from '../format.ts';

export function Halls() {
  const [, navigate] = useLocation();
  const [q, setQ] = useState('');
  const [state, setState] = useState<'all' | SubState>('all');
  const { data } = useQuery({ queryKey: ['halls'], queryFn: () => api<HallRow[]>('/halls') });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter(
      (h) =>
        (state === 'all' || h.state === state) &&
        (!s || [h.name, h.owner.name, h.owner.phone, h.owner.username].some((x) => x?.toLowerCase().includes(s))),
    );
  }, [data, q, state]);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Biliardxonalar</Title>
        <Group>
          <TextInput placeholder="Nom, egasi, telefon" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
          <SegmentedControl
            value={state}
            onChange={(v) => setState(v as typeof state)}
            data={[
              { value: 'all', label: 'Hammasi' },
              { value: 'trial', label: 'Sinov' },
              { value: 'active', label: 'Faol' },
              { value: 'grace', label: 'Imtiyoz' },
              { value: 'expired', label: 'Tugagan' },
            ]}
          />
        </Group>
      </Group>
      {!data ? (
        <Loader />
      ) : (
        <Table.ScrollContainer minWidth={900}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Biliardxona</Table.Th>
                <Table.Th>Egasi</Table.Th>
                <Table.Th>Holat</Table.Th>
                <Table.Th>Muddat</Table.Th>
                <Table.Th>Narx</Table.Th>
                <Table.Th>Qurilmalar</Table.Th>
                <Table.Th>Oxirgi faollik</Table.Th>
                <Table.Th>Ochilgan</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((h) => (
                <Table.Tr key={h.id} onClick={() => navigate(`/halls/${h.id}`)} style={{ cursor: 'pointer' }}>
                  <Table.Td>
                    {h.name} {h.blocked && <Badge color="red" size="xs">bloklangan</Badge>}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{h.owner.name}</Text>
                    <Text size="xs" c="dimmed">{h.owner.phone ?? (h.owner.username ? `@${h.owner.username}` : '')}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={STATE[h.state].color}>{STATE[h.state].label}</Badge>
                  </Table.Td>
                  <Table.Td>
                    {date(h.endsAt)} <Text span size="xs" c="dimmed">({h.daysLeft} kun)</Text>
                  </Table.Td>
                  <Table.Td>
                    {som(h.price)}
                    {h.discount && <Text size="xs" c="gold.5">{h.discount}</Text>}
                  </Table.Td>
                  <Table.Td>
                    {h.devices} / {h.deviceLimit}
                  </Table.Td>
                  <Table.Td>{dateTime(h.lastSeenAt)}</Table.Td>
                  <Table.Td>{date(h.createdAt)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
