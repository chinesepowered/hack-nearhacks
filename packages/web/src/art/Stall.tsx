// A market stall with a striped awning. The keeper capybara peeks over the counter.

import { Capybara, FURS, type Mood } from "./Capybara";

export const AWNINGS: [string, string][] = [
  ["#ff9aa2", "#fff4e6"],
  ["#ffd166", "#fff8e1"],
  ["#b5e48c", "#f1fadf"],
  ["#a0c4ff", "#eef4ff"],
  ["#7fd3e8", "#e8fbff"],
  ["#cdb4db", "#f6effa"],
];

export function StallArt({ look, mood, hat, closed }: { look: number; mood: Mood; hat?: string | null; closed?: boolean }) {
  const [a, b] = AWNINGS[look % AWNINGS.length];
  const stripes = Array.from({ length: 6 }, (_, i) => i);
  return (
    <svg viewBox="0 0 160 130" width="100%" style={{ display: "block", overflow: "visible" }} aria-hidden="true">
      <rect x="18" y="34" width="6" height="82" rx="3" fill="#a0785a" />
      <rect x="136" y="34" width="6" height="82" rx="3" fill="#a0785a" />
      <g transform="translate(36 30)">
        <Capybara size={88} fur={FURS[look % FURS.length]} mood={closed ? "sleepy" : mood} hat={hat} />
      </g>
      <rect x="10" y="84" width="140" height="34" rx="8" fill="#c8956c" />
      <rect x="10" y="84" width="140" height="8" rx="4" fill="#dcae84" />
      <g>
        {stripes.map((i) => (
          <path key={i} d={`M${8 + i * 24} 14 h24 v22 a12 12 0 0 1 -24 0 z`} fill={i % 2 ? b : a} stroke="#00000010" />
        ))}
        <rect x="6" y="8" width="148" height="10" rx="5" fill={a} />
      </g>
      {closed && (
        <g transform="rotate(-8 80 100)">
          <rect x="44" y="88" width="72" height="24" rx="6" fill="#fff" stroke="#e35d6a" strokeWidth="3" />
          <text x="80" y="105" textAnchor="middle" fontFamily="Baloo 2, sans-serif" fontWeight="800" fontSize="15" fill="#e35d6a">
            CLOSED
          </text>
        </g>
      )}
    </svg>
  );
}
