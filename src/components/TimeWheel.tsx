import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

const ITEM_HEIGHT = 64;
const VISIBLE = 3;
const HALF = (VISIBLE - 1) / 2;
/** Ro'yxat bir necha marta takrorlanadi va o'rtadan boshlanadi — g'ildirak cheksiz aylanadi (23 → 00). */
const CYCLES = 9;

interface WheelProps {
  /** Qiymatlar soni: soat uchun 24, daqiqa uchun 60. */
  count: number;
  value: number;
  onChange(value: number): void;
  label: string;
}

const pad = (n: number) => n.toString().padStart(2, '0');
const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Samsung soat ilovasidagidek aylanadigan raqamlar ustuni: tanlangani o'rtada, katta. */
export function Wheel({ count, value, onChange, label }: WheelProps) {
  const theme = useTheme();
  const listRef = useRef<FlatList<number>>(null);
  const [scrollY] = useState(() => new Animated.Value(0));
  const total = count * CYCLES;
  const middle = Math.floor(CYCLES / 2) * count;
  /** Hozir o'rtada turgan element indeksi (takrorlangan ro'yxatda). */
  const center = useRef(middle + value);
  /**
   * Faqat barmoq bilan aylantirilgandan keyingi to'xtashni qabul qilamiz: Android dasturiy (animatsiyali)
   * aylantirish paytida ham "to'xtadi" hodisasini oraliq joyda yuborib, qiymatni bittaga surib yuborardi.
   */
  const dragging = useRef(false);
  const data = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);

  const scrollToIndex = (index: number, animated: boolean) => {
    center.current = index;
    listRef.current?.scrollToOffset({ offset: (index - HALF) * ITEM_HEIGHT, animated });
  };

  // Tashqaridan qiymat o'zgarsa (masalan "−15 daq" bosilsa) g'ildirak eng yaqin yo'ldan aylanadi.
  useEffect(() => {
    const current = center.current;
    if (mod(current, count) === value) return;
    const base = current - mod(current, count) + value;
    const target = [base - count, base, base + count].reduce((a, b) => (Math.abs(b - current) < Math.abs(a - current) ? b : a));
    scrollToIndex(target, true);
  }, [value, count]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT) + HALF;
    center.current = index;
    const next = mod(index, count);
    if (next !== value) onChange(next);
    // Chetga yaqinlashsa, sezdirmasdan o'rtadagi xuddi shu qiymatga qaytamiz.
    if (index < count * 2 || index > total - count * 2) scrollToIndex(middle + next, false);
  };

  return (
    <View style={styles.column}>
      <Animated.FlatList
        ref={listRef}
        data={data}
        keyExtractor={(i) => String(i)}
        style={{ height: ITEM_HEIGHT * VISIBLE }}
        getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
        initialScrollIndex={middle + value - HALF}
        initialNumToRender={VISIBLE + 4}
        windowSize={3}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        onScrollBeginDrag={() => {
          dragging.current = true;
        }}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={(e) => {
          if (!e.nativeEvent.velocity?.y) settle(e);
        }}
        accessibilityLabel={label}
        renderItem={({ item: i }) => {
          const centered = (i - HALF) * ITEM_HEIGHT;
          const inputRange = [centered - ITEM_HEIGHT, centered, centered + ITEM_HEIGHT];
          const scale = scrollY.interpolate({ inputRange, outputRange: [0.62, 1, 0.62], extrapolate: 'clamp' });
          const opacity = scrollY.interpolate({ inputRange, outputRange: [0.3, 1, 0.3], extrapolate: 'clamp' });
          return (
            <Animated.View style={[styles.item, { opacity, transform: [{ scale }] }]}>
              <Text style={[styles.digits, { color: theme.colors.onSurface }]}>{pad(mod(i, count))}</Text>
            </Animated.View>
          );
        }}
      />
      <Text variant="labelMedium" style={[styles.caption, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
    </View>
  );
}

interface TimeWheelProps {
  hour: number;
  minute: number;
  onChange(hour: number, minute: number): void;
}

/** Soat : daqiqa — ikki g'ildirak yonma-yon. */
export function TimeWheel({ hour, minute, onChange }: TimeWheelProps) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Wheel count={24} value={hour} label="soat" onChange={(h) => onChange(h, minute)} />
      <Text style={[styles.colon, { color: theme.colors.onSurface }]}>:</Text>
      <Wheel count={60} value={minute} label="daqiqa" onChange={(m) => onChange(hour, m)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 4 },
  column: { width: 96, alignItems: 'center' },
  item: { height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  digits: { fontSize: 46, fontWeight: '300', fontVariant: ['tabular-nums'] },
  colon: { fontSize: 42, fontWeight: '300', lineHeight: ITEM_HEIGHT * VISIBLE, textAlignVertical: 'center' },
  caption: { marginTop: 2 },
});
