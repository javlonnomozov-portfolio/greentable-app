import { router, useNavigation, type Href } from 'expo-router';
import { useLayoutEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Divider, IconButton, List, Text } from 'react-native-paper';
import { BrandHeader } from '@/components/Brand';
import { usePin } from '@/components/PinProvider';
import { PinGate } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useSettings } from '@/hooks/useSettings';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatDateTime } from '@/utils/time';

const BACKUP_WARN_MS = 7 * 24 * 60 * 60_000;

export default function SettingsTab() {
  const navigation = useNavigation();
  const { hasPin, unlocked, lock } = usePin();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: hasPin && unlocked ? () => <IconButton icon="lock-outline" onPress={lock} /> : undefined,
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
  const now = useNow();
  const backupOld = settings.lastBackupAt == null || now - settings.lastBackupAt > BACKUP_WARN_MS;

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
      {backupOld && (
        <View style={styles.warn}>
          <Text variant="bodyMedium">
            Ma'lumotlar faqat shu telefonda saqlanadi. Telefon yo'qolsa yoki buzilsa hammasi yo'qoladi — zaxira nusxani
            muntazam oling.
          </Text>
        </View>
      )}
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
        {item(
          'Zaxira va sherik bilan almashish',
          settings.lastBackupAt ? `Oxirgi: ${formatDateTime(settings.lastBackupAt)}` : 'Hali olinmagan',
          'cloud-sync-outline',
          '/settings/backup',
          backupOld,
        )}
      </List.Section>
      <Divider />
      <List.Section>
        <List.Subheader>Xavfli amallar</List.Subheader>
        <List.Item
          title="Tarixni tozalash"
          titleStyle={{ color: palette.danger }}
          description="Barcha cheklar, qarzlar va xarajatlarni o'chirish"
          left={(p) => <List.Icon {...p} icon="delete-forever-outline" color={palette.danger} />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={() => router.push('/settings/clear')}
        />
      </List.Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  warn: { margin: 16, marginBottom: 0, padding: 12, borderRadius: 12, backgroundColor: palette.dangerBg },
});
