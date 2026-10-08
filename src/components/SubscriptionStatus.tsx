import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { SubState, SubscriptionInfo } from '../../server/src/contract';
import { useNow } from '@/hooks/useNow';
import { palette } from '@/theme';
import { formatDate } from '@/utils/time';
import { isReadOnly, useSync } from './SyncProvider';

export const STATE_LABEL: Record<SubState, string> = {
  trial: 'Sinov muddati',
  active: 'Faol',
  grace: 'Muddat tugadi (imtiyoz kunlari)',
  expired: "Faqat ko'rish rejimi",
};

export const STATE_COLOR: Record<SubState, string> = {
  trial: palette.paused,
  active: palette.income,
  grace: palette.debt,
  expired: palette.danger,
};

/** Telefon soati server vaqtidan shuncha farq qilsa ogohlantiriladi (oxirgi yozuv yutadi — soat muhim). */
const SKEW_WARN_MS = 2 * 60_000;

function bannerText(sub: SubscriptionInfo, readOnly: boolean): string | null {
  if (readOnly) return "Obuna tugagan: faqat ko'rish rejimi. Yangi o'yin va savdo boshlab bo'lmaydi — to'lov qiling.";
  if (sub.state === 'grace' && sub.graceEndsAt) {
    return `Obuna muddati tugadi. ${formatDate(sub.graceEndsAt)} gacha to'lov qilinmasa, ilova faqat ko'rish rejimiga o'tadi.`;
  }
  if ((sub.state === 'trial' || sub.state === 'active') && sub.daysLeft <= 3) {
    const what = sub.state === 'trial' ? 'Sinov muddati' : 'Obuna';
    return `${what} ${sub.daysLeft <= 1 ? 'ertaga' : `${sub.daysLeft} kundan keyin`} tugaydi.`;
  }
  return null;
}

/** Zal va Savdo tepasida: obuna tugayotgan bo'lsa yoki telefon soati noto'g'ri bo'lsa. */
export function SubscriptionBanner() {
  const { me, clockSkew } = useSync();
  const now = useNow();
  const sub = me?.subscription;
  const readOnly = isReadOnly(sub, now);
  const text = sub ? bannerText(sub, readOnly) : null;
  const skew = Math.abs(clockSkew) > SKEW_WARN_MS;
  if (!text && !skew) return null;
  return (
    <Pressable onPress={() => router.push('/settings/account')} style={[styles.banner, { backgroundColor: readOnly ? palette.dangerBg : palette.debtBg }]}>
      <MaterialCommunityIcons name={skew && !text ? 'clock-alert-outline' : 'alert-circle-outline'} size={20} color={readOnly ? palette.danger : palette.debt} />
      <Text variant="bodySmall" style={styles.text}>
        {text ?? "Telefon soati noto'g'ri. Sozlamalardan avtomatik vaqtni yoqing — aks holda sinxronlashda o'zgarishlar adashishi mumkin."}
      </Text>
      <MaterialCommunityIcons name="chevron-right" size={18} color={palette.muted} />
    </Pressable>
  );
}

/** Sarlavhadagi sinxron belgisi: ✓ sinxron, ⟳ yuborilmoqda, oflayn (N ta yuborilmagan). */
export function SyncBadge() {
  const { status, pending } = useSync();
  const icon = status === 'offline' ? 'cloud-off-outline' : status === 'error' ? 'cloud-alert' : status === 'syncing' || pending > 0 ? 'cloud-sync-outline' : 'cloud-check-outline';
  const color = status === 'offline' || status === 'error' ? palette.debt : pending > 0 ? palette.paused : palette.income;
  return (
    <Pressable onPress={() => router.push('/settings/account')} hitSlop={8} style={styles.badge} accessibilityLabel="Sinxron holati">
      <MaterialCommunityIcons name={icon} size={22} color={color} />
      {pending > 0 ? (
        <Text variant="labelSmall" style={{ color }}>
          {pending}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function SyncStatusLine() {
  const { status, pending, lastSyncAt, error } = useSync();
  const label =
    status === 'offline'
      ? "Internet yo'q — o'zgarishlar telefonda saqlanadi"
      : status === 'error'
        ? `Xatolik: ${error ?? ''}`
        : status === 'syncing'
          ? 'Sinxronlanmoqda…'
          : pending > 0
            ? `${pending} ta o'zgarish yuborilmoqda`
            : 'Barcha ma\'lumot serverda';
  return (
    <View style={styles.line}>
      <SyncBadge />
      <View style={styles.flex}>
        <Text variant="bodyMedium">{label}</Text>
        {lastSyncAt ? (
          <Text variant="bodySmall" style={{ color: palette.muted }}>
            Oxirgi sinxron: {new Date(lastSyncAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 8, padding: 10, borderRadius: 12 },
  text: { flex: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex: { flex: 1 },
});
