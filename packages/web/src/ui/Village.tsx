import { GOOD_EMOJI, usd, type PlayerView, type StallView } from "@capy/core";
import { StallArt } from "../art/Stall";
import { Capybara, FURS, type Mood } from "../art/Capybara";

export function keeperMood(s: StallView): Mood {
  if (!s.open) return "sleepy";
  if (Number(s.coins) < 20) return "worried";
  if (s.stall_id.startsWith("yuzu.")) return "grumpy";
  if (s.stall_id.startsWith("kumo.")) return "calm";
  return "happy";
}

const KIND_LABEL = { Grocer: "Grocer", Bathhouse: "Bathhouse", Hatter: "Hatter" } as const;

function StallCard({ s, mine, onOpen }: { s: StallView; mine: boolean; onOpen: () => void }) {
  return (
    <button className={`stall-card ${s.open ? "" : "closed"} ${mine ? "mine" : ""}`} onClick={onOpen} aria-label={`Open ${s.name}`}>
      <div className="stall-art">
        <StallArt look={s.look} mood={keeperMood(s)} closed={!s.open} hat={s.kind === "Hatter" ? "hat-lily" : null} />
        {s.note && <div className="bubble">{s.note}</div>}
      </div>
      <div className="stall-info">
        <div className="stall-name">
          {s.name}
          {mine && <span className="tag mine-tag">yours</span>}
          {s.listed && <span className="tag sale">for sale {usd(s.listed.price_usd)}</span>}
        </div>
        <div className="stall-kind">
          {KIND_LABEL[s.kind]} · {s.coins} 🪙 in the till
        </div>
        <div className="chips">
          {s.kind === "Bathhouse" && <span className="chip">♨️ soak {s.soak_price}🪙</span>}
          {s.quotes.map((q) => (
            <span className="chip" key={q.token_id} title={`buys at ${q.bid}, sells at ${q.ask}, ${q.stock} in stock`}>
              {GOOD_EMOJI[q.token_id]} {q.bid}–{q.ask}🪙
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

export function Village({
  stalls,
  me,
  onOpen,
}: {
  stalls: StallView[];
  me?: PlayerView | null;
  onOpen: (id: string) => void;
}) {
  const order = ["mochi", "yuzu", "pudding", "kumo", "onsen", "hats"];
  const sorted = [...stalls].sort(
    (a, b) => (order.indexOf(a.stall_id.split(".")[0]) + 99) % 99 - (order.indexOf(b.stall_id.split(".")[0]) + 99) % 99,
  );
  const top = sorted.slice(0, 3);
  const bottom = sorted.slice(3);
  const mine = new Set(me?.stalls ?? []);
  return (
    <section className="village" aria-label="Yuzu Springs market">
      <div className="stall-row">
        {top.map((s) => (
          <StallCard key={s.stall_id} s={s} mine={mine.has(s.stall_id)} onOpen={() => onOpen(s.stall_id)} />
        ))}
      </div>
      <div className="spring" aria-hidden="true">
        <div className="steam s1" />
        <div className="steam s2" />
        <div className="steam s3" />
        <div className="pool">
          <div className="pool-capys">
            {me && <Capybara size={86} fur={FURS[7]} hat={me.hat} mood={me.energy > 2 ? "happy" : "sleepy"} soaking title={`${me.name} (you)`} />}
            <Capybara size={70} fur={FURS[4]} mood="sleepy" soaking flip />
          </div>
          <div className="yuzus">🍋 🍋 🍋</div>
        </div>
      </div>
      <div className="stall-row">
        {bottom.map((s) => (
          <StallCard key={s.stall_id} s={s} mine={mine.has(s.stall_id)} onOpen={() => onOpen(s.stall_id)} />
        ))}
      </div>
    </section>
  );
}
