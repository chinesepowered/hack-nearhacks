// Fast-forward: simulate a week of Yuzu Springs in about a second, off-chain, using the same
// price curve and keeper rules as the live town. Used by `pnpm sim` and the web "Fast-forward"
// tab, so judges can watch prices react without waiting a week.

import { bidUnit, askUnit, shelfCap, type Quote } from "./price";
import { decide } from "./keeper";
import { SEED_STALLS, type Traits } from "./town";
import type { Caravan, Fill, OfferIn, Policy, StallView } from "./types";

export interface SimOptions {
  days?: number;
  bots?: number;
  seed?: number;
  /** Days on which a melon festival triples melon demand at the caravan. */
  festivalDays?: number[];
  /** Days on which a yuzu blight halves yuzu foraging. */
  blightDays?: number[];
  /** Minutes per caravan round (contract: caravan_round_ms). */
  roundMinutes?: number;
  /** Coins burned from each stall per round (contract: stall_rent). */
  rent?: number;
  /** Bot actions per minute, 0..1. */
  activity?: number;
}

export interface SimPoint {
  hour: number;
  prices: Record<string, number>; // average bid across open stalls
  coins: number; // coins in circulation
  openStalls: number;
  stallCoins: Record<string, number>;
}

export interface SimResult {
  points: SimPoint[];
  events: { hour: number; text: string }[];
  summary: { trades: number; soaks: number; caravanUnits: number; closures: number; reopenings: number };
}

const GOODS = [
  { id: "grass", ref: 2, min: 2, max: 4, cmin: 12, cmax: 40 },
  { id: "yuzu", ref: 5, min: 1, max: 3, cmin: 6, cmax: 20 },
  { id: "melon", ref: 9, min: 1, max: 2, cmin: 3, cmax: 10 },
];
const MIN_FLOAT = 5;
const SOAK_REF = 10;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface SStall {
  id: string;
  kind: StallView["kind"];
  traits: Traits;
  quotes: Quote[];
  stock: Record<string, number>;
  coins: number;
  soak: number;
  window: Record<string, { bought: number; sold: number }>;
  soaks: number;
  open: boolean;
  policy: Policy;
  lastOffers: OfferIn[];
}

