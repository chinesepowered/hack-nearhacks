// Optional LLM shopkeeper. Any OpenAI-compatible endpoint works: OpenAI, OpenRouter, a local
// Ollama (http://localhost:11434/v1), or NEAR AI Cloud (https://cloud-api.near.ai/v1).
//
//   OPENAI_BASE_URL  e.g. http://localhost:11434/v1   (defaults to OpenAI if only a key is set)
//   OPENAI_API_KEY   not needed for a local Ollama
//   OPENAI_MODEL     e.g. qwen2.5:3b, gpt-4o-mini
//   LLM_MAX_CALLS    hard cap per run (default 300), so nothing can run up a bill
//
// The model only proposes. Its answer is merged with the rule-based decision, clamped to the
// owner's policy here, and checked again by the stall contract before anything changes on chain.

import type { KeeperDecision, Policy, StallView, Caravan } from "@capy/core";

const BASE = (process.env.OPENAI_BASE_URL ?? (process.env.OPENAI_API_KEY ? "https://api.openai.com/v1" : "")).replace(/\/$/, "");
const KEY = process.env.OPENAI_API_KEY ?? "";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const MAX_CALLS = Number(process.env.LLM_MAX_CALLS ?? 300);
let calls = 0;

export function llmEnabled(): boolean {
  return BASE !== "" && calls < MAX_CALLS;
}

export function llmLabel(): string {
  return BASE ? `${MODEL} via ${BASE}` : "off (rule-based keepers)";
}

export async function llmDecide(
  stall: StallView,
  personality: string,
  rivals: StallView[],
  caravan: Caravan,
  policy: Policy,
  suggestion: KeeperDecision,
): Promise<KeeperDecision | null> {
  if (!llmEnabled()) return null;
  calls += 1;
  const state = {
    stall: stall.name,
    kind: stall.kind,
    coins: Number(stall.coins),
    goods: stall.quotes.map((q) => ({ good: q.token_id, base: q.base, spread_bps: q.spread_bps, target: q.target, stock: Number(q.stock), bid_now: Number(q.bid), ask_now: Number(q.ask) })),
    since_last_reprice: stall.window,
    soak_price: stall.kind === "Bathhouse" ? stall.soak_price : undefined,
    rivals: rivals.filter((r) => r.stall_id !== stall.stall_id).map((r) => ({ stall: r.name, open: r.open, bases: Object.fromEntries(r.quotes.map((q) => [q.token_id, q.base])) })),
    caravan_wants: caravan.demand,
    owner_limits: policy.bounds,
    rule_based_suggestion: suggestion,
  };
  const body = {
    model: MODEL,
    temperature: 0.7,
    max_tokens: 350,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are ${stall.name}, a capybara shopkeeper in the hot-spring town of Yuzu Springs. Personality: ${personality}. You decide today's prices. Reply with JSON only.`,
      },
      {
        role: "user",
        content:
          `Your shop right now:\n${JSON.stringify(state)}\n\n` +
          `Return {"quotes":[{"token_id":string,"base":number,"spread_bps":number,"target":number}],` +
          (stall.kind === "Bathhouse" ? `"soak_price":number,` : "") +
          `"note":string}. Keep every base inside owner_limits and change each base by at most 2 coins. ` +
          `"note" is one short sentence (max 140 characters) in your own voice telling customers what you changed and why.`,
      },
    ],
  };
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as Partial<KeeperDecision>;
    const quotes = suggestion.quotes.map((sq) => {
      const mq = parsed.quotes?.find((q) => q.token_id === sq.token_id);
      const cur = stall.quotes.find((q) => q.token_id === sq.token_id)!;
      if (!mq || typeof mq.base !== "number") return sq;
      return {
        token_id: sq.token_id,
        base: Math.round(Math.min(cur.base + 2, Math.max(cur.base - 2, mq.base))),
        spread_bps: typeof mq.spread_bps === "number" ? Math.round(mq.spread_bps) : sq.spread_bps,
        target: typeof mq.target === "number" ? Math.round(mq.target) : sq.target,
      };
    });
    const note = typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim().slice(0, 140) : suggestion.note;
    return {
      quotes,
      soak_price: typeof parsed.soak_price === "number" ? Math.round(parsed.soak_price) : suggestion.soak_price,
      hat_prices: suggestion.hat_prices,
      note,
    };
  } catch (e) {
    console.warn(`[llm] ${stall.name}: ${String(e).slice(0, 160)}; using the rule-based decision`);
    return null;
  }
}
