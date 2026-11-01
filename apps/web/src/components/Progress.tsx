import type { Verdict } from "@flowdeck/domain";

export type Counts = Record<Verdict, number>;

/** Proportional bar: pass, fail, minor, skipped as slices of the total. */
export function Bar({ counts, total }: { counts: Counts; total: number }) {
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  return (
    <div className="bar" role="img" aria-label={`${counts.pass} passed, ${counts.fail} failed, ${counts.minor} minor, ${counts.skipped} skipped of ${total}`}>
      <i className="p" style={{ width: pct(counts.pass) }} />
      <i className="f" style={{ width: pct(counts.fail) }} />
      <i className="m" style={{ width: pct(counts.minor) }} />
      <i className="s" style={{ width: pct(counts.skipped) }} />
    </div>
  );
}

export function Kpis({ counts, notReached }: { counts: Counts; notReached: number }) {
  return (
    <div className="kpi">
      <div><b>{counts.pass}</b><span>passed</span></div>
      <div><b style={{ color: "var(--color-fail)" }}>{counts.fail}</b><span>failed</span></div>
      <div><b style={{ color: "var(--color-minor)" }}>{counts.minor}</b><span>minor</span></div>
      <div><b style={{ color: "var(--color-skip)" }}>{counts.skipped}</b><span>skipped</span></div>
      <div><b>{notReached}</b><span>not reached</span></div>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <span><span className="dot" style={{ color: "var(--color-pass)" }} />Pass</span>
      <span><span className="dot" style={{ color: "var(--color-fail)" }} />Fail</span>
      <span><span className="dot" style={{ color: "var(--color-minor)" }} />Minor</span>
      <span><span className="dot" style={{ color: "var(--color-skip)" }} />Skipped</span>
    </div>
  );
}

/** The four verdict counts as pills; a zero is shown, dimmed, so the columns line up. */
export function Tally({ counts }: { counts: Counts }) {
  return (
    <span className="tally">
      <span className="pill pass" title="Passed"><span className="dot" />{counts.pass}</span>
      <span className={`pill fail${counts.fail ? "" : " off"}`} title="Failed"><span className="dot" />{counts.fail}</span>
      <span className={`pill minor${counts.minor ? "" : " off"}`} title="Minor"><span className="dot" />{counts.minor}</span>
      <span className={`pill skip${counts.skipped ? "" : " off"}`} title="Skipped"><span className="dot" />{counts.skipped}</span>
    </span>
  );
}

export const emptyCounts = (): Counts => ({ pass: 0, fail: 0, minor: 0, skipped: 0 });