export function simulate(opts: SimOptions = {}): SimResult {
  const days = opts.days ?? 7;
  const nBots = opts.bots ?? 20;
  const rand = rng(opts.seed ?? 42);
  const festival = new Set(opts.festivalDays ?? [3]);
  const blight = new Set(opts.blightDays ?? [5]);
  const ROUND = opts.roundMinutes ?? 5;
  const RENT = opts.rent ?? 0;
  const activity = opts.activity ?? 0.5;
  const stalls: SStall[] = SEED_STALLS.map((s) => {
    const quotes = s.goods.map((g) => ({ token_id: g, base: GOODS.find((x) => x.id === g)!.ref, spread_bps: 800, target: 20 }));
    return {
      id: s.slug,
      kind: s.kind,
      traits: s.traits,
      quotes,
      stock: Object.fromEntries(s.stock),
      coins: s.coins,
      soak: SOAK_REF,
      window: {},
      soaks: 0,
      open: true,
      lastOffers: [],
      policy: {
        bounds: [
          ...quotes.map((q) => ({ id: q.token_id, min: Math.max(1, Math.floor(q.base / 2)), max: q.base * 3 })),
          { id: "soak", min: 4, max: 32 },
        ],
        max_spread_bps: 3000,
        max_offer_qty: 40,
        min_update_ms: 0,
      },
    };
  });
  const bots = Array.from({ length: nBots }, () => ({ energy: 8, regen: 0, coins: 15, inv: { grass: 0, yuzu: 0, melon: 0 } as Record<string, number> }));
  const points: SimPoint[] = [];
  const events: { hour: number; text: string }[] = [];
  const summary = { trades: 0, soaks: 0, caravanUnits: 0, closures: 0, reopenings: 0 };
  let coinsInCirculation = stalls.reduce((a, s) => a + s.coins, 0) + nBots * 15;

  const toView = (s: SStall): StallView => ({
    stall_id: s.id, owner_id: "town", rotation_seq: "0", rotating: false, ready: true, open: s.open,
    name: s.id, kind: s.kind, look: 0, personality: "", coins: String(s.coins),
    quotes: s.quotes.map((q) => ({ ...q, stock: String(s.stock[q.token_id] ?? 0), bid: String(bidUnit(q, BigInt((s.stock[q.token_id] ?? 0) + 1))), ask: String(askUnit(q, BigInt(s.stock[q.token_id] ?? 0))) })),
    soak_price: s.soak, hats: [], listed: null, note: "", keeper_ms: "0", created_ms: "0",
    stats: { trades: 0, coins_volume: 0, soaks: s.soaks, hats: 0, usd_earned: 0, caravan_units: 0, caravan_coins: 0 },
    window: Object.entries(s.window).map(([token_id, w]) => ({ token_id, ...w })),
  });

  const minutes = days * 24 * 60;
  let caravan: Caravan = { round: 0, opens_ms: 0, closes_ms: 0, demand: [], offers: [], last_fills: [] };
  let lastFills: Fill[] = [];
  const openCaravan = (minute: number) => {
    const day = Math.floor(minute / 1440);
    caravan = {
      round: caravan.round + 1, opens_ms: minute, closes_ms: minute + ROUND, offers: [], last_fills: lastFills,
      demand: GOODS.map((g) => ({
        token_id: g.id,
        qty: Math.round((g.cmin + Math.floor(rand() * (g.cmax - g.cmin + 1))) * (g.id === "melon" && festival.has(day) ? 3 : 1)),
        max_price: Math.max(1, Math.round((g.ref * (80 + Math.floor(rand() * 81))) / 100)),
      })),
    };
  };
  openCaravan(0);

  for (let m = 0; m < minutes; m++) {
    const day = Math.floor(m / 1440);
    if (m % 1440 === 0) {
      if (festival.has(day)) events.push({ hour: m / 60, text: "Melon festival: the caravan wants three times the watermelon" });
      if (blight.has(day)) events.push({ hour: m / 60, text: "Yuzu blight: foraging yuzu yields half" });
    }
    // Each bot acts with probability `activity` per minute; energy regenerates 1 per 90 s.
    for (const b of bots) {
      b.regen += 1 / 1.5;
      while (b.regen >= 1) {
        b.regen -= 1;
        if (b.energy < 8) b.energy++;
      }
      if (rand() > activity) continue;
      if (b.energy === 0 || (b.energy <= 2 && b.coins > 40)) {
        const bath = stalls.find((s) => s.kind === "Bathhouse" && s.open && (s.stock.yuzu ?? 0) > 0);
        if (bath && b.coins >= bath.soak) {
          b.coins -= bath.soak;
          const burn = Math.floor(bath.soak / 10);
          bath.coins += bath.soak - burn;
          coinsInCirculation -= burn;
          bath.stock.yuzu -= 1;
          bath.soaks++;
          b.energy = 8;
          summary.soaks++;
        }
        continue;
      }
      // Forage the good with the best current bid (with some randomness).
      const best = GOODS.map((g) => {
        const bids = stalls.filter((s) => s.open).flatMap((s) => s.quotes.filter((q) => q.token_id === g.id).map((q) => bidUnit(q, BigInt((s.stock[g.id] ?? 0) + 1))));
        return { g, v: (Math.max(1, ...bids) * (g.min + g.max)) / 2 + rand() * 3 };
      }).sort((a, b) => b.v - a.v)[0].g;
      let qty = best.min + Math.floor(rand() * (best.max - best.min + 1));
      if (best.id === "yuzu" && blight.has(day)) qty = Math.max(0, Math.floor(qty / 2));
      b.inv[best.id] += qty;
      b.energy--;
      // Now and then a well-off bot buys a hat (materials paid in coins to the hatter).
      if (b.coins > 60 && rand() < 0.02) {
        const hatter = stalls.find((s) => s.kind === "Hatter" && s.open && (s.stock.yuzu ?? 0) >= 2);
        if (hatter) {
          hatter.stock.yuzu -= 2;
          b.coins -= 10;
          hatter.coins += 10;
        }
      }
      // Sell when holding a few: to the best bid, as many units as that stall can afford.
      for (const g of GOODS) {
        if (b.inv[g.id] < 3) continue;
        const affordable = stalls.filter((s) => {
          const q = s.quotes.find((x) => x.token_id === g.id);
          return s.open && q && (s.stock[g.id] ?? 0) < shelfCap(q) && s.coins >= bidUnit(q, BigInt((s.stock[g.id] ?? 0) + 1));
        });
        if (!affordable.length) continue;
        const bidOf = (s: SStall) => bidUnit(s.quotes.find((x) => x.token_id === g.id)!, BigInt((s.stock[g.id] ?? 0) + 1));
        const bestStall =
          rand() < 0.7
            ? affordable.reduce((a, b) => (bidOf(b) > bidOf(a) ? b : a))
            : affordable[Math.floor(rand() * affordable.length)];
        const q = bestStall.quotes.find((x) => x.token_id === g.id)!;
        let total = 0;
        let units = 0;
        while (units < b.inv[g.id] && (bestStall.stock[g.id] ?? 0) + units < shelfCap(q)) {
          const next = bidUnit(q, BigInt((bestStall.stock[g.id] ?? 0) + units + 1));
          if (total + next > bestStall.coins) break;
          total += next;
          units++;
        }
        if (units === 0) continue;
        bestStall.coins -= total;
        b.coins += total;
        bestStall.stock[g.id] = (bestStall.stock[g.id] ?? 0) + units;
        const w = (bestStall.window[g.id] ??= { bought: 0, sold: 0 });
        w.bought += units;
        b.inv[g.id] -= units;
        summary.trades++;
      }
    }

    // Keepers reprice every 5 minutes.
    if (m % 5 === 0) {
      const views = stalls.map(toView);
      for (const s of stalls) {
        if (!s.open) continue;
        const out = decide({ stall: toView(s), policy: s.policy, traits: s.traits, market: views, caravan: { ...caravan, closes_ms: Number.MAX_SAFE_INTEGER }, goods: [], hats: [], minFloat: MIN_FLOAT, memory: { soaks: s.soaks, hats: 0 }, lastOffers: s.lastOffers });
        s.quotes = out.decision.quotes;
        if (out.decision.soak_price !== undefined) s.soak = out.decision.soak_price;
        s.window = {};
        for (const o of out.offers) {
          if ((s.stock[o.token_id] ?? 0) < o.qty || caravan.offers.some((x) => x.stall_id === s.id && x.token_id === o.token_id)) continue;
          s.lastOffers = [...s.lastOffers.filter((x) => x.token_id !== o.token_id), o];
          s.stock[o.token_id] -= o.qty;
          caravan.offers.push({ stall_id: s.id, token_id: o.token_id, qty: o.qty, min_price: o.min_price, ms: m });
        }
      }
    }

    // Caravan settles every 3 minutes, with rent.
    if (m >= caravan.closes_ms) {
      lastFills = [];
      for (const d of caravan.demand) {
        const offers = caravan.offers.filter((o) => o.token_id === d.token_id).sort((a, b) => a.min_price - b.min_price || a.ms - b.ms);
        let remaining = d.qty;
        const accepted: { o: (typeof offers)[0]; take: number }[] = [];
        let clearing = 0;
        const cap = Math.max(1, Math.ceil(d.qty * 0.4));
        for (const o of offers) {
          if (remaining === 0 || o.min_price > d.max_price) break;
          const take = Math.min(o.qty, remaining, cap);
          if (take === 0) continue;
          remaining -= take;
          o.qty -= take;
          clearing = o.min_price;
          accepted.push({ o, take });
        }
        for (const { o, take } of accepted) {
          const s = stalls.find((x) => x.id === o.stall_id)!;
          s.coins += take * clearing;
          coinsInCirculation += take * clearing;
          summary.caravanUnits += take;
          lastFills.push({ stall_id: s.id, token_id: d.token_id, qty: take, price: clearing });
        }
      }
      for (const o of caravan.offers) if (o.qty > 0) stalls.find((x) => x.id === o.stall_id)!.stock[o.token_id] += o.qty;
      for (const s of stalls) {
        const due = Math.min(s.coins, RENT);
        s.coins -= due;
        coinsInCirculation -= due;
        const open = s.coins >= MIN_FLOAT;
        if (s.open && !open) {
          summary.closures++;
          events.push({ hour: m / 60, text: `${s.id} ran out of coins and closed` });
        }
        if (!s.open && open) summary.reopenings++;
        s.open = open;
      }
      // A kind investor reopens closed stalls once a day.
      if (m % 1440 === 720) {
        for (const s of stalls.filter((x) => !x.open)) {
          s.coins += 40;
          coinsInCirculation += 40;
          s.open = true;
          summary.reopenings++;
          events.push({ hour: m / 60, text: `A player invested 40 coins and reopened ${s.id}` });
        }
      }
      for (const s of stalls) s.lastOffers = s.lastOffers.filter(() => false);
      openCaravan(m);
    }

    if (m % 60 === 0) {
      const prices: Record<string, number> = {};
      for (const g of GOODS) {
        const bids = stalls.filter((s) => s.open).flatMap((s) => s.quotes.filter((q) => q.token_id === g.id).map((q) => bidUnit(q, BigInt((s.stock[g.id] ?? 0) + 1))));
        prices[g.id] = bids.length ? bids.reduce((a, b) => a + b, 0) / bids.length : 0;
      }
      points.push({
        hour: m / 60,
        prices,
        coins: coinsInCirculation,
        openStalls: stalls.filter((s) => s.open).length,
        stallCoins: Object.fromEntries(stalls.map((s) => [s.id, s.coins])),
      });
    }
  }
  return { points, events, summary };
}
