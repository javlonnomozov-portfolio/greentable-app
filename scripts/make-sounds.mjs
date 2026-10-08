// Bildirishnoma tovushlarini sintez qiladi (litsenziya muammosisiz): node scripts/make-sounds.mjs
//   assets/sounds/balls.wav — billiard sharlari to'qnashuvi (vaqt tugadi)
//   assets/sounds/warn.wav  — yumshoq "dong" (5 daqiqa qoldi)
import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 44100;

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function normalize(buf, peak) {
  const max = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  return buf.map((v) => (v / max) * peak);
}

// Deterministik shovqin (har safar bir xil fayl chiqsin).
let seed = 12345;
const noise = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 30) - 1;

/** Fil suyagi sharlarining "tak" ovozi: qisqa zarba + 2.5–7 kHz da tez so'nadigan rezonans. */
function clack(buf, start, amp) {
  const modes = [
    [2650, 0.018, 1],
    [3900, 0.012, 0.7],
    [5600, 0.008, 0.45],
    [7300, 0.005, 0.25],
    [900, 0.01, 0.35],
  ];
  const len = Math.floor(0.09 * RATE);
  const s0 = Math.floor(start * RATE);
  for (let i = 0; i < len && s0 + i < buf.length; i++) {
    const t = i / RATE;
    let v = noise() * Math.exp(-t / 0.0012) * 0.8;
    for (const [f, tau, a] of modes) v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / tau);
    buf[s0 + i] += v * amp;
  }
}

function balls() {
  const buf = new Array(Math.floor(1.0 * RATE)).fill(0);
  clack(buf, 0.0, 1);
  clack(buf, 0.13, 0.8);
  clack(buf, 0.24, 0.55);
  clack(buf, 0.52, 0.35);
  return normalize(buf, 0.92);
}

function warn() {
  const buf = new Array(Math.floor(1.1 * RATE)).fill(0);
  const note = (start, f, amp) => {
    const s0 = Math.floor(start * RATE);
    for (let i = 0; s0 + i < buf.length; i++) {
      const t = i / RATE;
      const env = Math.min(1, t / 0.005) * Math.exp(-t / 0.32);
      buf[s0 + i] += amp * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t));
    }
  };
  note(0, 880, 1);
  note(0.2, 1318.5, 0.8);
  return normalize(buf, 0.6);
}

mkdirSync('assets/sounds', { recursive: true });
writeFileSync('assets/sounds/balls.wav', wav(balls()));
writeFileSync('assets/sounds/warn.wav', wav(warn()));
console.log('assets/sounds/balls.wav, assets/sounds/warn.wav');
