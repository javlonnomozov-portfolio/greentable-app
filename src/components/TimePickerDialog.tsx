import dayjs from 'dayjs';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, HelperText, Portal, Text } from 'react-native-paper';
import { palette } from '@/theme';
import { clockToTimestamp, formatAgo, formatTime } from '@/utils/time';
import { TimeWheel } from './TimeWheel';

interface Props {
  visible: boolean;
  title: string;
  /** Hozirgi tanlov. */
  value: number;
  /** Eng erta ruxsat etilgan vaqt (masalan seans boshlanishi). */
  min?: number;
  /** Eng kech ruxsat etilgan vaqt. Sukut bo'yicha — hozir. */
  max?: number;
  hint?: string;
  onDismiss(): void;
  onConfirm(ts: number): void;
}

const MINUTES_AGO = [5, 10, 15, 30, 60];

/**
 * Unutilgan seans vaqtini tanlash: Samsung soat ilovasidagidek soat va daqiqa g'ildiraklari
 * hamda "N daqiqa oldin" tugmalari. Klaviatura ochilmaydi. Har ochilganda holat yangidan boshlanadi.
 */
export function TimePickerDialog(props: Props) {
  if (!props.visible) return null;
  return <TimePickerContent {...props} />;
}

function TimePickerContent({ title, value, min, max, hint, onDismiss, onConfirm }: Props) {
  const [now] = useState(() => Date.now());
  const upper = max ?? now;
  const [selected, setSelected] = useState(() => dayjs(Math.min(value, upper)).second(0).millisecond(0).valueOf());
  const d = dayjs(selected);

  const error =
    selected > upper + 60_000
      ? max != null
        ? `${formatTime(upper)} dan keyin bo'lishi mumkin emas`
        : "Kelajakdagi vaqtni tanlab bo'lmaydi"
      : min != null && selected < dayjs(min).second(0).millisecond(0).valueOf()
        ? `${formatTime(min)} dan oldin bo'lishi mumkin emas`
        : null;

  const pickAgo = (minutes: number) => setSelected(dayjs(upper - minutes * 60_000).second(0).millisecond(0).valueOf());

  return (
    <Portal>
      <Dialog visible onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title style={styles.title}>{title}</Dialog.Title>
        <Dialog.Content style={styles.content}>
          <TimeWheel
            hour={d.hour()}
            minute={d.minute()}
            onChange={(h, m) => setSelected(clockToTimestamp(h, m, upper))}
          />
          <Text variant="titleSmall" style={[styles.ago, { color: error ? palette.danger : palette.timer }]}>
            {error ?? formatAgo(now - selected)}
          </Text>
          <View style={styles.chips}>
            <Chip compact selected={Math.abs(selected - upper) < 60_000} onPress={() => pickAgo(0)}>
              {max != null ? formatTime(upper) : 'Hozir'}
            </Chip>
            {MINUTES_AGO.map((m) => {
              const ts = upper - m * 60_000;
              if (min != null && ts < min) return null;
              return (
                <Chip key={m} compact onPress={() => pickAgo(m)}>
                  −{m < 60 ? `${m} daq` : '1 soat'}
                </Chip>
              );
            })}
          </View>
          {hint ? (
            <HelperText type="info" style={styles.hint}>
              {hint}
            </HelperText>
          ) : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Bekor</Button>
          <Button mode="contained" disabled={!!error} onPress={() => onConfirm(selected)}>
            Tanlash
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 420, alignSelf: 'center', width: '90%' },
  title: { textAlign: 'center' },
  content: { alignItems: 'center', gap: 8 },
  ago: { textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  hint: { textAlign: 'center' },
});
