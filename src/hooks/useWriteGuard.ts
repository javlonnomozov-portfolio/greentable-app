import { useCallback } from 'react';
import { useFeedback } from '@/components/FeedbackProvider';
import { useSync } from '@/components/SyncProvider';

export const READ_ONLY_MESSAGE = "Obuna tugagan — faqat ko'rish rejimi. Sozlamalar → Hisob va obuna orqali to'lov qiling.";

/**
 * Faqat-ko'rish rejimida yangi o'yin, savdo, mahsulot qo'shish kabi amallarni to'xtatadi.
 * Ochiq hisobni yopish va qarz qabul qilish ochiq qoladi — pul "qamalib" qolmasin.
 */
export function useWriteGuard() {
  const { readOnly } = useSync();
  const { toast } = useFeedback();
  return useCallback(
    <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (readOnly) toast(READ_ONLY_MESSAGE);
        else fn(...args);
      },
    [readOnly, toast],
  );
}
