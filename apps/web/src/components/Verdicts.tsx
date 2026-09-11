import type { Verdict } from "@flowdeck/domain";

const GLYPH: Record<Verdict, string> = { pass: "✓", fail: "✕", minor: "!", skipped: "–" };
const LABEL: Record<Verdict, string> = { pass: "Pass", fail: "Fail", minor: "Minor issue", skipped: "Skip — test is wrong" };
const CLASS: Record<Verdict, string> = { pass: "pass", fail: "fail", minor: "minor", skipped: "skip" };

export const VERDICTS: readonly Verdict[] = ["pass", "fail", "minor", "skipped"];

/** Four compact glyph buttons per test row; the selected one fills solid. */
export function VerdictButtons({
  value,
  onPick,
  disabled,
}: {
  value: Verdict | undefined;
  onPick: (v: Verdict) => void;
  disabled?: boolean;
}) {
  return (
    <div className="verdicts" role="group" aria-label="Verdict">
      {VERDICTS.map((v) => (
        <button
          key={v}
          type="button"
          className={`v ${CLASS[v]}${value === v ? " on" : ""}`}
          aria-pressed={value === v}
          aria-label={LABEL[v]}
          title={LABEL[v]}
          disabled={disabled}
          onClick={() => onPick(v)}
        >
          {GLYPH[v]}
        </button>
      ))}
    </div>
  );
}

export function verdictPillClass(v: Verdict): string {
  return CLASS[v];
}

export function noteClass(v: Verdict): string {
  return v === "minor" ? "note min" : v === "skipped" ? "note skp" : "note";
}
