// The rule-based capybara shopkeeper. Deterministic, so judges can run the town without any
// AI key. The optional LLM keeper (packages/scripts/src/llm.ts) starts from this decision and
// may change it, but the result is always clamped to the owner's policy before signing.

import type { Quote } from "./price";
import type {
  Caravan,
  GoodInfo,
  HatInfo,
  KeeperDecision,
  OfferIn,
  Policy,
  StallView,
} from "./types";
import { GOOD_NAME, type Traits } from "./town";

export interface KeeperMemory {
  soaks: number;
  hats: number;
}

export interface KeeperInput {
  stall: StallView;
  policy: Policy;
  traits: Traits;
  market: StallView[];
  caravan: Caravan;
  goods: GoodInfo[];
  hats: HatInfo[];
  minFloat: number;
  memory?: KeeperMemory;
}

export interface KeeperOutput {
  decision: KeeperDecision;
  offers: OfferIn[];
  memory: KeeperMemory;
  changed: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function boundOf(policy: Policy, id: string): { min: number; max: number } {
  const b = policy.bounds.find((x) => x.id === id);
  return b ? { min: Number(b.min), max: Number(b.max) } : { min: 1, max: 10_000 };
}

/** Clamp any decision (rules or LLM) to the owner's policy, the same checks the stall enforces. */
export function clampToPolicy(d: KeeperDecision, policy: Policy): KeeperDecision {
  return {
    quotes: d.quotes.map((q) => {
      const b = boundOf(policy, q.token_id);
      return {
        token_id: q.token_id,
        base: Math.round(clamp(q.base, b.min, b.max)),
        spread_bps: Math.round(clamp(q.spread_bps, 0, policy.max_spread_bps)),
        target: Math.round(clamp(q.target, 1, 500)),
      };
    }),
    soak_price:
      d.soak_price === undefined
        ? undefined
        : Math.round(clamp(d.soak_price, boundOf(policy, "soak").min, boundOf(policy, "soak").max)),
    hat_prices: d.hat_prices?.map((h) => {
      const b = boundOf(policy, h.hat_id);
      return { hat_id: h.hat_id, price_usd: String(Math.round(clamp(Number(h.price_usd), b.min, b.max))) };
    }),
    note: d.note.slice(0, 240),
  };
}

export function decide(input: KeeperInput): KeeperOutput {
  const { stall, policy, traits, market, caravan, goods, hats, minFloat } = input;
  const coins = Number(stall.coins);
  const poor = coins < minFloat * 3;
  const reasons: { weight: number; text: string }[] = [];
  const quotes: Quote[] = [];

  for (const q of stall.quotes) {
    const stock = Number(q.stock);
    const target = Math.max(4, Math.round(20 * traits.hoard));
    const w = stall.window.find((x) => x.token_id === q.token_id) ?? { bought: 0, sold: 0 };
    const pressure = w.sold - w.bought;
    let base = q.base;
    let delta = 0;
    if (stock > target * 1.5) delta -= traits.step;
    if (stock < target * 0.5) delta += traits.step;
    if (pressure >= 3) delta += traits.step;
    if (pressure <= -5) delta -= traits.step;
    if (poor) delta -= traits.step * 2; // stop buying so much when the till is nearly empty
    const export_ = caravan.demand.find((d) => d.token_id === q.token_id);
    if (export_ && stock > target && export_.max_price < Math.ceil(q.base * traits.offerMarkup)) delta -= traits.step;
    base += delta;
    const rivals = market.filter((m) => m.stall_id !== stall.stall_id && m.open);
    const rivalBases = rivals.flatMap((m) => m.quotes.filter((x) => x.token_id === q.token_id).map((x) => x.base));
    if (rivalBases.length && traits.follow > 0) {
      const avg = rivalBases.reduce((a, b) => a + b, 0) / rivalBases.length;
      base = base * (1 - traits.follow) + avg * traits.follow;
    }
    const b = boundOf(policy, q.token_id);
    base = Math.round(clamp(base, b.min, b.max));
    let spread = traits.margin;
    if (poor) spread = Math.round(spread * 1.5);
    spread = clamp(spread, 0, policy.max_spread_bps);
    const next: Quote = { token_id: q.token_id, base, spread_bps: spread, target };
    quotes.push(next);
    const name = GOOD_NAME[q.token_id] ?? q.token_id;
    if (base < q.base) {
      reasons.push({ weight: q.base - base + (stock > target * 1.5 ? 1 : 0), text: voiceDown(traits, name, stock, base, rivalBases.length > 0) });
    } else if (base > q.base) {
      reasons.push({ weight: base - q.base + (pressure >= 3 ? 1 : 0), text: voiceUp(traits, name, stock, base, pressure) });
    }
  }

  // Bathhouse: price soaks by yuzu on hand and how busy the spring has been.
  let soak_price: number | undefined;
  const mem: KeeperMemory = { soaks: stall.stats.soaks, hats: stall.stats.hats };
  if (stall.kind === "Bathhouse") {
    const yuzu = Number(stall.quotes.find((q) => q.token_id === "yuzu")?.stock ?? 0);
    const recent = stall.stats.soaks - (input.memory?.soaks ?? stall.stats.soaks);
    let p = stall.soak_price;
    if (yuzu < 4) p += 2;
    else if (yuzu > 15 && recent === 0) p -= 1;
    if (recent >= 3) p += 1;
    const b = boundOf(policy, "soak");
    p = Math.round(clamp(p, b.min, b.max));
    if (p !== stall.soak_price) {
      reasons.push({
        weight: 3,
        text:
          p > stall.soak_price
            ? yuzu < 4
              ? `Only ${yuzu} yuzu left for the bath! Soaks are ${p} coins until someone brings more.`
              : `The spring is packed today. Soaks go up to ${p} coins.`
            : `Quiet day at the spring. Soaks down to ${p} coins, come relax.`,
      });
    }
    soak_price = p;
  }

  // Hatter: follow what is selling.
  let hat_prices: { hat_id: string; price_usd: string }[] | undefined;
  if (stall.kind === "Hatter") {
    const sold = stall.stats.hats - (input.memory?.hats ?? stall.stats.hats);
    hat_prices = stall.hats.map((h) => {
      let p = Number(h.price_usd);
      if (sold >= 2) p = Math.round(p * 1.1);
      else if (sold === 0 && !h.in_stock) p = Math.round(p * 1.05);
      const b = boundOf(policy, h.hat_id);
      return { hat_id: h.hat_id, price_usd: String(Math.round(clamp(p, b.min, b.max))) };
    });
    if (sold >= 2) reasons.push({ weight: 2, text: `Hats are trending! Everything up 10%.` });
    const info = hats.find((h) => stall.hats.some((x) => x.hat_id === h.id && !x.in_stock));
    if (info) {
      const need = info.recipe.map((r) => GOOD_NAME[r.token_id] ?? r.token_id).join(" and ");
      reasons.push({ weight: 1, text: `Out of ${need} for the ${info.name}. Paying a bit more for it.` });
    }
  }

  // Caravan: sell surplus above target, never below the keeper's markup or the owner's floor.
  const offers: OfferIn[] = [];
  if (stall.kind === "Grocer" && Date.now() < caravan.closes_ms) {
    for (const q of quotes) {
      const d = caravan.demand.find((x) => x.token_id === q.token_id);
      const stock = Number(stall.quotes.find((x) => x.token_id === q.token_id)?.stock ?? 0);
      const already = caravan.offers.some((o) => o.stall_id === stall.stall_id && o.token_id === q.token_id);
      // A nearly broke keeper sells deeper into its stock and accepts less, to raise cash.
      const surplus = poor ? stock - Math.floor(q.target / 2) : stock - q.target;
      if (!d || already || surplus <= 0) continue;
      const floor = boundOf(policy, q.token_id).min;
      const markup = poor ? Math.min(traits.offerMarkup, 0.8) : traits.offerMarkup;
      const minPrice = Math.max(floor, Math.ceil(q.base * markup));
      if (minPrice > d.max_price) continue;
      const qty = Math.min(surplus, policy.max_offer_qty, d.qty);
      offers.push({ token_id: q.token_id, qty, min_price: minPrice });
    }
    if (offers.length) {
      const o = offers[0];
      reasons.push({
        weight: 0.5,
        text: `Sending ${o.qty} ${GOOD_NAME[o.token_id] ?? o.token_id} to the caravan at ${o.min_price}+ coins each.`,
      });
    }
  }

  if (poor) reasons.push({ weight: 4, text: poorNote(traits, coins) });

  const changed =
    quotes.some((q, i) => q.base !== stall.quotes[i].base || q.spread_bps !== stall.quotes[i].spread_bps || q.target !== stall.quotes[i].target) ||
    (soak_price !== undefined && soak_price !== stall.soak_price) ||
    (hat_prices?.some((h) => stall.hats.find((x) => x.hat_id === h.hat_id)?.price_usd !== h.price_usd) ?? false);

  reasons.sort((a, b) => b.weight - a.weight);
  const note = reasons[0]?.text ?? steadyNote(traits);
  void goods;
  return { decision: { quotes, soak_price, hat_prices, note }, offers, memory: mem, changed };
}

function voiceDown(t: Traits, name: string, stock: number, base: number, followed: boolean): string {
  switch (t.voice) {
    case "cheerful":
      return `So much ${name} today (${stock} on the shelf)! Dropping it to ${base} coins, tell your friends!`;
    case "grumpy":
      return `Fine. FINE. ${cap(name)} down to ${base}. Don't get used to it.`;
    case "follower":
      return followed ? `Everyone else is cheaper on ${name}, so I am too: ${base} coins.` : `${cap(name)} down to ${base}, I think?`;
    case "hoarder":
      return `The barn is full of ${name}. ${base} coins, take as much as you like.`;
    default:
      return `${cap(name)} down to ${base} coins: we have plenty (${stock}).`;
  }
}

function voiceUp(t: Traits, name: string, stock: number, base: number, pressure: number): string {
  const why = stock < 5 ? `only ${stock} left` : pressure >= 3 ? `everyone wants it` : `stock is low`;
  switch (t.voice) {
    case "cheerful":
      return `Ooh, ${name} is popular (${why})! ${base} coins now.`;
    case "grumpy":
      return `Hmph. ${cap(name)}: ${why}. Price goes UP to ${base}.`;
    case "follower":
      return `The others raised ${name}, so... ${base} coins.`;
    case "hoarder":
      return `${cap(name)} is getting scarce (${why}). ${base} coins and not a coin less.`;
    default:
      return `${cap(name)} up to ${base} coins: ${why}.`;
  }
}

function poorNote(t: Traits, coins: number): string {
  switch (t.voice) {
    case "follower":
      return `Uh oh, only ${coins} coins left in the till. Buying less until someone invests...`;
    case "grumpy":
      return `Till's nearly empty (${coins} coins). I'm not paying full price for anything.`;
    default:
      return `Running low on coins (${coins}). Buying carefully for now.`;
  }
}

function steadyNote(t: Traits): string {
  switch (t.voice) {
    case "cheerful":
      return "Prices are just right today! Come say hi.";
    case "grumpy":
      return "Prices stay where they are. Don't ask.";
    case "hoarder":
      return "Steady as the river. No changes.";
    case "bath":
      return "The water is perfect. Same prices as before.";
    case "fashion":
      return "This season's hats are holding their value.";
    default:
      return "Prices unchanged.";
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
