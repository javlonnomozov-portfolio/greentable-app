import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import type { RoundingSettings } from '@/services/billing';
import { WARN_BEFORE_MS, calcElapsedMs, calcTimeCharge, remainingMs } from '@/services/billing';
import type { HallTable } from '@/services/bills';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatDuration, formatMinutes } from '@/utils/time';
import { kindIcon } from './tableKinds';

interface Props {
  table: HallTable;
  now: number;
  rounding: RoundingSettings;
  onPress(): void;
}

export function TableCard({ table, now, rounding, onPress }: Props) {
  const busy = table.bill_id != null;
  const paused = busy && table.paused_at != null;
  const timer =
    busy && table.started_at != null
      ? { ...table, started_at: table.started_at, hourly_rate: table.bill_rate ?? table.hourly_rate }
      : null;
  // Vaqtli seans: oxirgi 5 daqiqada oltin, tugagach qizil.
  const remaining = timer ? remainingMs(timer, now) : null;
  const over = remaining != null && remaining <= 0;
  const soon = remaining != null && !over && remaining <= WARN_BEFORE_MS;
  const color = !busy ? palette.free : over ? palette.danger : paused || soon ? palette.paused : palette.busy;
  const bg = !busy ? palette.freeBg : over ? palette.dangerBg : paused ? palette.pausedBg : palette.busyBg;
  const glow = !busy ? undefined : over ? GLOW_OVER : paused || soon ? GLOW_PAUSED : GLOW_BUSY;
  const status = !busy ? "Bo'sh" : over ? 'Tugadi' : paused ? 'Pauza' : 'Band';

  let body;
  if (timer) {
    const elapsed = calcElapsedMs(timer, now);
    const charge = calcTimeCharge(timer, now, rounding);
    const who = table.customer_name ?? table.label;
    const shown = remaining == null ? formatDuration(elapsed) : over ? `+${formatDuration(-remaining)}` : formatDuration(remaining);
    body = (
      <>
        <Text
          variant="headlineMedium"
          style={[styles.timer, { color: over ? palette.danger : palette.timer, opacity: paused ? 0.6 : 1 }]}
        >
          {shown}
        </Text>
        {table.planned_minutes != null ? (
          <Text variant="bodySmall" style={{ color: over ? palette.danger : palette.muted }}>
            <MaterialCommunityIcons name={over ? 'bell-ring-outline' : 'timer-sand'} size={12} />{' '}
            {over ? 'vaqt tugadi' : 'qoldi'} · {formatMinutes(table.planned_minutes)}
          </Text>
        ) : null}
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
    <View style={[styles.glowWrap, glow != null && { boxShadow: glow }]}>
      <TouchableRipple
        onPress={onPress}
        style={[styles.card, { backgroundColor: bg, borderColor: busy ? color : palette.border }]}
        borderless
      >
        <View>
          <View style={styles.header}>
            <View style={styles.nameRow}>
              <MaterialCommunityIcons name={kindIcon(table.kind)} size={18} color={busy ? color : palette.muted} />
              <Text variant="titleMedium" numberOfLines={1} style={[styles.bold, styles.name]}>
                {table.name}
              </Text>
            </View>
            {/* Holat belgisi: rangli matn, shu rangning xira foni. */}
            <View style={[styles.status, { backgroundColor: `${color}26`, borderColor: `${color}66` }]}>
              <Text style={[styles.statusText, { color }]}>{status}</Text>
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
const GLOW_OVER = '0 0 18px rgba(255, 90, 95, 0.4)';

const styles = StyleSheet.create({
  glowWrap: { borderRadius: 18 },
  card: { borderRadius: 18, borderWidth: 1.5, padding: 12, minHeight: 150 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  name: { flexShrink: 1 },
  status: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  body: { marginTop: 8, alignItems: 'flex-start', gap: 2 },
  timer: { fontVariant: ['tabular-nums'], fontWeight: '700' },
  bold: { fontWeight: '700' },
  muted: { color: palette.muted },
  play: { marginVertical: 8 },
});
