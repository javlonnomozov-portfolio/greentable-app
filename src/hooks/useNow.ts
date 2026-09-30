import { useSyncExternalStore } from 'react';

/** Butun ilova uchun bitta soniya taymeri — har bir stol kartasi alohida interval ochmaydi. */
let now = Date.now();
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!interval) {
    now = Date.now();
    interval = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval) {
      clearInterval(interval);
      interval = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
