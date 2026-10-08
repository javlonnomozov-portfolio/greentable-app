import { Button, Center, Paper, PinInput, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { api } from '../api.ts';

export function Login({ onDone }: { onDone(): void }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center h="100vh" p="md">
      <Paper withBorder p="xl" w={380} maw="100%">
        <Stack>
          <Title order={3}>
            <Text span inherit c="emerald.6">GREEN</Text>TABLE admin
          </Title>
          {!sent ? (
            <>
              <Text c="dimmed" size="sm">Kirish kodi Telegram bot orqali admin akkauntingizga yuboriladi.</Text>
              <Button loading={busy} onClick={() => run(async () => { await api('/auth/request', { body: {} }); setSent(true); })}>
                Kodni olish
              </Button>
            </>
          ) : (
            <>
              <Text c="dimmed" size="sm">Telegram'ga kelgan 6 xonali kodni kiriting.</Text>
              <PinInput
                length={6}
                type="number"
                oneTimeCode
                value={code}
                onChange={setCode}
                onComplete={(v) => run(async () => { await api('/auth/verify', { body: { code: v } }); onDone(); })}
              />
              <Button
                loading={busy}
                disabled={code.length !== 6}
                onClick={() => run(async () => { await api('/auth/verify', { body: { code } }); onDone(); })}
              >
                Kirish
              </Button>
              <Button variant="subtle" size="xs" onClick={() => run(async () => { await api('/auth/request', { body: {} }); })}>
                Kodni qayta yuborish
              </Button>
            </>
          )}
          {error && <Text c="red" size="sm">{error}</Text>}
        </Stack>
      </Paper>
    </Center>
  );
}
