/** Pieces shared by the runner and the editor so testers and authors see the same step. */
import type { StepKind } from "@flowdeck/domain";

/** Action vs check as a labelled badge. Fill, not hue — it sits beside a device colour. */
export function KindBadge({ kind, long = false }: { kind: StepKind; long?: boolean }) {
  const isCheck = kind === "assertion";
  return (
    <span className={`kind ${isCheck ? "chk" : "act"}`}>
      {isCheck ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="8" cy="8" r="6" /><path d="M5.5 8.2l1.8 1.8 3.4-3.6" /></svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M5 3.2v9.6a.6.6 0 0 0 .92.5l7.2-4.8a.6.6 0 0 0 0-1L5.92 2.7A.6.6 0 0 0 5 3.2z" /></svg>
      )}
      {isCheck ? (long ? "Check this" : "Check") : long ? "Do this" : "Action"}
    </span>
  );
}

export function TestsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="3" />
      <path d="M5 8.2l2 2 4-4.4" />
    </svg>
  );
}
