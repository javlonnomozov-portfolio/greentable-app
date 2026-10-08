import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, TextInput } from 'react-native-paper';

/** Vaqtli seans uchun tez tanlovlar (daqiqa). null — muddatsiz. */
const PRESETS: { minutes: number | null; label: string }[] = [
  { minutes: null, label: 'Cheksiz' },
  { minutes: 30, label: '30 daq' },
  { minutes: 60, label: '1 soat' },
  { minutes: 90, label: '1,5 soat' },
  { minutes: 120, label: '2 soat' },
  { minutes: 180, label: '3 soat' },
];

interface Props {
  value: number | null;
  onChange(minutes: number | null): void;
}

/** Seans muddati: Cheksiz / 30 daq / 1 / 1,5 / 2 / 3 soat / boshqa (daqiqada kiritiladi). */
export function DurationChips({ value, onChange }: Props) {
  const isPreset = PRESETS.some((p) => p.minutes === value);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState(isPreset || value == null ? '' : String(value));

  return (
    <View style={styles.root}>
      <View style={styles.chips}>
        {PRESETS.map((p) => (
          <Chip
            key={p.label}
            compact
            selected={!custom && value === p.minutes}
            showSelectedOverlay
            onPress={() => {
              setCustom(false);
              onChange(p.minutes);
            }}
          >
            {p.label}
          </Chip>
        ))}
        <Chip compact selected={custom} showSelectedOverlay icon="pencil-outline" onPress={() => setCustom(true)}>
          Boshqa
        </Chip>
      </View>
      {custom ? (
        <TextInput
          mode="outlined"
          dense
          label="Muddat, daqiqa"
          keyboardType="number-pad"
          value={draft}
          autoFocus
          onChangeText={(t) => {
            const digits = t.replace(/\D/g, '').slice(0, 4);
            setDraft(digits);
            const n = Number(digits);
            onChange(n > 0 && n <= 24 * 60 ? n : null);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
