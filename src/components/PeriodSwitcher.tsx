import { StyleSheet, View } from 'react-native';
import { IconButton, SegmentedButtons, Text } from 'react-native-paper';
import type { Period, PeriodKind } from '@/services/reports';

interface Props {
  kind: PeriodKind;
  offset: number;
  period: Period;
  onChange(kind: PeriodKind, offset: number): void;
}

export function PeriodSwitcher({ kind, offset, period, onChange }: Props) {
  return (
    <View style={styles.root}>
      <SegmentedButtons
        value={kind}
        onValueChange={(k) => onChange(k as PeriodKind, 0)}
        buttons={[
          { value: 'day', label: 'Kun' },
          { value: 'week', label: 'Hafta' },
          { value: 'month', label: 'Oy' },
        ]}
      />
      <View style={styles.nav}>
        <IconButton icon="chevron-left" onPress={() => onChange(kind, offset - 1)} />
        <Text variant="titleMedium" style={styles.label}>
          {period.label}
        </Text>
        <IconButton icon="chevron-right" disabled={offset >= 0} onPress={() => onChange(kind, offset + 1)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 4 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { flex: 1, textAlign: 'center', fontWeight: '600' },
});
