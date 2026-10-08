import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSync } from '@/components/SyncProvider';
import { api } from '@/sync/api';
import { getInstallId } from '@/sync/session';
import { brand, palette, theme } from '@/theme';

const logoMark = require('../../assets/logo-mark.png');
const POLL_MS = 2000;

/**
 * Telegram orqali kirish: server bir martalik havola beradi → Telegram'da bot ochiladi →
 * foydalanuvchi START ni bosadi (yangi bo'lsa telefon va biliardxona nomini yuboradi) →
 * ilova shu orada so'rab turadi va tasdiqlangach qurilma tokenini oladi.
 */
export default function LoginScreen() {
  const { completeLogin } = useSync();
  const [link, setLink] = useState<{ token: string; url: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.authStart(await getInstallId());
      setLink(res);
      await Linking.openURL(res.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!link) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || done.current) return;
      if (Date.now() > link.expiresAt) {
        setLink(null);
        setError("Kirish muddati tugadi. Qaytadan «Telegram orqali kirish» ni bosing.");
        return;
      }
      try {
        const res = await api.authPoll(link.token);
        if (res.status === 'ok') {
          done.current = true;
          await completeLogin(res.deviceToken, res.me);
          return;
        }
        if (res.status === 'expired') {
          setLink(null);
          setError('Kirish havolasi eskirdi. Qaytadan urining.');
          return;
        }
      } catch {
        // Internet bir lahza uzilsa — keyingi urinishda davom etadi.
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    let timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [link, completeLogin]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <Image source={logoMark} style={styles.logo} resizeMode="contain" />
        <Text style={styles.word}>
          <Text style={[styles.word, { color: brand.emerald }]}>GREEN</Text>TABLE
        </Text>
        <Text variant="labelMedium" style={styles.tagline}>
          BILIARDXONA BOSHQARUV TIZIMI
        </Text>
      </View>

      <View style={styles.card}>
        {!link ? (
          <>
            <Text variant="titleMedium" style={styles.text}>
              Biliardxonangiz hisobiga kiring
            </Text>
            <Text variant="bodyMedium" style={[styles.text, styles.muted]}>
              Kirish va ro'yxatdan o'tish Telegram bot orqali. Birinchi marta bo'lsa, bot telefon raqamingizni va
              biliardxona nomini so'raydi.
            </Text>
            <Button mode="contained" icon="send" onPress={start} loading={busy} disabled={busy} contentStyle={styles.btn}>
              Telegram orqali kirish
            </Button>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" />
            <Text variant="titleMedium" style={styles.text}>
              Telegram'da tasdiqlang
            </Text>
            <View style={styles.steps}>
              {['Telegram\'da GreenTable boti ochiladi', '«START» (Boshlash) ni bosing', "Kerak bo'lsa raqam va nomni yuboring", 'Ilovaga qayting — o‘zi ochiladi'].map(
                (s, i) => (
                  <View key={s} style={styles.step}>
                    <Text style={styles.num}>{i + 1}</Text>
                    <Text variant="bodyMedium" style={styles.stepText}>
                      {s}
                    </Text>
                  </View>
                ),
              )}
            </View>
            <Button icon="open-in-new" onPress={() => Linking.openURL(link.url)}>
              Telegram'ni qayta ochish
            </Button>
            <Button textColor={palette.muted} onPress={() => setLink(null)}>
              Bekor qilish
            </Button>
          </>
        )}
        {error ? (
          <HelperText type="error" style={styles.text}>
            <MaterialCommunityIcons name="alert-circle-outline" /> {error}
          </HelperText>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', padding: 24, gap: 32 },
  center: { alignItems: 'center', gap: 6 },
  logo: { width: 120, height: 100 },
  word: { fontSize: 34, fontWeight: '800', letterSpacing: 1, color: brand.white },
  tagline: { color: brand.white, letterSpacing: 1 },
  card: { backgroundColor: theme.colors.elevation.level2, borderRadius: 24, padding: 20, gap: 14 },
  text: { textAlign: 'center' },
  muted: { color: palette.muted },
  btn: { paddingVertical: 6 },
  steps: { gap: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: {
    width: 26,
    height: 26,
    borderRadius: 13,
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: theme.colors.primary,
    color: theme.colors.onPrimary,
    fontWeight: '700',
  },
  stepText: { flex: 1 },
});
