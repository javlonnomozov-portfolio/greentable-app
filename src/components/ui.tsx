import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import { Button, Chip, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';
import type { PaymentMethod } from '@/db/models';
import { palette } from '@/theme';
import { formatSom, parseSom, somInputValue } from '@/utils/money';
import { usePin } from './PinProvider';

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Naqd',
  card: 'Karta',
  transfer: "O'tkazma",
};

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** So'm kiritish maydoni: kiritilgan raqamni "45 000" ko'rinishida formatlaydi. */
export function AmountInput({
  label,
  value,
  onChange,
  autoFocus,
  style,
  right,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  autoFocus?: boolean;
  style?: StyleProp<TextStyle>;
  right?: ReactNode;
}) {
  return (
    <TextInput
      mode="outlined"
      label={label}
      value={somInputValue(value)}
      onChangeText={(t) => onChange(parseSom(t))}
      keyboardType="number-pad"
      autoFocus={autoFocus}
      right={right ?? <TextInput.Affix text="so'm" />}
      style={style}
    />
  );
}

export function MethodPicker({ value, onChange }: { value: PaymentMethod; onChange(m: PaymentMethod): void }) {
  return (
    <SegmentedButtons
      value={value}
      onValueChange={(v) => onChange(v as PaymentMethod)}
      buttons={(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => ({ value: m, label: METHOD_LABELS[m] }))}
    />
  );
}

export function EmptyState({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon} size={48} color={palette.muted} />
      <Text variant="titleMedium" style={styles.center}>
        {title}
      </Text>
      {hint ? (
        <Text variant="bodyMedium" style={[styles.center, { color: palette.muted }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** PIN bilan himoyalangan bo'lim ochilmaganda ko'rsatiladi. */
export function PinGate({ children }: { children: ReactNode }) {
  const { ready, unlocked, requirePin } = usePin();
  if (!ready) return null;
  if (unlocked) return <>{children}</>;
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name="lock-outline" size={56} color={palette.muted} />
      <Text variant="titleMedium" style={styles.center}>
        Bu bo'lim faqat egasi uchun
      </Text>
      <Button mode="contained" icon="dialpad" onPress={requirePin}>
        PIN kiriting
      </Button>
    </View>
  );
}

/** "Nomi ........ qiymati" ko'rinishidagi qator. */
export function Row({
  label,
  value,
  strong,
  color,
  hint,
}: {
  label: string;
  value: string;
  strong?: boolean;
  color?: string;
  hint?: string;
}) {
  const variant = strong ? 'titleMedium' : 'bodyLarge';
  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        <Text variant={variant}>{label}</Text>
        {hint ? (
          <Text variant="bodySmall" style={{ color: palette.muted }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Text variant={variant} style={[strong && styles.bold, color ? { color } : null]}>
        {value}
      </Text>
    </View>
  );
}

export function MoneyRow(props: { label: string; amount: number; strong?: boolean; color?: string; hint?: string }) {
  return <Row {...props} value={formatSom(props.amount)} />;
}

/**
 * Bir nechtadan bittasini tanlash chipi. Paper'ning oddiy chipida tanlangani deyarli ajralmaydi —
 * bu yerda tanlangani zumrad ramka va fon bilan, qolganlari faqat chiziq bilan.
 */
export function ChoiceChip({
  selected,
  icon,
  onPress,
  children,
}: {
  selected: boolean;
  icon?: IconName;
  onPress(): void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Chip
      compact
      mode="outlined"
      icon={icon ?? (selected ? 'check' : undefined)}
      selected={selected}
      showSelectedCheck={false}
      onPress={onPress}
      style={selected ? { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary } : null}
      textStyle={selected ? { color: theme.colors.onPrimaryContainer, fontWeight: '700' } : null}
      accessibilityState={{ selected }}
    >
      {children}
    </Chip>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text variant="labelLarge" style={[styles.section, { color: theme.colors.primary }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
  rowLabel: { flexShrink: 1 },
  bold: { fontWeight: '700' },
  section: { marginTop: 16, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
});
