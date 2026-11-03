import { useEffect, useRef, useState } from "react";
import {
  GOOD_EMOJI,
  GOOD_NAME,
  sellTotal,
  shelfCap,
  usd,
  type NftItemInfo,
  type PlayerView,
  type StallState,
  type StallView,
  type TownPlayer,
  type ConfigView,
} from "@capy/core";
import { Capybara, FURS } from "../art/Capybara";
import { explainError, reader, short } from "../near";
import { keeperMood } from "./Village";
import { useToasts } from "./Toasts";

export function StallPanel({
  s,
  me,
  player,
  config,
  loadedAt,
  onClose,
  refresh,
}: {
  s: StallView;
  me?: PlayerView | null;
  player: TownPlayer;
  config?: ConfigView;
  loadedAt: number;
  onClose: () => void;
  refresh: () => Promise<void>;
}) {
  const { push } = useToasts();
  const [busy, setBusy] = useState("");
  const [item, setItem] = useState<NftItemInfo | null>(null);
  const [state, setState] = useState<StallState | null>(null);
  const [earned, setEarned] = useState("0");
  const [listPrice, setListPrice] = useState("5.00");
  const mine = me?.account_id === s.owner_id;

  // Refresh the stall account's own view on every town refresh. Results for a stall the panel
  // no longer shows are dropped; slow reads are never cancelled by the next refresh.
  const shown = useRef(s.stall_id);
  shown.current = s.stall_id;
  useEffect(() => {
    const id = s.stall_id;
    Promise.all([reader.itemInfo(id), reader.stallState(id), reader.tusdcBalance(id)])
      .then(([i, st, bal]) => {
        if (shown.current !== id) return;
        setItem(i);
        setState(st);
        setEarned(bal);
      })
      .catch(() => undefined);
  }, [s.stall_id, loadedAt]);

  const bal = (t: string) => Number(me?.balances.find((b) => b.token_id === t)?.amount ?? 0);

  async function run(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    try {
      await fn();
      push({ kind: "ok", text: done, hash: player.txs.at(-1)?.hash });
      await refresh();
    } catch (e) {
      push({ kind: "err", text: explainError(e) });
    } finally {
      setBusy("");
    }
  }

  const ago = Number(s.keeper_ms) ? Math.max(0, Math.round((Date.now() - Number(s.keeper_ms)) / 1000)) : null;
  const hatRef = (id: string) => config?.hats.find((h) => h.id === id);
  const materials = (id: string) =>
    hatRef(id)?.recipe.reduce((a, r) => a + r.qty * (config?.goods.find((g) => g.id === r.token_id)?.ref_price ?? 1), 0) ?? 0;

  return (
    <aside className="panel" aria-label={s.name}>
      <div className="panel-head">
        <div className="keeper">
          <Capybara size={92} fur={FURS[s.look % FURS.length]} mood={keeperMood(s)} hat={s.kind === "Hatter" ? "hat-lily" : null} />
        </div>
        <div>
          <h2>{s.name}</h2>
          <p className="small muted">
            {s.kind} · owned by <b>{mine ? "you" : short(s.owner_id)}</b>
            {!s.open && <span className="tag closed-tag">closed: out of coins</span>}
          </p>
          {s.note && (
            <p className="speech">
              “{s.note}”<span className="small muted"> {ago !== null ? `· ${ago}s ago` : ""}</span>
            </p>
          )}
        </div>
        <button className="icon" onClick={onClose} aria-label="close">
          ✕
        </button>
      </div>

      {s.quotes.length > 0 && (
        <section>
          <h3>Market</h3>
          <table className="prices">
            <thead>
              <tr>
                <th>Good</th>
                <th>Stock</th>
                <th>Sells at</th>
                <th>Buys at</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.quotes.map((q) => {
                const have = bal(q.token_id);
                const room = Math.max(0, shelfCap(q) - Number(q.stock));
                const n = Math.min(have, room, config?.config.max_trade_units ?? 30);
                const est = n > 0 ? sellTotal(q, BigInt(q.stock), n) : 0;
                return (
                  <tr key={q.token_id}>
                    <td>
                      {GOOD_EMOJI[q.token_id]} {GOOD_NAME[q.token_id]}
                    </td>
                    <td>
                      {q.stock}
                      {room === 0 && <span className="small muted"> full</span>}
                    </td>
                    <td>{q.ask}🪙</td>
                    <td>{q.bid}🪙</td>
                    <td className="actions">
                      <button
                        disabled={!s.open || n === 0 || !!busy || est > Number(s.coins)}
                        onClick={() => run("sell", () => player.sell(s.stall_id, q.token_id, n, Math.floor(est * 0.9)), `Sold ${n} ${GOOD_NAME[q.token_id]} for ~${est} coins`)}
                      >
                        {n > 0 ? `Sell ${n} for ~${est}🪙` : "Sell"}
                      </button>
                      <button
                        className="ghost"
                        disabled={!s.open || Number(q.stock) === 0 || bal("coin") < Number(q.ask) || !!busy}
                        onClick={() => run("buy", () => player.buy(s.stall_id, q.token_id, 1, Number(q.ask)), `Bought 1 ${GOOD_NAME[q.token_id]}`)}
                      >
                        Buy 1
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">
            Prices move with stock: every unit you sell makes the next one cheaper. The keeper reprices every minute or so.
          </p>
        </section>
      )}

      {s.kind === "Bathhouse" && (
        <section>
          <h3>Hot spring</h3>
          <button
            className="primary big"
            disabled={!s.open || bal("coin") < s.soak_price || !!busy}
            onClick={() => run("soak", () => player.soak(s.stall_id, s.soak_price), "Ahh. Energy refilled.")}
          >
            ♨️ Soak for {s.soak_price}🪙 (refills energy)
          </button>
          <p className="small muted">Each soak uses one yuzu from the bathhouse, so it buys yuzu from foragers. A slice of every soak is burned as spring upkeep.</p>
        </section>
      )}

      {s.kind === "Hatter" && (
        <section>
          <h3>Hats (paid in test USDC)</h3>
          <div className="hats">
            {s.hats.map((h) => (
              <div className="hat-card" key={h.hat_id}>
                <Capybara size={64} fur={FURS[1]} hat={h.hat_id} mood="happy" />
                <div className="hat-name">{GOOD_NAME[h.hat_id]}</div>
                <div className="small">
                  {usd(h.price_usd)} + {materials(h.hat_id)}🪙
                </div>
                <button
                  disabled={!h.in_stock || !s.open || Number(me?.usd ?? 0) < Number(h.price_usd) || bal("coin") < materials(h.hat_id) || !!busy}
                  onClick={() => run("hat", () => player.buyHat(s.stall_id, h.hat_id, h.price_usd), `New hat! 70% of ${usd(h.price_usd)} went to ${s.name}'s account`)}
                >
                  {h.in_stock ? "Buy" : "Out of materials"}
                </button>
              </div>
            ))}
          </div>
          <p className="small muted">
            70% of every hat goes to this stall's own account as test USDC ({usd(earned)} there now); 30% is the game's fee. On mainnet this is
            real USDC.
          </p>
        </section>
      )}

      <section className="ownership">
        <h3>This stall is a NEAR account</h3>
        <p className="mono small">{s.stall_id}</p>
        {item && (
          <p className="small">
            The account itself says its owner is <b>{mine ? "you" : short(item.owner_id)}</b> (rotation #{item.rotation_seq}, {item.spec}).{" "}
            {item.owner_id === s.owner_id ? "The collection index agrees." : "The collection index is catching up."}
          </p>
        )}
        <p className="small muted">
          It holds its own stock, {s.coins} coins and {usd(earned)} test USDC. Whoever owns the NFT controls it; selling the NFT moves everything
          inside with it.
        </p>

        {s.listed && !mine && (
          <button
            className="primary"
            disabled={!!busy || Number(me?.usd ?? 0) < s.listed.price_usd || s.rotating}
            onClick={() => run("buystall", () => player.buyStall(s.stall_id), `You own ${s.name} now!`)}
          >
            Buy this stall for {usd(s.listed.price_usd)}
            {Number(me?.usd ?? 0) < s.listed.price_usd ? " (top up first)" : ""}
          </button>
        )}

        {!s.open && !mine && (
          <button className="ghost" disabled={bal("coin") < 20 || !!busy} onClick={() => run("invest", () => player.invest(s.stall_id, 20), `Invested 20 coins in ${s.name}`)}>
            Invest 20🪙 to help it reopen
          </button>
        )}

        {mine && (
          <div className="owner-tools">
            <div className="row">
              <button
                disabled={Number(s.coins) <= 5 || !!busy || !!s.listed}
                onClick={() => {
                  const amount = Math.max(0, Number(s.coins) - 10);
                  return run("wcoins", () => player.ownerCall(s.stall_id, { WithdrawCoins: { amount: String(amount) } }), `Took ${amount} coins from the till`);
                }}
              >
                Take {Math.max(0, Number(s.coins) - 10)}🪙 from the till
              </button>
              <button
                disabled={earned === "0" || !!busy || !!s.listed}
                onClick={() => run("wusd", () => player.ownerCall(s.stall_id, { WithdrawUsd: { amount: earned } }), `Moved ${usd(earned)} of test USDC to your account`)}
              >
                Withdraw {usd(earned)} earnings
              </button>
            </div>
            <div className="row">
              {s.listed ? (
                <button disabled={!!busy} onClick={() => run("unlist", () => player.ownerCall(s.stall_id, "Unlist"), "Unlisted")}>
                  Unlist (listed at {usd(s.listed.price_usd)})
                </button>
              ) : (
                <>
                  <label className="small" htmlFor="list-price">
                    Sell for $
                  </label>
                  <input id="list-price" className="price-input" value={listPrice} onChange={(e) => setListPrice(e.target.value)} />
                  <button
                    disabled={!!busy || !(Number(listPrice) > 0)}
                    onClick={() =>
                      run("list", () => player.ownerCall(s.stall_id, { List: { price_usd: String(Math.round(Number(listPrice) * 1e6)) } }), `Listed for $${Number(listPrice).toFixed(2)}`)
                    }
                  >
                    List it
                  </button>
                </>
              )}
            </div>
            {state && (
              <div className="row">
                <button
                  className="ghost"
                  disabled={!!busy || !!s.listed}
                  onClick={() =>
                    run("house", () => player.ownerCall(s.stall_id, { SetHouseKeeper: { enabled: !state.house_enabled } }), state.house_enabled ? "House keeper switched off" : "House keeper is back")
                  }
                >
                  {state.house_enabled ? "Switch off the house keeper" : "Rehire the house keeper"}
                </button>
                <span className="small muted">
                  Keeper limits: {state.policy.bounds.map((b) => `${GOOD_EMOJI[b.id] ?? b.id} ${b.min}–${b.max}`).join(" · ")}
                </span>
              </div>
            )}
            {s.listed && <p className="small muted">While listed, the stall refuses withdrawals, so a seller can't empty it before the sale lands.</p>}
          </div>
        )}
      </section>

      <section className="small muted stats-line">
        {s.stats.trades} trades · {s.stats.soaks} soaks · {s.stats.hats} hats · {s.stats.caravan_units} units sold to the caravan
      </section>
    </aside>
  );
}
