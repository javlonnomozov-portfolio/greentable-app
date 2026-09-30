import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import type { RoundingSettings } from '@/services/billing';
import { calcElapsedMs, calcTimeCharge } from '@/services/billing';
import type { HallTable } from '@/services/bills';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatDuration } from '@/utils/time';

interface Props {
  table: HallTable;
  now: number;
  rounding: RoundingSettings;
  onPress(): void;
}

export function TableCard({ table, now, rounding, onPress }: Props) {
  const busy = table.bill_id != null;
  const paused = busy && table.paused_at != null;
  const color = !busy ? palette.free : paused ? palette.paused : palette.busy;
  const bg = !busy ? palette.freeBg : paused ? palette.pausedBg : palette.busyBg;

  let body;
  if (busy && table.started_at != null) {
    const timer = { ...table, started_at: table.started_at, hourly_rate: table.bill_rate ?? table.hourly_rate };
    const elapsed = calcElapsedMs(timer, now);
    const charge = calcTimeCharge(timer, now, rounding);
    const who = table.customer_name ?? table.label;
    body = (
      <>
        <Text variant="headlineMedium" style={[styles.timer, { color: palette.timer, opacity: paused ? 0.6 : 1 }]}>
          {formatDuration(elapsed)}
        </Text>
        <Text variant="titleMedium" style={styles.bold}>
          {formatSom(charge.amount + table.items_amount)}
        </Text>
        {table.items_amount > 0 && (
          <Text variant="bodySmall" style={styles.muted}>
            shundan bar: {formatSom(table.items_amount)}
          </Text>
        )}
        {who ? (
          <Text variant="bodySmall" numberOfLines={1} style={styles.muted}>
            <MaterialCommunityIcons name="account" size={12} /> {who}
          </Text>
        ) : null}
      </>
    );
  } else {
    body = (
      <>
        <MaterialCommunityIcons name="play-circle-outline" size={40} color={palette.busy} style={styles.play} />
        <Text variant="bodyMedium" style={styles.muted}>
          {formatSom(table.hourly_rate)} / soat
        </Text>
      </>
    );
  }

  return (
    // O'ynalayotgan stol logodagidek zumrad nur bilan ajralib turadi.
    <View style={[styles.glowWrap, busy && { boxShadow: paused ? GLOW_PAUSED : GLOW_BUSY }]}>
      <TouchableRipple
        onPress={onPress}
        style={[styles.card, { backgroundColor: bg, borderColor: busy ? color : palette.border }]}
        borderless
      >
        <View>
          <View style={styles.header}>
            <Text variant="titleMedium" numberOfLines={1} style={[styles.bold, styles.name]}>
              {table.name}
            </Text>
            {/* Holat belgisi: rangli matn, shu rangning xira foni. */}
            <View style={[styles.status, { backgroundColor: `${color}26`, borderColor: `${color}66` }]}>
              <Text style={[styles.statusText, { color }]}>{!busy ? "Bo'sh" : paused ? 'Pauza' : 'Band'}</Text>
            </View>
          </View>
          <View style={styles.body}>{body}</View>
        </View>
      </TouchableRipple>
    </View>
  );
}

const GLOW_BUSY = '0 0 18px rgba(0, 200, 83, 0.35)';
const GLOW_PAUSED = '0 0 14px rgba(212, 175, 55, 0.25)';

const styles = StyleSheet.create({
  glowWrap: { borderRadius: 18 },
  card: { borderRadius: 18, borderWidth: 1.5, padding: 12, minHeight: 150 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flexShrink: 1 },
  status: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  body: { marginTop: 8, alignItems: 'flex-start', gap: 2 },
  timer: { fontVariant: ['tabular-nums'], fontWeight: '700' },
  bold: { fontWeight: '700' },
  muted: { color: palette.muted },
  play: { marginVertical: 8 },
});
