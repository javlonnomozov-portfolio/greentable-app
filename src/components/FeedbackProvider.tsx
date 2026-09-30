import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog, Portal, Snackbar, Text } from 'react-native-paper';
import { notifyDbChanged } from '@/db/events';
import { palette } from '@/theme';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface Feedback {
  toast(message: string): void;
  confirm(options: ConfirmOptions): Promise<boolean>;
  /**
   * Amalni bajaradi: xato bo'lsa xabar ko'rsatadi, muvaffaqiyatli bo'lsa ekranlarni yangilaydi.
   * Xato bo'lganda `undefined` qaytaradi.
   */
  run<T>(action: () => Promise<T>, successMessage?: string): Promise<T | undefined>;
}

const FeedbackContext = createContext<Feedback | null>(null);

export function useFeedback(): Feedback {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('FeedbackProvider topilmadi');
  return ctx;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "Noma'lum xatolik";
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [snack, setSnack] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const toast = useCallback((message: string) => setSnack(message), []);

  const confirm = useCallback((options: ConfirmOptions) => {
    resolver.current?.(false);
    setDialog(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setDialog(null);
  };

  const run = useCallback(
    async <T,>(action: () => Promise<T>, successMessage?: string): Promise<T | undefined> => {
      try {
        const result = await action();
        notifyDbChanged();
        if (successMessage) toast(successMessage);
        return result;
      } catch (e) {
        notifyDbChanged();
        toast(errorMessage(e));
        return undefined;
      }
    },
    [toast],
  );

  const value = useMemo(() => ({ toast, confirm, run }), [toast, confirm, run]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <Portal>
        <Dialog visible={dialog != null} onDismiss={() => close(false)}>
          <Dialog.Title>{dialog?.title}</Dialog.Title>
          {dialog?.message ? (
            <Dialog.Content>
              <Text variant="bodyMedium">{dialog.message}</Text>
            </Dialog.Content>
          ) : null}
          <Dialog.Actions>
            <Button onPress={() => close(false)}>Bekor</Button>
            <Button
              mode="contained"
              buttonColor={dialog?.destructive ? palette.danger : undefined}
              textColor={dialog?.destructive ? '#FFFFFF' : undefined}
              onPress={() => close(true)}
            >
              {dialog?.confirmLabel ?? 'Ha'}
            </Button>
          </Dialog.Actions>
        </Dialog>
        <Snackbar visible={snack != null} onDismiss={() => setSnack(null)} duration={3000}>
          {snack ?? ''}
        </Snackbar>
      </Portal>
    </FeedbackContext.Provider>
  );
}
