import { useState } from "react";
import { Capybara, FURS } from "../art/Capybara";
import { joinAsGuest, type Session } from "../near";

export function Welcome({ onJoined }: { onJoined: (s: Session) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function join() {
    setBusy(true);
    setErr("");
    try {
      onJoined(await joinAsGuest(name.trim() || "Capy"));
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  return (
    <main className="welcome">
      <div className="welcome-card">
        <div className="spring-hero" aria-hidden="true">
          <div className="steam s1" />
          <div className="steam s2" />
          <div className="steam s3" />
          <div className="hero-capys">
            <Capybara size={110} fur={FURS[0]} hat="hat-yuzu" mood="happy" soaking />
            <Capybara size={96} fur={FURS[2]} hat="hat-duck" mood="sleepy" soaking flip />
            <Capybara size={104} fur={FURS[3]} mood="calm" soaking />
          </div>
        </div>
        <h1>Capybazaar</h1>
        <p className="lead">
          A hot-spring market town. Forage, trade with capybara shopkeepers, soak, and buy a stall of your own. Every stall is an NFT that is
          its own NEAR account, so selling one hands over its stock and earnings with it.
        </p>
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) join();
          }}
        >
          <label htmlFor="capy-name">Your capybara's name</label>
          <div className="row">
            <input id="capy-name" value={name} maxLength={24} placeholder="Mochi Jr." onChange={(e) => setName(e.target.value)} autoFocus />
            <button className="primary" disabled={busy}>
              {busy ? "Building your burrow…" : "Move into Yuzu Springs"}
            </button>
          </div>
          <p className="small muted">
            No wallet or seed phrase. You get a real NEAR testnet account, a key that can only play this game, and $5 of test USDC. Test money
            has no value.
          </p>
          {err && <p className="err">{err}</p>}
        </form>
      </div>
    </main>
  );
}
