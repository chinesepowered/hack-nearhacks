import { useMemo, useState } from "react";
import { GOOD_EMOJI, GOOD_NAME, simulate, usd, type Caravan, type FeedItem, type StatsView, type TxRecord } from "@capy/core";
import { dep, short } from "../near";
import { useNow } from "../useTown";
import { useToasts } from "./Toasts";

export function CaravanBoard({ caravan }: { caravan?: Caravan }) {
  const now = useNow();
  if (!caravan) return <p className="muted">Waiting for the caravan…</p>;
  const left = Math.max(0, Math.round((caravan.closes_ms - now) / 1000));
  return (
    <div className="caravan">
      <p>
        <b>Round {caravan.round}</b> · {left > 0 ? `the caravan leaves in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "packing up…"}
      </p>
      <p className="small muted">
        Each round a caravan buys goods from the shopkeepers. They bid against each other (lowest price first, everyone paid the same clearing
        price, no stall more than 40% of the order). It's how new coins enter town.
      </p>
      <table className="prices">
        <thead>
          <tr>
            <th>Wants</th>
            <th>Up to</th>
            <th>Offers so far</th>
          </tr>
        </thead>
        <tbody>
          {caravan.demand.map((d) => {
            const offers = caravan.offers.filter((o) => o.token_id === d.token_id).sort((a, b) => a.min_price - b.min_price);
            return (
              <tr key={d.token_id}>
                <td>
                  {d.qty} {GOOD_EMOJI[d.token_id]} {GOOD_NAME[d.token_id]}
                </td>
                <td>{d.max_price}🪙 each</td>
                <td className="small">{offers.length ? offers.map((o) => `${short(o.stall_id)} ${o.qty}@${o.min_price}+`).join(", ") : "none yet"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {caravan.last_fills.length > 0 && (
        <p className="small">
          Last round: {caravan.last_fills.map((f) => `${short(f.stall_id)} sold ${f.qty} ${GOOD_EMOJI[f.token_id]} at ${f.price}🪙`).join(" · ")}
        </p>
      )}
    </div>
  );
}

const FEED_ICON: Record<string, string> = {
  join: "👋",
  forage: "🧺",
  sell: "💰",
  buy: "🛒",
  soak: "♨️",
  hat: "🎩",
  deposit: "💵",
  reprice: "🏷️",
  offer: "🐫",
  caravan: "🐫",
  invest: "🌱",
  list: "📜",
  stall_sold: "🤝",
  stall_given: "🎁",
  stall_open: "🏪",
  withdraw: "🪙",
  sale_failed: "⚠️",
};

function feedText(f: FeedItem): string {
  const who = short(f.actor);
  const st = f.stall ? short(f.stall) : "";
  const t = f.token_id ? `${GOOD_EMOJI[f.token_id] ?? ""} ${GOOD_NAME[f.token_id] ?? f.token_id}` : "";
  switch (f.kind) {
    case "join":
      return `${who} moved into town`;
    case "forage":
      return `${who} foraged ${f.qty} ${t}`;
    case "sell":
      return `${who} sold ${f.qty} ${t} to ${st} for ${f.coins}🪙`;
    case "buy":
      return `${who} bought ${f.qty} ${t} from ${st} for ${f.coins}🪙`;
    case "soak":
      return `${who} soaked at ${st} (${f.coins}🪙)`;
    case "hat":
      return `${who} bought a ${t} for ${usd(f.usd)}`;
    case "deposit":
      return `${who} topped up ${usd(f.usd)} test USDC`;
    case "reprice":
      return `${st}'s keeper repriced`;
    case "offer":
      return `${st} offered ${f.qty} ${t} to the caravan at ${f.coins}🪙+`;
    case "caravan":
      return `the caravan left with ${f.qty} goods (${f.coins}🪙 paid)`;
    case "invest":
      return `${who} invested ${f.coins}🪙 in ${st}`;
    case "list":
      return `${st} listed for ${usd(f.usd)}`;
    case "stall_sold":
      return `${who} bought ${st} for ${usd(f.usd)}`;
    case "stall_given":
      return `${st} changed hands`;
    case "stall_open":
      return `${st} opened`;
    case "withdraw":
      return `${who} took ${f.coins}🪙 from ${st}`;
    default:
      return `${f.kind} ${who}`;
  }
}

export function Feed({ feed }: { feed: FeedItem[] }) {
  const now = useNow(5_000);
  const items = feed.filter((f) => f.kind !== "reprice").slice(0, 25);
  return (
    <ul className="feed">
      {items.map((f) => (
        <li key={f.seq}>
          <span className="feed-icon">{FEED_ICON[f.kind] ?? "•"}</span>
          <span>{feedText(f)}</span>
          <span className="small muted">{Math.max(0, Math.round((now - f.ms) / 1000))}s</span>
        </li>
      ))}
    </ul>
  );
}

export function Usage({ stats, txs }: { stats?: StatsView; txs: TxRecord[] }) {
  const { showTx } = useToasts();
  const s = stats?.stats;
  return (
    <div className="usage">
      <p className="small muted">
        Everything below is on NEAR testnet right now. Mainnet uses the same contracts with real USDC; gas per action is the same.
      </p>
      {s && (
        <div className="kpis">
          <div>
            <b>{s.players}</b>
            <span>player accounts</span>
          </div>
          <div>
            <b>{s.stalls}</b>
            <span>stall accounts</span>
          </div>
          <div>
            <b>{s.actions}</b>
            <span>on-chain actions</span>
          </div>
          <div>
            <b>{usd(s.usd_volume)}</b>
            <span>test-USDC volume</span>
          </div>
          <div>
            <b>{s.hats}</b>
            <span>hats sold</span>
          </div>
          <div>
            <b>{s.stall_sales}</b>
            <span>stalls resold</span>
          </div>
        </div>
      )}
      <h4>Your transactions this session ({txs.length})</h4>
      <ul className="txs">
        {[...txs].reverse().slice(0, 12).map((t) => (
          <li key={t.hash}>
            <button className="link mono" onClick={() => showTx(t.hash)}>
              {t.method} · {t.hash.slice(0, 10)}…
            </button>
          </li>
        ))}
      </ul>
      <p className="small muted">
        Contracts: <span className="mono">{dep.bazaar}</span> (goods + stall NFTs), <span className="mono">{dep.tusdc}</span> (test USDC); stall code is
        global contract <span className="mono">{dep.stallCodeHash.slice(0, 10)}…</span>
      </p>
    </div>
  );
}

const COLORS: Record<string, string> = { grass: "#5aa25a", yuzu: "#e8b10f", melon: "#e35d6a" };

export function FastForward() {
  const [seed, setSeed] = useState(42);
  const [ran, setRan] = useState(false);
  const result = useMemo(() => (ran ? simulate({ days: 7, bots: 6, seed }) : null), [ran, seed]);
  const W = 560;
  const H = 200;
  const pts = result?.points ?? [];
  // Scale to the week after a short warm-up, so the opening transient doesn't flatten the chart.
  const maxY = Math.max(4, ...pts.filter((p) => p.hour >= 3).flatMap((p) => Object.values(p.prices)));
  const x = (h: number) => (h / (7 * 24)) * W;
  const y = (v: number) => H - (v / maxY) * (H - 10);
  return (
    <div className="ff">
      <p className="small muted">
        Simulates a week of Yuzu Springs with 6 townsfolk, using the same price curve and keeper rules as the contracts. Day 3 has a melon
        festival (the caravan wants 3x the watermelon), day 5 a yuzu blight (foraging yields half).
      </p>
      <div className="row">
        <button className="primary" onClick={() => (ran ? setSeed((s) => s + 1) : setRan(true))}>
          {ran ? "Run another week" : "Fast-forward a week"}
        </button>
        {result && (
          <span className="small">
            {result.summary.trades} trades · {result.summary.caravanUnits} goods exported · {result.summary.closures} closures, {result.summary.reopenings} reopenings
          </span>
        )}
      </div>
      {result && (
        <svg viewBox={`0 0 ${W} ${H + 24}`} width="100%" role="img" aria-label="average buy price per good over a simulated week">
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <line key={d} x1={x(d * 24)} x2={x(d * 24)} y1={0} y2={H} stroke="#00000012" />
          ))}
          {Object.keys(COLORS).map((g) => (
            <polyline key={g} fill="none" stroke={COLORS[g]} strokeWidth={2} points={pts.filter((p) => p.hour >= 3).map((p) => `${x(p.hour)},${y(Math.min(maxY, p.prices[g] ?? 0))}`).join(" ")} />
          ))}
          {result.events
            .filter((e) => !e.text.includes("ran out") && !e.text.includes("invested"))
            .map((e, i) => (
              <g key={i}>
                <line x1={x(e.hour)} x2={x(e.hour)} y1={0} y2={H} stroke="#7a5cff" strokeDasharray="3 3" />
              </g>
            ))}
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <text key={d} x={x(d * 24) + 4} y={H + 16} fontSize="11" fill="#7a6a5a">
              day {d + 1}
            </text>
          ))}
        </svg>
      )}
      {result && (
        <div className="legend small">
          {Object.entries(COLORS).map(([g, c]) => (
            <span key={g}>
              <i style={{ background: c }} /> {GOOD_NAME[g]} (avg. buy price)
            </span>
          ))}
          <span>
            <i style={{ background: "#7a5cff" }} /> festival / blight
          </span>
        </div>
      )}
    </div>
  );
}
