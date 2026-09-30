import { StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TouchableRipple, useTheme } from 'react-native-paper';

export const PIN_LENGTH = 4;

interface Props {
  title: string;
  value: string;
  onChange(value: string): void;
  error?: string | null;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

/** 4 xonali PIN uchun raqamli klaviatura. To'lganda `onChange` oxirgi qiymat bilan chaqiriladi. */
export function PinPad({ title, value, onChange, error }: Props) {
  const theme = useTheme();
  const press = (key: string) => {
    if (key === '⌫') onChange(value.slice(0, -1));
    else if (key && value.length < PIN_LENGTH) onChange(value + key);
  };
  return (
    <View style={styles.root}>
      <Text variant="titleMedium" style={styles.title}>
        {title}
      </Text>
      <View style={styles.dots}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { borderColor: theme.colors.primary },
              i < value.length && { backgroundColor: theme.colors.primary },
            ]}
          />
        ))}
      </View>
      <HelperText type="error" visible={!!error} style={styles.error}>
        {error ?? ' '}
      </HelperText>
      <View style={styles.grid}>
        {KEYS.map((key, i) => (
          <View key={i} style={styles.cell}>
            {key ? (
              <TouchableRipple
                onPress={() => press(key)}
                borderless
                style={[styles.key, { backgroundColor: theme.colors.surfaceVariant }]}
              >
                <Text variant="headlineSmall">{key}</Text>
              </TouchableRipple>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export function PinPadCancel({ onPress }: { onPress(): void }) {
  return (
    <Button onPress={onPress} style={{ marginTop: 8 }}>
      Bekor qilish
    </Button>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  title: { marginBottom: 16, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 16 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  error: { textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 264 },
  cell: { width: '33.33%', alignItems: 'center', paddingVertical: 6 },
  key: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
