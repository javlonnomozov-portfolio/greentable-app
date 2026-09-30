import Constants from 'expo-constants';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { brand } from '@/theme';

const logoMark = require('../../assets/logo-mark.png');

/** "GREEN" zumrad, "TABLE" oq — logodagi yozuv. */
function Wordmark({ size }: { size: number }) {
  return (
    <Text style={[styles.word, { fontSize: size }]}>
      <Text style={[styles.word, { fontSize: size, color: brand.emerald }]}>GREEN</Text>TABLE
    </Text>
  );
}

/** Sarlavhadagi ixcham brend: belgi + yozuv. */
export function BrandTitle() {
  return (
    <View style={styles.row}>
      <Image source={logoMark} style={styles.markSmall} resizeMode="contain" />
      <Wordmark size={20} />
    </View>
  );
}

/** Sozlamalar tepasidagi katta brend bloki. */
export function BrandHeader() {
  return (
    <View style={styles.header}>
      <Image source={logoMark} style={styles.markLarge} resizeMode="contain" />
      <View style={styles.headerText}>
        <Wordmark size={26} />
        <Text variant="labelMedium" style={styles.tagline}>
          BILIARDXONA BOSHQARUV TIZIMI
        </Text>
        <Text variant="bodySmall" style={styles.version}>
          Versiya {Constants.expoConfig?.version ?? '—'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  markSmall: { width: 34, height: 28 },
  word: { fontWeight: '800', letterSpacing: 1, color: brand.white },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, paddingBottom: 8 },
  markLarge: { width: 76, height: 64 },
  headerText: { flexShrink: 1, gap: 2 },
  tagline: { color: brand.white, letterSpacing: 0.8 },
  version: { color: brand.muted },
});
