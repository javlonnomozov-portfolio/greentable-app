import { router, useNavigation, type Href } from 'expo-router';
import { useLayoutEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { Divider, IconButton, List } from 'react-native-paper';
import { BrandHeader } from '@/components/Brand';
import { usePin } from '@/components/PinProvider';
import { STATE_LABEL, SyncBadge } from '@/components/SubscriptionStatus';
import { isReadOnly, useSync } from '@/components/SyncProvider';
import { PinGate } from '@/components/ui';
import { useSettings } from '@/hooks/useSettings';
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
        {item('Stollar', "Nomi va soatlik narxi", 'billiards', '/settings/tables')}
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
