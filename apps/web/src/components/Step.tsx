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

/**
 * Where the tester should be once the step is done (D40). Quieter than the
 * expected-result block on purpose: "Expected" means stop and look; this is
 * orientation, the thing a tester improvises toward when the step itself is stale.
 */
export function PostState({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <p className="after" dir="auto">
      <span className="lbl">Afterwards</span>
      {text}
    </p>
  );
}

export function FlagIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3.5 14V2.5" />
      <path d="M3.5 3h8.2l-1.6 3 1.6 3H3.5" />
    </svg>
  );
}

/**
 * A step the tester flagged as wrong (D40): what is wrong, and whether they got
 * past it. Grey like a skipped test, and for the same reason — it is a statement
 * about the flow, not about the product.
 */
export function StepProblemNote({
  note, workaround, blocking, by, onUndo,
}: {
  note: string; workaround: string | null; blocking: boolean; by?: string; onUndo?: () => void;
}) {
  return (
    <div className="stale" role="note">
      <div className="head">
        <FlagIcon />
        <b>Step is wrong</b>
        {by ? <span className="meta">· {by}</span> : null}
        {onUndo ? (
          <button type="button" className="btn sm" style={{ marginLeft: "auto" }} onClick={(e) => { e.stopPropagation(); onUndo(); }}>
            Undo
          </button>
        ) : null}
      </div>
      <p dir="auto">{note}</p>
      {blocking ? (
        <p className="how"><b>Could not get past it.</b> The rest of the flow is blocked.</p>
      ) : (
        <p className="how" dir="auto"><b>Got past it:</b> {workaround}</p>
      )}
    </div>
  );
}
