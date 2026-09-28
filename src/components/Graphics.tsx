// Diagrams, drawn rather than dropped in as images.
//
// Rules that keep these tidy: monoline strokes, one accent colour, no fills
// competing with the type, and every label drawn from the real catalog rather
// than invented. They scale by viewBox so the same component serves a 375px
// phone and a 1440px desktop.

import { cn } from "@/lib/utils";

const EMBER = "var(--accent-warm)";
const COOL = "var(--accent-cool)";

/** The turn pipeline, drawn left to right. Fills the width, stacks on mobile. */
export function PipelineDiagram({ className }: { className?: string }) {
  const steps = [
    { label: "prompt", note: "inbound" },
    { label: "guardrail", note: "7 rules" },
    { label: "effort", note: "strip or keep" },
    { label: "pool", note: "claim a slot" },
    { label: "upstream", note: "model" },
    { label: "trace", note: "recorded" },
  ];

  return (
    <svg
      viewBox="0 0 720 132"
      className={cn("w-full", className)}
      role="img"
      aria-label="Turn pipeline: prompt through guardrail, effort, pool, upstream, and trace"
      fill="none"
    >
      <defs>
        <linearGradient id="pipe-fade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={EMBER} stopOpacity="0.9" />
          <stop offset="55%" stopColor={EMBER} stopOpacity="0.35" />
          <stop offset="100%" stopColor={EMBER} stopOpacity="0.08" />
        </linearGradient>
      </defs>

      <path
        d="M28 46 H692"
        stroke="url(#pipe-fade)"
        strokeWidth="1"
        strokeLinecap="round"
      />

      {steps.map((s, i) => {
        const x = 28 + i * 132.8;
        const isGuard = s.label === "guardrail";
        return (
          <g key={s.label}>
            <circle
              cx={x}
              cy={46}
              r={isGuard ? 5 : 3.5}
              fill={i === 0 || isGuard ? EMBER : "var(--surface-3)"}
              stroke={i <= 1 ? EMBER : "var(--border)"}
              strokeWidth="1"
            />
            <text
              x={x}
              y={78}
              textAnchor="middle"
              fill="var(--text-2)"
              fontSize="12"
              fontFamily="var(--font-mono)"
            >
              {s.label}
            </text>
            <text
              x={x}
              y={96}
              textAnchor="middle"
              fill="var(--text-4)"
              fontSize="10"
              fontFamily="var(--font-mono)"
            >
              {s.note}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** How a request picks an account out of the pool. */
export function PoolDiagram({
  accounts,
  className,
}: {
  accounts: Array<{ label: string; health: number; busy: boolean }>;
  className?: string;
}) {
  // The fan has four lanes, so at most four cards get drawn. Anything beyond
  // that is counted rather than silently dropped.
  const shown = accounts.slice(0, 4);
  const extra = Math.max(0, accounts.length - shown.length);
  const fanY = [30, 58, 86, 114];

  return (
    <svg
      viewBox="0 0 460 150"
      className={cn("w-full", className)}
      role="img"
      aria-label="Request routed to the healthiest account with a free slot"
      fill="none"
    >
      <circle
        cx="46"
        cy="75"
        r="15"
        fill="var(--surface-2)"
        stroke={EMBER}
        strokeWidth="1"
      />
      <text
        x="46"
        y="79"
        textAnchor="middle"
        fill="var(--text-1)"
        fontSize="10"
        fontFamily="var(--font-mono)"
      >
        req
      </text>

      {shown.map((a, i) => {
        const y = fanY[i]!;
        const d = `M61 75 C 130 75, 150 ${y}, 210 ${y}`;
        return (
          <g key={a.label}>
            <path
              d={d}
              stroke={a.busy ? "var(--border)" : COOL}
              strokeOpacity={a.busy ? 0.4 : 0.55}
              strokeWidth="1"
              strokeDasharray={a.busy ? "3 4" : undefined}
            />
            <rect
              x="210"
              y={y - 11}
              width="150"
              height="22"
              rx="6"
              fill="var(--surface-1)"
              stroke="var(--border)"
              strokeWidth="1"
            />
            <circle
              cx="223"
              cy={y}
              r="3"
              fill={a.busy ? "var(--text-4)" : EMBER}
            />
            <text
              x="234"
              y={y + 4}
              fill={a.busy ? "var(--text-4)" : "var(--text-2)"}
              fontSize="10"
              fontFamily="var(--font-mono)"
            >
              {a.label}
            </text>
            <text
              x="352"
              y={y + 4}
              textAnchor="end"
              fill="var(--text-4)"
              fontSize="9"
              fontFamily="var(--font-mono)"
            >
              {a.busy ? "full" : a.health}
            </text>
          </g>
        );
      })}

      {extra > 0 && (
        <text
          x="360"
          y="119"
          textAnchor="end"
          fill="var(--text-4)"
          fontSize="9"
          fontFamily="var(--font-mono)"
        >
          +{extra} more
        </text>
      )}
    </svg>
  );
}

/**
 * A chart of the effort matrix. Each row is one model family; filled cells are
 * the efforts the upstream accepts. Drawn straight from the catalog so the
 * picture cannot drift from the data.
 */
export function EffortMatrix({
  rows,
  className,
}: {
  rows: Array<{ id: string; efforts: readonly string[] }>;
  className?: string;
}) {
  const levels = ["minimal", "low", "medium", "high", "xhigh", "max"];
  const colW = 46;
  const labelW = 178;
  const rowH = 26;

  return (
    <svg
      viewBox={`0 0 ${labelW + levels.length * colW} ${rows.length * rowH + 24}`}
      className={cn("w-full", className)}
      role="img"
      aria-label="Reasoning effort support by model"
      fill="none"
    >
      {levels.map((lv, i) => (
        <text
          key={lv}
          x={labelW + i * colW + colW / 2}
          y={12}
          textAnchor="middle"
          fill="var(--text-4)"
          fontSize="9"
          fontFamily="var(--font-mono)"
        >
          {lv}
        </text>
      ))}

      {rows.map((r, ri) => {
        const y = 24 + ri * rowH;
        return (
          <g key={r.id}>
            <text
              x={0}
              y={y + 15}
              fill="var(--text-2)"
              fontSize="10.5"
              fontFamily="var(--font-mono)"
            >
              {r.id}
            </text>
            {levels.map((lv, ci) => {
              const on = r.efforts.includes(lv);
              return (
                <rect
                  key={lv}
                  x={labelW + ci * colW + 4}
                  y={y + 5}
                  width={colW - 8}
                  height={13}
                  rx={3}
                  fill={on ? EMBER : "transparent"}
                  fillOpacity={on ? 0.85 : 0}
                  stroke={on ? EMBER : "var(--border)"}
                  strokeWidth="1"
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Hero visual: one slow orbital trace with four nodes. Deliberately quiet —
 * it sits behind the headline, so it must never compete with the type.
 */
export function HeroOrbit({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 520 520"
      className={cn("w-full", className)}
      role="img"
      aria-label="Four agents orbiting a shared gateway"
      fill="none"
    >
      <defs>
        <radialGradient id="orbit-fade" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor={EMBER} stopOpacity="0" />
          <stop offset="100%" stopColor={EMBER} stopOpacity="0.28" />
        </radialGradient>
      </defs>

      {[150, 205, 258].map((r) => (
        <circle
          key={r}
          cx="260"
          cy="260"
          r={r}
          stroke="var(--border)"
          strokeWidth="1"
        />
      ))}
      <circle cx="260" cy="260" r="258" fill="url(#orbit-fade)" />

      {[
        { a: -90, label: "Lolo", hot: true },
        { a: 0, label: "Scout", hot: false },
        { a: 90, label: "Forge", hot: false },
        { a: 180, label: "Red Team", hot: false },
      ].map((n) => {
        const rad = (n.a * Math.PI) / 180;
        const r = 205;
        const x = 260 + r * Math.cos(rad);
        const y = 260 + r * Math.sin(rad);
        return (
          <g key={n.label}>
            <circle
              cx={x}
              cy={y}
              r={n.hot ? 4.5 : 3}
              fill={n.hot ? EMBER : "var(--surface-3)"}
              stroke={n.hot ? EMBER : "var(--border)"}
              strokeWidth="1"
            />
            <text
              x={x + (x < 260 ? -12 : 12)}
              y={y + 4}
              textAnchor={x < 260 ? "end" : "start"}
              fill={n.hot ? "var(--text-1)" : "var(--text-3)"}
              fontSize="11"
              fontFamily="var(--font-mono)"
            >
              {n.label}
            </text>
          </g>
        );
      })}

      <circle
        cx="260"
        cy="260"
        r="26"
        fill="var(--surface-1)"
        stroke={EMBER}
        strokeWidth="1"
      />
      <text
        x="260"
        y="257"
        textAnchor="middle"
        fill="var(--text-1)"
        fontSize="11"
        fontFamily="var(--font-mono)"
      >
        pool
      </text>
      <text
        x="260"
        y="271"
        textAnchor="middle"
        fill="var(--text-4)"
        fontSize="9"
        fontFamily="var(--font-mono)"
      >
        slot 1/3
      </text>
    </svg>
  );
}

/** A soft ember horizon, used behind section headers. */
export function Horizon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 160"
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      aria-hidden="true"
      fill="none"
    >
      <defs>
        <linearGradient id="horizon" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={EMBER} stopOpacity="0.22" />
          <stop offset="100%" stopColor={EMBER} stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: 5 }).map((_, i) => (
        <path
          key={i}
          d={`M0 ${140 - i * 6} Q 300 ${100 + i * 10} 600 ${132 - i * 4} T 1200 ${118 + i * 8}`}
          stroke={EMBER}
          strokeOpacity={0.3 - i * 0.055}
          strokeWidth="1"
        />
      ))}
      <rect x="0" y="0" width="1200" height="160" fill="url(#horizon)" />
    </svg>
  );
}
