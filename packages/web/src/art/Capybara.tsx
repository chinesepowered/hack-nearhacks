// An original capybara, drawn in SVG. Side view, facing right.

export const FURS = ["#b07a52", "#9c6b47", "#c49064", "#8a5d3d", "#b8845d", "#a5714c", "#c79a6e", "#94643f"];

export type Mood = "happy" | "calm" | "grumpy" | "sleepy" | "worried";

export interface CapyProps {
  size?: number;
  fur?: string;
  hat?: string | null;
  mood?: Mood;
  flip?: boolean;
  soaking?: boolean;
  title?: string;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function Hat({ id, x, y }: { id: string; x: number; y: number }) {
  switch (id) {
    case "hat-yuzu":
      return (
        <g transform={`translate(${x} ${y})`}>
          <circle cx="0" cy="-8" r="9" fill="#ffd23f" stroke="#e8b10f" strokeWidth="1.5" />
          <circle cx="-3" cy="-11" r="2" fill="#fff2a8" opacity="0.8" />
          <path d="M0 -17 q5 -6 10 -2 q-5 3 -10 2" fill="#5aa25a" />
        </g>
      );
    case "hat-lily":
      return (
        <g transform={`translate(${x} ${y})`}>
          {[-14, -7, 0, 7, 14].map((dx, i) => (
            <ellipse key={i} cx={dx * 0.7} cy={-6 - (i === 2 ? 4 : i % 2 ? 2 : 0)} rx="4" ry="8" fill={i === 2 ? "#ff8fb1" : "#ffb3c9"} transform={`rotate(${dx * 2} ${dx * 0.7} 0)`} />
          ))}
          <ellipse cx="0" cy="0" rx="13" ry="3" fill="#6cbf6c" />
        </g>
      );
    case "hat-melon":
      return (
        <g transform={`translate(${x} ${y})`}>
          <path d="M-14 0 a14 13 0 0 1 28 0 z" fill="#4caf50" />
          <path d="M-9 -1 q2 -9 0 -10 M-2 -1 q1 -11 0 -13 M5 -1 q-1 -10 0 -12 M11 -1 q-2 -7 -1 -8" stroke="#2e7d32" strokeWidth="2" fill="none" />
          <rect x="-15" y="-1.5" width="30" height="3.5" rx="1.75" fill="#e57373" />
        </g>
      );
    case "hat-duck":
      return (
        <g transform={`translate(${x} ${y})`}>
          <ellipse cx="0" cy="-6" rx="9" ry="7" fill="#ffe066" />
          <circle cx="6" cy="-13" r="6" fill="#ffe066" />
          <circle cx="8" cy="-14" r="1.3" fill="#2b1d14" />
          <path d="M11 -12 l5 1.5 l-5 1.5 z" fill="#ff9f43" />
          <path d="M-6 -7 q-4 -2 -3 2" stroke="#f2c94c" strokeWidth="2" fill="none" />
        </g>
      );
    default:
      return null;
  }
}

export function Capybara({ size = 120, fur = FURS[0], hat = null, mood = "calm", flip = false, soaking = false, title }: CapyProps) {
  const dark = shade(fur, -38);
  const snout = shade(fur, -22);
  const legs = shade(fur, -30);
  const eye = (() => {
    switch (mood) {
      case "happy":
        return <path d="M84.5 33 q3 -3.5 6 0" stroke="#2b1d14" strokeWidth="2" fill="none" strokeLinecap="round" />;
      case "sleepy":
        return <path d="M84.5 33 h6" stroke="#2b1d14" strokeWidth="2" strokeLinecap="round" />;
      case "grumpy":
        return (
          <g>
            <circle cx="88" cy="33" r="2.5" fill="#2b1d14" />
            <path d="M83 27.5 l9 2.5" stroke={dark} strokeWidth="2.4" strokeLinecap="round" />
          </g>
        );
      case "worried":
        return (
          <g>
            <circle cx="88" cy="33" r="2.6" fill="#2b1d14" />
            <circle cx="88.9" cy="32.1" r="0.9" fill="#fff" />
            <path d="M84 27.5 q4 -2 8 1" stroke={dark} strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </g>
        );
      default:
        return (
          <g>
            <circle cx="88" cy="33" r="2.7" fill="#2b1d14" />
            <circle cx="88.9" cy="32.1" r="0.9" fill="#fff" />
          </g>
        );
    }
  })();
  return (
    <svg
      width={size}
      height={size * 0.8}
      viewBox="0 -14 120 104"
      role="img"
      aria-label={title ?? "a capybara"}
      style={{ transform: flip ? "scaleX(-1)" : undefined, overflow: "visible" }}
    >
      {title && <title>{title}</title>}
      {!soaking && (
        <g fill={legs}>
          <rect x="20" y="64" width="11" height="17" rx="5.5" />
          <rect x="36" y="66" width="11" height="15" rx="5.5" />
          <rect x="62" y="66" width="11" height="15" rx="5.5" />
          <rect x="76" y="64" width="11" height="17" rx="5.5" />
        </g>
      )}
      <rect x="8" y="30" width="86" height="44" rx="22" fill={fur} />
      <ellipse cx="44" cy="40" rx="26" ry="7" fill={shade(fur, 14)} opacity="0.55" />
      <rect x="60" y="15" width="48" height="40" rx="17" fill={fur} />
      <rect x="91" y="27" width="21" height="25" rx="10" fill={snout} />
      <ellipse cx="72" cy="18" rx="6.5" ry="5.2" fill={dark} />
      <ellipse cx="72" cy="18.6" rx="3.2" ry="2.4" fill={shade(fur, -60)} opacity="0.6" />
      {eye}
      <ellipse cx="107" cy="34" rx="1.8" ry="1.2" fill="#2b1d14" />
      <ellipse cx="83" cy="43" rx="4.6" ry="2.6" fill="#f4a3a3" opacity={mood === "grumpy" ? 0.25 : 0.6} />
      {mood === "grumpy" ? (
        <path d="M99 47 q3 -2 6 0" stroke="#2b1d14" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M99 46 q3 2.2 6 0" stroke="#2b1d14" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      )}
      {hat && <Hat id={hat} x={80} y={16} />}
      {soaking && (
        <g>
          <defs>
            <linearGradient id="capy-water" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#6fcbe3" stopOpacity="0.95" />
              <stop offset="1" stopColor="#4fb3d1" stopOpacity="1" />
            </linearGradient>
          </defs>
          <path d="M-14 58 q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 v40 h-140 z" fill="url(#capy-water)" />
          <path d="M2 58 q10 -4 20 0 M60 58 q10 -4 20 0" stroke="#e8fbff" strokeWidth="2" fill="none" opacity="0.8" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}
