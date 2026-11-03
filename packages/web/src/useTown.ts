import { useCallback, useEffect, useRef, useState } from "react";
import type { Caravan, ConfigView, FeedItem, PlayerView, StallView, StatsView } from "@capy/core";
import { reader } from "./near";

export interface Town {
  config?: ConfigView;
  stalls: StallView[];
  caravan?: Caravan;
  feed: FeedItem[];
  stats?: StatsView;
  me?: PlayerView | null;
  loadedAt: number;
  error?: string;
}

export function useTown(accountId?: string, everyMs = 4_000) {
  const [town, setTown] = useState<Town>({ stalls: [], feed: [], loadedAt: 0 });
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const [stalls, caravan, feed, stats, me] = await Promise.all([
        reader.stalls(),
        reader.caravan(),
        reader.feed(40),
        reader.stats(),
        accountId ? reader.player(accountId) : Promise.resolve(undefined),
      ]);
      setTown((t) => ({ ...t, stalls, caravan, feed, stats, me, loadedAt: Date.now(), error: undefined }));
    } catch (e) {
      setTown((t) => ({ ...t, error: String(e).slice(0, 160) }));
    } finally {
      busy.current = false;
    }
  }, [accountId]);

  useEffect(() => {
    reader.config().then((config) => setTown((t) => ({ ...t, config })));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, everyMs);
    return () => clearInterval(id);
  }, [refresh, everyMs]);

  return { town, refresh };
}

export function useNow(everyMs = 1_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
