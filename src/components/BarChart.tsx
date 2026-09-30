import { StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import type { DailyPoint } from '@/services/reports';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';

const HEIGHT = 120;

/** Kunlik tushum ustunlari. Tashqi kutubxonasiz, oddiy View'lar bilan chiziladi. */
export function BarChart({ points }: { points: DailyPoint[] }) {
  const theme = useTheme();
  const max = Math.max(1, ...points.map((p) => p.total));
  const best = points.reduce((a, b) => (b.total > a.total ? b : a), points[0]);
  // Ko'p kunli davrda har bir yorliq sig'maydi — har n-kunni ko'rsatamiz.
  const labelEvery = points.length > 16 ? 5 : points.length > 8 ? 2 : 1;
  return (
    <View>
      {best && best.total > 0 && (
        <Text variant="bodySmall" style={{ color: palette.muted }}>
          Eng yaxshi kun: {best.label}-sana, {formatSom(best.total)}
        </Text>
      )}
      <View style={[styles.chart, { height: HEIGHT }]}>
        {points.map((p) => (
          <View key={p.dayStart} style={styles.col}>
            <View
              style={[
                styles.bar,
                {
                  height: Math.max(p.total > 0 ? 3 : 1, (p.total / max) * HEIGHT),
                  backgroundColor: p.total > 0 ? theme.colors.primary : theme.colors.surfaceVariant,
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.labels}>
        {points.map((p, i) => (
          <Text key={p.dayStart} style={styles.label} numberOfLines={1}>
            {i % labelEvery === 0 ? p.label : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, marginTop: 8 },
  col: { flex: 1, justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  labels: { flexDirection: 'row', gap: 2, marginTop: 2 },
  label: { flex: 1, fontSize: 10, textAlign: 'center', color: palette.muted },
});
