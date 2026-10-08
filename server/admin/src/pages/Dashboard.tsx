import { Anchor, Badge, Card, Group, Loader, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { api, type Dashboard as Data } from '../api.ts';
import { STATE, date, som } from '../format.ts';

function Stat({ label, value, color, onClick }: { label: string; value: string | number; color?: string; onClick?(): void }) {
  return (
    <Card withBorder onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="xl" fw={700} c={color}>{value}</Text>
    </Card>
  );
}

export function Dashboard() {
  const [, navigate] = useLocation();
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Data>('/dashboard') });
  if (!data) return <Loader />;
  return (
    <Stack>
      <Title order={2}>Bosh sahifa</Title>
      <SimpleGrid cols={{ base: 2, md: 3, lg: 6 }}>
        <Stat label="Biliardxonalar" value={data.total} onClick={() => navigate('/halls')} />
        <Stat label="Faol" value={data.counts.active} color="emerald.6" />
        <Stat label="Sinovda" value={data.counts.trial} color="blue.4" />
        <Stat label="Imtiyozda" value={data.counts.grace} color="yellow.5" />
        <Stat label="Tugagan" value={data.counts.expired} color="red.5" />
        <Stat label="Kutilayotgan cheklar" value={data.pendingReceipts} color="gold.5" onClick={() => navigate('/receipts')} />
      </SimpleGrid>
      <Card withBorder>
        <Text size="sm" c="dimmed">Shu oy tushumi</Text>
        <Text size="xl" fw={700}>{som(data.monthRevenue)}</Text>
        <Text size="sm" c="dimmed">{data.monthPayments} ta to'lov · mijozlar balansida jami {som(data.totalBalance)}</Text>
      </Card>
      <Title order={4}>Muddati tugayotganlar</Title>
      {data.soon.length === 0 ? (
        <Text c="dimmed">Yo'q</Text>
      ) : (
        <Table.ScrollContainer minWidth={600}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Biliardxona</Table.Th>
                <Table.Th>Holat</Table.Th>
                <Table.Th>Pul yetadi</Table.Th>
                <Table.Th>Egasi</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.soon.map((h) => (
                <Table.Tr key={h.id} onClick={() => navigate(`/halls/${h.id}`)} style={{ cursor: 'pointer' }}>
                  <Table.Td>{h.name}</Table.Td>
                  <Table.Td>
                    <Badge color={STATE[h.state].color}>{STATE[h.state].label}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6}>
                      {date(h.endsAt)}
                      <Text size="xs" c="dimmed">({h.daysLeft} kun)</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {h.owner.name} {h.owner.phone && <Anchor href={`tel:${h.owner.phone}`} size="sm">{h.owner.phone}</Anchor>}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
