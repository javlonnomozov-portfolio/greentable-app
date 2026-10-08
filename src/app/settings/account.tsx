import { useEffect, useState } from 'react';
import { Linking, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Button, Card, Divider, List, Text } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { STATE_COLOR, STATE_LABEL, SyncStatusLine } from '@/components/SubscriptionStatus';
import { useSync } from '@/components/SyncProvider';
import { api } from '@/sync/api';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatDate, formatDateTime } from '@/utils/time';

/** Biliardxona, obuna holati, sinxron, qurilmalar, sherik taklifi va chiqish. */
export default function AccountScreen() {
  const { me, refreshMe, syncNow, logout, withToken, status } = useSync();
  const { run, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  if (!me) return null;
  const sub = me.subscription;
  const owner = me.user.role === 'owner';
  const bot = (start?: string) => Linking.openURL(`https://t.me/${me.botUsername}${start ? `?start=${start}` : ''}`);

  const invite = async () => {
    const res = await run(() => withToken((t) => api.invite(t)));
    if (res) {
      await Share.share({
        message: `GreenTable: «${me.hall.name}» biliardxonasiga qo'shiling. Havolani oching va telefon raqamingizni yuboring:\n${res.url}`,
      });
    }
  };

  const removeDevice = async (id: string, label: string) => {
    if (!(await confirm({ title: 'Qurilmani o‘chirish?', message: `${label} — bu telefondan qayta kirish kerak bo'ladi.`, confirmLabel: "O'chirish", destructive: true }))) return;
    await run(async () => {
      await withToken((t) => api.revokeDevice(t, id));
      await refreshMe();
    }, "Qurilma o'chirildi");
  };

  const signOut = async () => {
    const ok = await confirm({
      title: 'Chiqish?',
      message: "Ma'lumotlar shu telefonda qoladi. Qayta kirish uchun Telegram kerak bo'ladi.",
      confirmLabel: 'Chiqish',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    await logout();
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card mode="contained">
        <Card.Title title={me.hall.name} subtitle={`${me.user.name} · ${owner ? 'egasi' : 'admin'}`} />
      </Card>

      <Card mode="contained">
        <Card.Content style={styles.gap}>
          <Text variant="titleMedium">Obuna</Text>
          <Text variant="titleLarge" style={{ color: STATE_COLOR[sub.state], fontWeight: '700' }}>
            {STATE_LABEL[sub.state]}
          </Text>
          <Text variant="headlineSmall" style={[styles.bold, { color: sub.balance < 0 ? palette.danger : palette.income }]}>
            Balans: {formatSom(sub.balance)}
          </Text>
          <Text variant="bodyLarge">
            Kuniga <Text style={styles.bold}>{formatSom(sub.dailyPrice)}</Text> yechiladi
            <Text style={styles.muted}> (30 kun — {formatSom(sub.price)})</Text>
            {sub.discount ? (
              <Text style={{ color: palette.timer }}>
                {' '}
                {sub.discount.label}
                {sub.discount.endsAt ? `, ${formatDate(sub.discount.endsAt)} gacha` : ''}
              </Text>
            ) : null}
          </Text>
          {(sub.state === 'trial' || sub.state === 'active') && sub.endsAt ? (
            <Text variant="bodyLarge">
              Pul taxminan <Text style={styles.bold}>{formatDate(sub.endsAt)}</Text> gacha yetadi ({Math.max(0, sub.daysLeft)} kun)
            </Text>
          ) : null}
          {sub.state === 'grace' && sub.graceEndsAt ? (
            <Text variant="bodyMedium" style={{ color: palette.debt }}>
              Balans tugadi. {formatDate(sub.graceEndsAt)} gacha to'lov qilinmasa, ilova faqat ko'rish rejimiga o'tadi.
            </Text>
          ) : null}
          <Text variant="bodySmall" style={styles.muted}>
            To'lov chekini Telegram botga yuborasiz — tasdiqlangach summa balansga tushadi.
          </Text>
          <View style={styles.row}>
            <Button mode="contained" icon="credit-card-outline" onPress={() => bot('pay')} style={styles.flex}>
              To'lash
            </Button>
            <Button mode="outlined" icon="ticket-percent-outline" onPress={() => bot()} style={styles.flex}>
              Promo kod
            </Button>
          </View>
        </Card.Content>
      </Card>

      <Card mode="contained">
        <Card.Content style={styles.gap}>
          <Text variant="titleMedium">Sinxronlash</Text>
          <SyncStatusLine />
          <Button icon="sync" onPress={() => syncNow()} loading={status === 'syncing'} disabled={status === 'syncing'}>
            Hozir sinxronlash
          </Button>
        </Card.Content>
      </Card>

      <Card mode="contained">
        <Card.Title title={`Qurilmalar (${me.devices.length} / ${me.hall.deviceLimit})`} />
        {me.devices.map((d, i) => {
          const label = `${d.model ?? 'Telefon'} — ${d.userName}`;
          return (
            <View key={d.id}>
              {i > 0 && <Divider />}
              <List.Item
                title={d.current ? `${label} (shu telefon)` : label}
                description={d.lastSeenAt ? `Oxirgi faollik: ${formatDateTime(d.lastSeenAt)}` : undefined}
                left={(p) => <List.Icon {...p} icon="cellphone" />}
                right={owner && !d.current ? () => <Button textColor={palette.danger} onPress={() => removeDevice(d.id, label)}>O'chirish</Button> : undefined}
              />
            </View>
          );
        })}
        {owner ? (
          <Card.Actions>
            <Button icon="account-plus-outline" onPress={invite}>
              Sherik qo'shish
            </Button>
          </Card.Actions>
        ) : null}
      </Card>

      <Button icon="logout" textColor={palette.danger} onPress={signOut} loading={busy} disabled={busy}>
        Chiqish
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  gap: { gap: 8 },
  row: { flexDirection: 'row', gap: 8, marginTop: 4 },
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  muted: { color: palette.muted },
});
