import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

/**
 * GreenTable brend palitrasi (logotipdan):
 * to'q grafit fon, zumrad yashil (bilyard matosi), oltin (soat strelkalari), sof oq va o'chiq kulrang.
 */
export const brand = {
  graphite: '#121417',
  emerald: '#00C853',
  emeraldDeep: '#00B050',
  gold: '#D4AF37',
  white: '#FFFFFF',
  muted: '#8C929D',
} as const;

const SURFACE = '#1A1D22';
const SURFACE_HIGH = '#23272E';
const RED = '#FF5A5F';

export const theme: MD3Theme = {
  ...MD3DarkTheme,
  dark: true,
  roundness: 5,
  colors: {
    ...MD3DarkTheme.colors,
    primary: brand.emerald,
    onPrimary: '#04170C',
    primaryContainer: '#0E3B22',
    onPrimaryContainer: '#7CF0A8',
    secondary: brand.gold,
    onSecondary: '#1C1606',
    secondaryContainer: '#3A3016',
    onSecondaryContainer: '#F1D98A',
    tertiary: brand.gold,
    onTertiary: '#1C1606',
    tertiaryContainer: '#3A3016',
    onTertiaryContainer: '#F1D98A',
    background: brand.graphite,
    onBackground: brand.white,
    surface: SURFACE,
    onSurface: brand.white,
    surfaceVariant: SURFACE_HIGH,
    onSurfaceVariant: brand.muted,
    outline: '#3A3F47',
    outlineVariant: '#2A2E35',
    error: RED,
    onError: '#2B0508',
    errorContainer: '#4A1518',
    onErrorContainer: '#FFB3B5',
    backdrop: 'rgba(0, 0, 0, 0.65)',
    elevation: {
      level0: 'transparent',
      level1: SURFACE,
      level2: '#1E2127',
      level3: SURFACE_HIGH,
      level4: '#262A31',
      level5: '#292E35',
    },
  },
};

/** Chek oq qog'ozga o'xshab turishi va rasm sifatida ulashilishi uchun yorug' mavzu. */
export const receiptTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: { ...MD3LightTheme.colors, primary: brand.emeraldDeep, onSurface: '#111315', onSurfaceVariant: '#5F6670' },
};

/** Holat va pul yo'nalishi uchun semantik ranglar. */
export const palette = {
  // Stollar: bo'sh — kulrang, o'ynalayotgan — zumrad, pauza — oltin.
  free: brand.muted,
  freeBg: SURFACE,
  busy: brand.emerald,
  busyBg: '#0F2A1C',
  paused: brand.gold,
  pausedBg: '#2A2412',
  /** Taymer va vaqt hisoblagichlari. */
  timer: brand.gold,
  // Pul: kirim — zumrad, xarajat — qizil, qarz — oltin.
  income: brand.emerald,
  incomeBg: '#0F2A1C',
  expense: RED,
  debt: brand.gold,
  debtBg: '#2A2412',
  // Xavfli amallar va ogohlantirishlar.
  danger: RED,
  dangerBg: '#2A1517',
  muted: brand.muted,
  /** Karta va ajratgich chiziqlari. */
  border: '#2A2E35',
};
