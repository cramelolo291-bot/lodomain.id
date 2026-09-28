// The opening sequence.
//
// It exists because the app opens to a wall of panels and a wall of panels has
// no entrance. So: one mark, one wordmark, one rule filling, and a wipe. No
// new colour, no second accent, nothing that has to be explained — the point is
// that the app arrives instead of appearing.
//
// Plays once per session, and only on the first paint of the app, so navigating
// never re-triggers it. Honours prefers-reduced-motion by not playing at all.

import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "lolo.intro.v1";

/** Choreography. The rule fills across exactly this, so progress means something. */
const HOLD_MS = 2200;
const WIPE_MS = 760;

const WORD = ["L", "o", "l", "o", " ", "A", "I"];

function alreadyPlayed(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    // Private mode can refuse storage. Playing twice is better than never.
    return false;
  }
}

function rememberPlayed() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* nothing to do */
  }
}

function prefersStill(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Intro({ onDone }: { onDone: () => void }) {
  // Rendered unconditionally on the first mount so the overlay is present in
  // the very first frame; the timers below are what skip it.
  const [phase, setPhase] = useState<"play" | "wipe">("play");
  const [percent, setPercent] = useState(0);
  const frame = useRef<number>(0);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const finish = useCallback(() => {
    if (timers.current.length) {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    }
    cancelAnimationFrame(frame.current);
    document.body.style.overflow = "";
    // Marked here, not on mount. StrictMode mounts twice, so marking on mount
    // would make the second pass decide the intro had already played and skip
    // it — the sequence would never be visible in development.
    rememberPlayed();
    onDone();
  }, [onDone]);

  useEffect(() => {
    if (alreadyPlayed() || prefersStill()) {
      onDone();
      return;
    }

    // The page behind is real and scrollable; a wheel event during the intro
    // would scroll it and leave the app somewhere unexpected.
    document.body.style.overflow = "hidden";

    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / HOLD_MS);
      // Not linear: a bar that races then crawls reads as work; one that eases
      // out reads as something being composed.
      const eased = 1 - Math.pow(1 - t, 2.2);
      setPercent(Math.round(eased * 100));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);

    timers.current.push(setTimeout(() => setPhase("wipe"), HOLD_MS + 140));
    timers.current.push(setTimeout(() => finish(), HOLD_MS + 140 + WIPE_MS));

    const skip = () => finish();
    window.addEventListener("keydown", skip, { once: true });

    return () => {
      window.removeEventListener("keydown", skip);
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
      cancelAnimationFrame(frame.current);
      document.body.style.overflow = "";
    };
  }, [finish, onDone]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-void"
      // The wipe is only attached once the hold is over. Setting it on mount
      // would start it at the same instant the mark is landing.
      style={
        phase === "wipe"
          ? { animation: `intro-wipe ${WIPE_MS}ms var(--ease-cinema) forwards` }
          : undefined
      }
      onClick={finish}
      role="status"
      aria-label="Memuat Lolo AI"
    >
      {/* Two washes so the centre is warmer than the corners. The mark sits on
          the hot spot, which is what makes it look lit rather than pasted. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(46% 34% at 50% 44%, rgba(var(--ember-rgb), 0.10), transparent 70%)",
        }}
      />

      <div className="relative flex w-full max-w-[420px] flex-col items-center px-8">
        {/* Mark inside a ring that draws itself. 302 is the circumference of
            r=48, so the dash starts fully hidden. */}
        <div
          className="relative flex size-[104px] items-center justify-center"
          style={{ animation: "intro-mark 900ms var(--ease-cinema) both" }}
        >
          <svg
            className="absolute inset-0 size-full -rotate-90"
            viewBox="0 0 104 104"
            fill="none"
            aria-hidden
          >
            <circle
              cx="52"
              cy="52"
              r="48"
              stroke="var(--line-strong)"
              strokeWidth="1"
            />
            <circle
              cx="52"
              cy="52"
              r="48"
              stroke="var(--text-3)"
              strokeWidth="1"
              strokeLinecap="round"
              strokeDasharray="302"
              style={{ animation: "intro-ring 1500ms var(--ease-cinema) 120ms both" }}
            />
          </svg>

          <span className="relative block size-[42px] overflow-hidden rounded-[11px] bg-ember">
            <span className="absolute inset-[8px] rounded-[4px] bg-void" />
          </span>
        </div>

        {/* Wordmark. Each glyph is its own element so it can arrive on its own
            beat; the space keeps its slot so the two words stay apart. */}
        <h1
          className="display mt-9 flex text-[34px] text-ink-1"
          style={{ perspective: "600px" }}
        >
          {WORD.map((ch, i) => (
            <span
              key={`${ch}-${i}`}
              aria-hidden={ch === " "}
              className={ch === " " ? "inline-block w-[10px]" : "inline-block"}
              style={{
                animation: `intro-letter 900ms var(--ease-cinema) ${260 + i * 65}ms both`,
              }}
            >
              {ch === " " ? "\u00A0" : ch}
            </span>
          ))}
        </h1>

        <p
          className="mono-label mt-5"
          style={{ animation: "intro-caption 800ms var(--ease) 1000ms both" }}
        >
          agent studio · self-hosted
        </p>

        {/* The rule is the honest part: its width is the same number the
            readout shows. */}
        <div
          className="mt-10 w-full"
          style={{ animation: "intro-caption 800ms var(--ease) 1150ms both" }}
        >
          <div className="h-px w-full overflow-hidden bg-line">
            <div
              className="h-full bg-ink-3"
              style={{ width: `${percent}%`, transition: "none" }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="mono-label" style={{ color: "var(--text-4)" }}>
              establishing session
            </span>
            <span className="font-mono text-[10px] tracking-[0.18em] text-ink-4 tnum">
              {String(percent).padStart(3, "0")}%
            </span>
          </div>
        </div>
      </div>

      {/* No escape hatch on screen. The intro is three seconds; a button on it
          would be an admission that it is in the way. Click or any key skips. */}
    </div>
  );
}

/**
 * Whether the sequence should run at all. Session-scoped on purpose: it is the
 * first paint of the app, not the first visit of the day, so a reload in the
 * middle of a debugging session does not replay it.
 */
export function shouldPlay(): boolean {
  return !(alreadyPlayed() || prefersStill());
}
