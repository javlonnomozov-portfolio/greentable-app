import { router, useNavigation, type Href } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import { AppState, Linking, ScrollView, View } from 'react-native';
import { Divider, IconButton, List, Switch } from 'react-native-paper';
import { BrandHeader } from '@/components/Brand';
import { usePin } from '@/components/PinProvider';
import { STATE_LABEL, SyncBadge } from '@/components/SubscriptionStatus';
import { isReadOnly, useSync } from '@/components/SyncProvider';
import { notificationPermission, requestNotificationPermission } from '@/components/TimerAlerts';
import { PinGate } from '@/components/ui';
import { useDb, useQuery } from '@/db/hooks';
import { useSettings } from '@/hooks/useSettings';
import { getTimerSound, setTimerSound } from '@/services/timerAlerts';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatDate } from '@/utils/time';

export default function SettingsTab() {
  const navigation = useNavigation();
  const { hasPin, unlocked, lock } = usePin();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <SyncBadge />
          {hasPin && unlocked ? <IconButton icon="lock-outline" onPress={lock} /> : null}
        </View>
      ),
    });
  }, [navigation, hasPin, unlocked, lock]);

  return (
    <PinGate>
      <SettingsMenu />
    </PinGate>
  );
}

function SettingsMenu() {
  const settings = useSettings();
  const { hasPin } = usePin();
  const { me } = useSync();
  const sub = me?.subscription;
  const until = sub?.endsAt && (sub.state === 'trial' || sub.state === 'active') ? ` · ${formatDate(sub.endsAt)} gacha` : '';

  const item = (title: string, description: string, icon: string, href: Href, warn = false) => (
    <List.Item
      title={title}
      description={description}
      descriptionStyle={warn ? { color: palette.danger } : undefined}
      left={(p) => <List.Icon {...p} icon={icon} color={warn ? palette.danger : p.color} />}
      right={(p) => <List.Icon {...p} icon="chevron-right" />}
      onPress={() => router.push(href)}
    />
  );

  return (
    <ScrollView>
      <BrandHeader />
      <List.Section>
        {item(
          me?.hall.name ?? 'Hisob va obuna',
          sub ? `${STATE_LABEL[sub.state]}${until}` : 'Obuna, qurilmalar, sherik',
          'account-circle-outline',
          '/settings/account',
          isReadOnly(sub) || sub?.state === 'grace',
        )}
      </List.Section>
      <Divider />
      <List.Section>
        <List.Subheader>Zal</List.Subheader>
        {item('Stollar', 'Biliard, PlayStation, kompyuter — nomi va narxi', 'billiards', '/settings/tables')}
        {item('Mahsulotlar', 'Bar/kafe, narxlar va ombor', 'cup-outline', '/settings/products')}
        {item('Xarajat turlari', 'Ijara, maosh, kommunal…', 'shape-outline', '/settings/expense-categories')}
      </List.Section>
      <Divider />
      <List.Section>
        <List.Subheader>Hisob-kitob</List.Subheader>
        {item(
          'Yaxlitlash va ish kuni',
          `${settings.rounding.step ? `${formatSom(settings.rounding.step)} gacha` : "Yaxlitlanmaydi"} · kun ${settings.dayStartHour}:00 da boshlanadi`,
          'calculator-variant-outline',
          '/settings/general',
        )}
      </List.Section>
      <Divider />
      <TimerSoundItem />
      <Divider />
      <List.Section>
        <List.Subheader>Xavfsizlik</List.Subheader>
        {item('PIN kod', hasPin ? "O'rnatilgan" : "O'rnatilmagan — hamma bo'lim ochiq", 'dialpad', '/settings/pin', !hasPin)}
      </List.Section>
      {me?.user.role === 'owner' ? (
        <>
          <Divider />
          <List.Section>
            <List.Subheader>Xavfli amallar</List.Subheader>
            <List.Item
              title="Tarixni tozalash"
              titleStyle={{ color: palette.danger }}
              description="Barcha qurilmalarda cheklar, qarzlar va xarajatlarni o'chirish"
              left={(p) => <List.Icon {...p} icon="delete-forever-outline" color={palette.danger} />}
              right={(p) => <List.Icon {...p} icon="chevron-right" />}
              onPress={() => router.push('/settings/clear')}
            />
          </List.Section>
        </>
      ) : null}
    </ScrollView>
  );
}

/** Har bir telefonda alohida: vaqtli seans tugaganda ovozli bildirishnoma. */
function TimerSoundItem() {
  const db = useDb();
  const { data: on } = useQuery((d) => getTimerSound(d), []);
  const [perm, setPerm] = useState<{ granted: boolean; canAskAgain: boolean } | null>(null);

  // Telefon sozlamalaridan qaytganda ruxsat holati yangilanadi.
  useEffect(() => {
    const check = () => notificationPermission().then(setPerm, () => setPerm(null));
    check();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && check());
    return () => sub.remove();
  }, []);

  const noPerm = on !== false && perm != null && !perm.granted;
  const fixPerm = async () => {
    if (perm?.canAskAgain) setPerm({ granted: await requestNotificationPermission(), canAskAgain: true });
    else Linking.openSettings();
  };

  return (
    <List.Section>
      <List.Subheader>Shu telefon</List.Subheader>
      <List.Item
        title="Vaqt tugaganda ovoz"
        description={
          noPerm
            ? 'Bildirishnomaga ruxsat berilmagan — bosing'
            : 'Vaqtli seans (PS, kompyuter) tugashiga 5 daqiqa qolganda va tugaganda'
        }
        descriptionStyle={noPerm ? { color: palette.danger } : undefined}
        descriptionNumberOfLines={3}
        left={(p) => <List.Icon {...p} icon="bell-ring-outline" color={noPerm ? palette.danger : p.color} />}
        right={() => <Switch value={on !== false} onValueChange={(v) => setTimerSound(db, v)} />}
        onPress={noPerm ? fixPerm : () => setTimerSound(db, on === false)}
      />
    </List.Section>
  );
}
