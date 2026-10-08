import { AppShell, Badge, Burger, Center, Group, Loader, NavLink, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Route, Router, Switch, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { api, setUnauthorizedHandler, type Dashboard as DashboardData } from './api.ts';
import { Dashboard } from './pages/Dashboard.tsx';
import { Discounts } from './pages/Discounts.tsx';
import { HallDetail } from './pages/HallDetail.tsx';
import { Halls } from './pages/Halls.tsx';
import { Login } from './pages/Login.tsx';
import { PricingPage } from './pages/Pricing.tsx';
import { Receipts } from './pages/Receipts.tsx';

export function App() {
  const qc = useQueryClient();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    api('/auth/me')
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null)
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return (
    <Router hook={useHashLocation}>
      <Shell
        onLogout={async () => {
          await api('/auth/logout', { method: 'POST', body: {} });
          qc.clear();
          setAuthed(false);
        }}
      />
    </Router>
  );
}

function Shell({ onLogout }: { onLogout(): void }) {
  const [opened, { toggle, close }] = useDisclosure();
  const [location, navigate] = useLocation();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/dashboard'), refetchInterval: 30_000 });

  const link = (href: string, label: string, badge?: number) => (
    <NavLink
      key={href}
      label={label}
      active={href === '/' ? location === '/' : location.startsWith(href)}
      onClick={() => {
        navigate(href);
        close();
      }}
      rightSection={badge ? <Badge color="gold" size="sm" circle>{badge}</Badge> : undefined}
    />
  );

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Text fw={800} size="lg" c="emerald.6">
            GREEN<Text span inherit c="white">TABLE</Text>
          </Text>
          <Text c="dimmed" size="sm">admin</Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {link('/', 'Bosh sahifa')}
        {link('/receipts', 'Cheklar', dash.data?.pendingReceipts)}
        {link('/halls', 'Biliardxonalar')}
        {link('/pricing', 'Narxlar')}
        {link('/discounts', 'Chegirmalar')}
        <NavLink label="Chiqish" onClick={onLogout} mt="auto" c="dimmed" />
      </AppShell.Navbar>
      <AppShell.Main>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/receipts" component={Receipts} />
          <Route path="/halls" component={Halls} />
          <Route path="/halls/:id">{(p) => <HallDetail id={p.id} />}</Route>
          <Route path="/pricing" component={PricingPage} />
          <Route path="/discounts" component={Discounts} />
          <Route>Sahifa topilmadi</Route>
        </Switch>
      </AppShell.Main>
    </AppShell>
  );
}
