import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { Modal, Portal } from 'react-native-paper';
import { clearPin, hasPin as loadHasPin, setPin, verifyPin } from '@/services/pin';
import { theme } from '@/theme';
import { PIN_LENGTH, PinPad, PinPadCancel } from './PinPad';

interface PinContext {
  /** PIN o'rnatilganmi. O'rnatilmagan bo'lsa hamma bo'lim ochiq. */
  hasPin: boolean;
  /** PIN holati SecureStore'dan o'qilganmi. */
  ready: boolean;
  unlocked: boolean;
  /** Egasi PIN kiritguncha kutadi. PIN o'rnatilmagan yoki allaqachon ochiq bo'lsa darhol `true`. */
  requirePin(): Promise<boolean>;
  lock(): void;
  /** Yangi PINni saqlaydi; o'rnatgan odam uchun bo'limlar ochiq qoladi. */
  savePin(pin: string): Promise<void>;
  removePin(): Promise<void>;
}

const Ctx = createContext<PinContext | null>(null);

const RELOCK_AFTER_MS = 60_000;

export function usePin(): PinContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('PinProvider topilmadi');
  return ctx;
}

export function PinProvider({ children }: { children: ReactNode }) {
  const [hasPin, setHasPin] = useState(false);
  const [ready, setReady] = useState(false);
  const [unlockedFlag, setUnlocked] = useState(false);
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    loadHasPin()
      .then(setHasPin)
      .finally(() => setReady(true));
  }, []);

  const savePin = useCallback(async (pin: string) => {
    await setPin(pin);
    setUnlocked(true);
    setHasPin(true);
  }, []);

  const removePin = useCallback(async () => {
    await clearPin();
    setHasPin(false);
  }, []);

  // Ilova fonda 1 daqiqadan ko'p tursa qayta qulflanadi (ulashish/fayl tanlash oynalari qulflamaydi).
  useEffect(() => {
    let leftAt: number | null = null;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (leftAt != null && Date.now() - leftAt > RELOCK_AFTER_MS) setUnlocked(false);
        leftAt = null;
      } else if (leftAt == null) {
        leftAt = Date.now();
      }
    });
    return () => sub.remove();
  }, []);

  const unlocked = ready && (!hasPin || unlockedFlag);

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setVisible(false);
    setValue('');
    setError(null);
  };

  const requirePin = useCallback(() => {
    if (unlocked) return Promise.resolve(true);
    if (!ready) return Promise.resolve(false);
    resolver.current?.(false);
    setVisible(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, [unlocked, ready]);

  const onChange = async (next: string) => {
    setValue(next);
    setError(null);
    if (next.length === PIN_LENGTH) {
      if (await verifyPin(next)) {
        setUnlocked(true);
        finish(true);
      } else {
        setValue('');
        setError("PIN noto'g'ri");
      }
    }
  };

  const lock = useCallback(() => setUnlocked(false), []);

  const ctx = useMemo(
    () => ({ hasPin, ready, unlocked, requirePin, lock, savePin, removePin }),
    [hasPin, ready, unlocked, requirePin, lock, savePin, removePin],
  );

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <Portal>
        <Modal visible={visible} onDismiss={() => finish(false)} contentContainerStyle={styles.modal}>
          <PinPad title="Egasining PIN kodi" value={value} onChange={onChange} error={error} />
          <PinPadCancel onPress={() => finish(false)} />
        </Modal>
      </Portal>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  modal: { backgroundColor: theme.colors.elevation.level3, margin: 24, padding: 24, borderRadius: 24, alignSelf: 'center' },
});
