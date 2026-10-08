import type { PullRow, SyncChange } from '../server/src/contract';
import { EpochError, type Transport } from '@/sync/engine';

/**
 * Server sinxron mantig'ining xotiradagi nusxasi (server/src/services/sync.ts bilan bir xil qoidalar):
 * oxirgi yozuv yutadi (teng bo'lsa qurilma id), har yozuvga yangi `rev`, epoch.
 * Ma'lumot JSON orqali ko'chiriladi — xuddi tarmoqdagidek.
 */
export function fakeServer(opts: { maxPull?: number } = {}) {
  let rev = 0;
  let epoch = 1;
  const rows = new Map<string, PullRow & { deviceId: string }>();
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

  const device = (deviceId: string): Transport => ({
    async push({ epoch: e, changes }) {
      if (e !== epoch) throw new EpochError(epoch);
      let accepted = 0;
      for (const c of copy(changes) as SyncChange[]) {
        const key = `${c.tbl}:${c.uid}`;
        const prev = rows.get(key);
        if (!prev || c.updatedAt > prev.updatedAt || (c.updatedAt === prev.updatedAt && prev.deviceId < deviceId)) {
          rows.set(key, { ...c, rev: ++rev, deviceId });
          accepted++;
        }
      }
      return { ok: true, accepted, serverTime: Date.now() };
    },
    async pull(since, limit) {
      const all = [...rows.values()].filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev);
      const n = Math.min(limit, opts.maxPull ?? limit);
      const page = all.slice(0, n).map(({ deviceId: _, ...r }) => copy(r));
      return {
        epoch,
        rows: page,
        nextRev: page.length ? page[page.length - 1].rev : since,
        more: all.length > n,
        serverTime: Date.now(),
      };
    },
  });

  return {
    device,
    rows,
    /** "Tarixni tozalash" (POST /hall/reset). */
    reset(tables: string[]) {
      for (const [k, r] of rows) if (tables.includes(r.tbl)) rows.delete(k);
      epoch++;
    },
    count: (tbl: string) => [...rows.values()].filter((r) => r.tbl === tbl && !r.deleted).length,
  };
}
