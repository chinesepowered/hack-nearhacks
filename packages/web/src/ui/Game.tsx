import { useEffect, useMemo, useState } from "react";
import { GOOD_EMOJI, GOOD_NAME, usd, type TxRecord } from "@capy/core";
import { Capybara, FURS } from "../art/Capybara";
import { clearSession, explainError, playerFor, requestTopUp, type Session } from "../near";
import { useNow, useTown } from "../useTown";
import { useToasts } from "./Toasts";
import { Village } from "./Village";
import { StallPanel } from "./StallPanel";
import { CaravanBoard, FastForward, Feed, Usage } from "./Side";

const SPOTS = [
  { spot: "meadow", good: "grass", label: "Meadow", hint: "2–4 sweet grass" },
  { spot: "grove", good: "yuzu", label: "Yuzu grove", hint: "1–3 yuzu" },
  { spot: "field", good: "melon", label: "Melon field", hint: "1–2 watermelon" },
];

type Tab = "caravan" | "feed" | "usage" | "ff";

export function Game({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const player = useMemo(() => playerFor(session), [session]);
  const { town, refresh } = useTown(session.accountId);
  const { push } = useToasts();
  const now = useNow(500);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("feed");
  const [busy, setBusy] = useState(false);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  useEffect(() => {
    player.onTx = () => setTxs([...player.txs]);
  }, [player]);

  const me = town.me;
  const bal = (t: string) => Number(me?.balances.find((b) => b.token_id === t)?.amount ?? 0);
  const readyIn = me ? Math.max(0, Number(me.forage_ready_ms) - now) : 0;
  const stall = town.stalls.find((s) => s.stall_id === open);

  async function forage(spot: string, good: string) {
    setBusy(true);
    try {
      const r = await player.forage(spot);
      push({ kind: "ok", text: `Foraged ${r.qty} ${GOOD_EMOJI[good]} ${GOOD_NAME[good]}! (${r.energy} energy left)`, hash: player.txs.at(-1)?.hash });
      await refresh();
    } catch (e) {
      push({ kind: "err", text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function topUp() {
    try {
      await requestTopUp(session.accountId);
      push({ kind: "ok", text: "+$5 test USDC (no value, testnet only)" });
      await refresh();
    } catch (e) {
      push({ kind: "err", text: explainError(e) });
    }
  }

  if (!me) {
    return (
      <main className="loading">
        <Capybara size={140} mood="sleepy" />
        <p>{town.error ? `Can't reach testnet: ${town.error}` : "Waking up in Yuzu Springs…"}</p>
        {town.loadedAt > 0 && me === null && (
          <button
            onClick={() => {
              clearSession();
              onLeave();
            }}
          >
            This capybara doesn't live here anymore. Start over
          </button>
        )}
      </main>
    );
  }

  const nextEnergy = Number(me.next_energy_ms) ? Math.max(0, Math.round((Number(me.next_energy_ms) - now) / 1000)) : 0;
  const goods = ["grass", "yuzu", "melon"];
  const hats = me.balances.filter((b) => b.token_id.startsWith("hat-"));

  return (
    <div className="game">
      <header className="hud">
        <div className="me">
          <Capybara size={64} fur={FURS[7]} hat={me.hat} mood={me.energy > 2 ? "happy" : "sleepy"} />
          <div>
            <div className="me-name">{me.name}</div>
            <div className="small mono muted" title={me.account_id}>
              {me.account_id.split(".")[0]}.bazaar…
            </div>
          </div>
        </div>
        <div className="energy" title={nextEnergy ? `+1 energy in ${nextEnergy}s` : "full"}>
          <span className="small">Energy</span>
          <div className="bar">
            {Array.from({ length: me.energy_max }, (_, i) => (
              <i key={i} className={i < me.energy ? "on" : ""} />
            ))}
          </div>
          {nextEnergy > 0 && <span className="small muted">+1 in {nextEnergy}s</span>}
        </div>
        <div className="wallet">
          <span className="coin">{bal("coin")} 🪙</span>
          <span className="usd">{usd(me.usd)} tUSDC</span>
          <button className="ghost small-btn" onClick={topUp} title="Get $5 of test USDC (no value)">
            +$5
          </button>
        </div>
        <div className="inventory">
          {goods.map((g) => (
            <span key={g} className="chip" title={GOOD_NAME[g]}>
              {GOOD_EMOJI[g]} {bal(g)}
            </span>
          ))}
          {hats.map((h) => (
            <button
              key={h.token_id}
              className={`chip hat-chip ${me.hat === h.token_id ? "worn" : ""}`}
              title={`${GOOD_NAME[h.token_id]} (click to wear)`}
              onClick={() => player.equipHat(me.hat === h.token_id ? null : h.token_id).then(refresh).catch((e) => push({ kind: "err", text: explainError(e) }))}
            >
              {GOOD_EMOJI[h.token_id]}🎩
            </button>
          ))}
        </div>
      </header>

      <div className="forage-bar" aria-label="Forage">
        {SPOTS.map((s) => (
          <button key={s.spot} className="forage" disabled={busy || me.energy === 0 || readyIn > 0} onClick={() => forage(s.spot, s.good)}>
            <span className="forage-emoji">{GOOD_EMOJI[s.good]}</span>
            <span>
              <b>{s.label}</b>
              <span className="small muted"> {s.hint}</span>
            </span>
          </button>
        ))}
        {me.energy === 0 && <span className="hint">Out of energy: soak at The Big Soak ♨️</span>}
        {readyIn > 0 && me.energy > 0 && <span className="hint small muted">foraging… {Math.ceil(readyIn / 1000)}s</span>}
      </div>

      <div className="main">
        <Village stalls={town.stalls} me={me} onOpen={setOpen} />
        <div className="side">
          {stall ? (
            <StallPanel s={stall} me={me} player={player} config={town.config} loadedAt={town.loadedAt} onClose={() => setOpen(null)} refresh={refresh} />
          ) : (
            <aside className="panel">
              <nav className="tabs" role="tablist">
                {(
                  [
                    ["feed", "Town feed"],
                    ["caravan", "Caravan"],
                    ["usage", "On-chain"],
                    ["ff", "Fast-forward"],
                  ] as [Tab, string][]
                ).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                    {label}
                  </button>
                ))}
              </nav>
              {tab === "feed" && <Feed feed={town.feed} />}
              {tab === "caravan" && <CaravanBoard caravan={town.caravan} />}
              {tab === "usage" && <Usage stats={town.stats} txs={txs} />}
              {tab === "ff" && <FastForward />}
              <p className="small muted tip">Tip: click a stall to trade, soak, buy hats, or buy the stall itself.</p>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
