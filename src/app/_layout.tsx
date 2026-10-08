import Constants, { ExecutionEnvironment } from 'expo-constants';
import { DarkTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator, PaperProvider } from 'react-native-paper';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { FeedbackProvider } from '@/components/FeedbackProvider';
import { PinProvider } from '@/components/PinProvider';
import { SyncProvider, useSync } from '@/components/SyncProvider';
import { DB_NAME } from '@/db/hooks';
import { migrate } from '@/db/migrations';
import { palette, theme } from '@/theme';

// Logo splash ekrandan ilovaga silliq o'tadi (Expo Go buni qo'llamaydi — faqat haqiqiy ilovada).
if (Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
  SplashScreen.setOptions({ duration: 400, fade: true });
}

/** Sarlavhalar, tab paneli va ekran fonlari uchun navigatsiya mavzusi (brend ranglari). */
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: theme.colors.primary,
    background: theme.colors.background,
    card: theme.colors.background,
    text: theme.colors.onSurface,
    border: palette.border,
    notification: theme.colors.secondary,
  },
};

function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" />
    </View>
  );
}

/**
 * Ishga tushishda xato bo'lsa (masalan baza vaqtincha band) ilova qulab qolmaydi — qayta urinish taklif qilinadi.
 * Bu yerda Paper ishlatilmaydi: xato Paper provayderi ichida ham bo'lishi mumkin.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.error}>
      <Text style={styles.errorTitle}>Xatolik yuz berdi</Text>
      <Text style={styles.errorText}>{error.message}</Text>
      <Pressable onPress={retry} style={styles.retry}>
        <Text style={styles.retryText}>Qayta urinish</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <ThemeProvider value={navigationTheme}>
          <Suspense fallback={<Loading />}>
            <SQLiteProvider databaseName={DB_NAME} onInit={migrate} options={{ enableChangeListener: true }} useSuspense>
              <FeedbackProvider>
                <PinProvider>
                  <SyncProvider>
                    <AppStack />
                  </SyncProvider>
                </PinProvider>
              </FeedbackProvider>
            </SQLiteProvider>
          </Suspense>
        </ThemeProvider>
      </PaperProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

/** Kirmagan foydalanuvchi faqat kirish ekranini ko'radi (Telegram orqali). */
function AppStack() {
  const { ready, loggedIn } = useSync();
  if (!ready) return <Loading />;
  return (
    <Stack
      // Android 15 ilovani butun ekranga chizadi: pastki tugmalar tizim navigatsiya paneli ostida
      // qolmasligi uchun har bir ekran pastdan xavfsiz hudud bilan o'raladi (tablar buni o'zi qiladi).
      screenLayout={({ route, children }) =>
        route.name === '(tabs)' || route.name === 'login' ? (
          children
        ) : (
          <SafeAreaView edges={['bottom']} style={styles.screen}>
            {children}
          </SafeAreaView>
        )
      }
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.onSurface,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Protected guard={!loggedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={loggedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="bill/[id]" options={{ title: 'Hisob' }} />
        <Stack.Screen name="checkout/[id]" options={{ title: "To'lov" }} />
        <Stack.Screen name="receipt/[id]" options={{ title: 'Chek' }} />
        <Stack.Screen name="customer/[id]" options={{ title: 'Mijoz' }} />
        <Stack.Screen name="expense/new" options={{ title: "Xarajat qo'shish" }} />
        <Stack.Screen name="expenses" options={{ title: 'Xarajatlar' }} />
        <Stack.Screen name="bills" options={{ title: 'Cheklar' }} />
        <Stack.Screen name="settings/account" options={{ title: 'Hisob va obuna' }} />
        <Stack.Screen name="settings/tables" options={{ title: 'Stollar' }} />
        <Stack.Screen name="settings/products" options={{ title: 'Mahsulotlar' }} />
        <Stack.Screen name="settings/expense-categories" options={{ title: 'Xarajat turlari' }} />
        <Stack.Screen name="settings/general" options={{ title: 'Hisob-kitob' }} />
        <Stack.Screen name="settings/pin" options={{ title: 'PIN kod' }} />
        <Stack.Screen name="settings/clear" options={{ title: 'Tarixni tozalash' }} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1, backgroundColor: theme.colors.background },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: theme.colors.background },
  errorTitle: { fontSize: 20, fontWeight: '700', color: theme.colors.error },
  errorText: { fontSize: 14, textAlign: 'center', color: theme.colors.onSurface },
  retry: { backgroundColor: theme.colors.primary, borderRadius: 24, paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: theme.colors.onPrimary, fontSize: 16, fontWeight: '600' },
});
