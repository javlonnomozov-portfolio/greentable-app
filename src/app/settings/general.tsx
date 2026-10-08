import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chip, IconButton, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { MoneyRow, PinGate, SectionTitle } from '@/components/ui';
import { useDb } from '@/db/hooks';
import { useSettings } from '@/hooks/useSettings';
import { applyRounding, segmentCharge, type RoundingMode } from '@/services/billing';
import { setSetting } from '@/services/settings';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';

const STEPS = [0, 100, 500, 1000, 5000];

export default function GeneralSettings() {
  return (
    <PinGate>
      <GeneralEditor />
    </PinGate>
  );
}

function GeneralEditor() {
  const db = useDb();
  const settings = useSettings();
  const { run } = useFeedback();
  // Tahrirlanayotgan paytdagi qiymat; null bo'lsa saqlangan nom ko'rsatiladi.
  const [hallDraft, setHallDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  useEffect(() => {
    draftRef.current = hallDraft;
  }, [hallDraft]);

  const saveName = async () => {
    const draft = draftRef.current;
    if (draft == null) return;
    draftRef.current = null;
    await run(() => setSetting(db, 'hall_name', draft.trim() || 'Biliard klub'));
    setHallDraft(null);
  };

  // Klaviaturani yopmasdan orqaga chiqilsa ham nom yo'qolmasin.
  useEffect(
    () => () => {
      const draft = draftRef.current;
      if (draft != null) setSetting(db, 'hall_name', draft.trim() || 'Biliard klub').catch(() => undefined);
    },
    [db],
  );

  const { step, mode } = settings.rounding;
  // Namuna: 30 000 so'mlik stolda 47 daqiqa.
  const sampleRaw = segmentCharge(47 * 60_000, 30000);
  const sample = applyRounding(sampleRaw, settings.rounding);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SectionTitle>Klub nomi (chekda chiqadi)</SectionTitle>
      <TextInput
        mode="outlined"
        value={hallDraft ?? settings.hallName}
        onChangeText={(v) => {
          draftRef.current = v;
          setHallDraft(v);
        }}
        onBlur={saveName}
        onSubmitEditing={saveName}
        returnKeyType="done"
      />

      <SectionTitle>Stol vaqti summasini yaxlitlash</SectionTitle>
      <View style={styles.chips}>
        {STEPS.map((s) => (
          <Chip key={s} selected={step === s} onPress={() => run(() => setSetting(db, 'rounding_step', s))}>
            {s === 0 ? "Yo'q" : formatSom(s, false)}
          </Chip>
        ))}
      </View>
      {step > 0 && (
        <SegmentedButtons
          value={mode}
          onValueChange={(v) => run(() => setSetting(db, 'rounding_mode', v as RoundingMode))}
          buttons={[
            { value: 'up', label: 'Yuqoriga' },
            { value: 'nearest', label: 'Yaqiniga' },
            { value: 'down', label: 'Pastga' },
          ]}
        />
      )}
      <View style={styles.sample}>
        <Text variant="bodySmall" style={styles.muted}>
          Misol: 30 000 so'mlik stolda 47 daqiqa
        </Text>
        <MoneyRow label="Aniq hisob" amount={sampleRaw} />
        <MoneyRow label="Mijoz to'laydi" amount={sample} strong />
      </View>

      <SectionTitle>Ish kuni boshlanishi</SectionTitle>
      <Text variant="bodyMedium" style={styles.muted}>
        Tungi o'yinlar shu soatgacha kechagi kunga yoziladi. Masalan 06:00 bo'lsa, soat 02:00 dagi tushum "Bugun"
        hisobotida emas, kechagisida chiqadi.
      </Text>
      <View style={styles.stepper}>
        <IconButton
          icon="minus"
          mode="outlined"
          disabled={settings.dayStartHour <= 0}
          onPress={() => run(() => setSetting(db, 'day_start_hour', settings.dayStartHour - 1))}
        />
        <Text variant="headlineMedium">{String(settings.dayStartHour).padStart(2, '0')}:00</Text>
        <IconButton
          icon="plus"
          mode="outlined"
          disabled={settings.dayStartHour >= 12}
          onPress={() => run(() => setSetting(db, 'day_start_hour', settings.dayStartHour + 1))}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sample: { backgroundColor: palette.incomeBg, borderRadius: 12, padding: 12 },
  muted: { color: palette.muted },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
});
