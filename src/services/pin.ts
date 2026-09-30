import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY = 'owner_pin_v1';

interface StoredPin {
  salt: string;
  hash: string;
}

async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

export async function hasPin(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEY)) != null;
}

export async function setPin(pin: string): Promise<void> {
  const salt = Crypto.randomUUID();
  const stored: StoredPin = { salt, hash: await hashPin(pin, salt) };
  await SecureStore.setItemAsync(KEY, JSON.stringify(stored));
}

export async function clearPin(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return true;
  const stored = JSON.parse(raw) as StoredPin;
  return (await hashPin(pin, stored.salt)) === stored.hash;
}
