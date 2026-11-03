import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { dep, provider, short } from "../near";

export interface Toast {
  id: number;
  text: string;
  kind: "ok" | "err" | "info";
  hash?: string;
}

const Ctx = createContext<{ push: (t: Omit<Toast, "id">) => void; showTx: (hash: string) => void }>({
  push: () => undefined,
  showTx: () => undefined,
});
export const useToasts = () => useContext(Ctx);

let next = 1;

export function ToastProvider({ children, signer }: { children: ReactNode; signer?: string }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tx, setTx] = useState<string | null>(null);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = next++;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.kind === "err" ? 7_000 : 4_500);
  }, []);
  return (
    <Ctx.Provider value={{ push, showTx: setTx }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.text}</span>
            {t.hash && (
              <button className="link" onClick={() => setTx(t.hash!)}>
                see it on chain
              </button>
            )}
          </div>
        ))}
      </div>
      {tx && <TxModal hash={tx} signer={signer} onClose={() => setTx(null)} />}
    </Ctx.Provider>
  );
}

interface Outcome {
  status: unknown;
  transaction: { signer_id: string; receiver_id: string; public_key: string; actions: unknown[] };
  receipts_outcome: { id: string; outcome: { executor_id: string; logs: string[]; gas_burnt: number; status: unknown } }[];
}

function TxModal({ hash, signer, onClose }: { hash: string; signer?: string; onClose: () => void }) {
  const [o, setO] = useState<Outcome | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    provider
      .viewTransactionStatus({ txHash: hash, accountId: signer ?? "", waitUntil: "EXECUTED_OPTIMISTIC" })
      .then((r) => setO(r as unknown as Outcome))
      .catch((e) => setErr(String(e).slice(0, 200)));
  }, [hash, signer]);
  const burnt = o?.receipts_outcome.reduce((a, r) => a + r.outcome.gas_burnt, 0) ?? 0;
  const ok = o && "SuccessValue" in (o.status as object);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="transaction details">
        <div className="modal-head">
          <h3>Transaction on NEAR testnet</h3>
          <button className="icon" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <p className="mono small">{hash}</p>
        {err && <p className="err">{err}</p>}
        {!o && !err && <p>Reading it from the testnet RPC…</p>}
        {o && (
          <>
            <p>
              <b>{ok ? "Succeeded" : "Failed"}</b> · signed by <b>{short(o.transaction.signer_id)}</b> with key{" "}
              <span className="mono">{o.transaction.public_key.slice(0, 18)}…</span> · {o.receipts_outcome.length} receipts ·{" "}
              {(burnt / 1e12).toFixed(2)} TGas burnt (≈{(burnt / 1e16).toFixed(5)} NEAR)
            </p>
            <ol className="receipts">
              {o.receipts_outcome.map((r) => (
                <li key={r.id}>
                  <b>{r.outcome.executor_id}</b>
                  {r.outcome.logs.map((l, i) => (
                    <pre key={i}>{l.startsWith("EVENT_JSON:") ? JSON.stringify(JSON.parse(l.slice(11)), null, 1) : l}</pre>
                  ))}
                </li>
              ))}
            </ol>
            <p className="small">
              Read straight from <span className="mono">{dep.rpc}</span>, so you don't need an explorer.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
