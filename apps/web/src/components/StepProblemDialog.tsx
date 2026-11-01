/**
 * "This step is wrong" (D40). The step, not the product: the button moved, the
 * wording is stale, the screen is gone. The tester says what is wrong and — the
 * same primitive as a failure's "Can you keep going?" (D11) — whether they got
 * past it. If they did, how, because that is what fixes the step.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import type { SnapshotStep } from "../lib/api.ts";

export interface StepProblemSubmission {
  note: string;
  workaround: string | null;
  blocking: boolean;
}

export function StepProblemDialog({
  step,
  index,
  onSubmit,
  onCancel,
}: {
  step: SnapshotStep | null;
  index: number;
  onSubmit: (s: StepProblemSubmission) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [passed, setPassed] = useState<boolean | null>(null);
  const [workaround, setWorkaround] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const howRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (step) {
      setNote("");
      setPassed(null);
      setWorkaround("");
      setTimeout(() => noteRef.current?.focus(), 0);
    }
  }, [step]);
  useEffect(() => {
    if (passed) setTimeout(() => howRef.current?.focus(), 0);
  }, [passed]);

  const canSubmit = note.trim().length > 0 && passed !== null && (!passed || workaround.trim().length > 0);

  function submit() {
    if (!canSubmit) return;
    onSubmit({ note: note.trim(), workaround: passed ? workaround.trim() : null, blocking: passed === false });
  }

  return (
    <Dialog.Root open={step !== null} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className="dialog"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
        >
          {step ? (
            <>
              <Dialog.Title asChild>
                <h3>What is wrong with this step?</h3>
              </Dialog.Title>
              <Dialog.Description asChild>
                <p className="meta" style={{ margin: "0 0 6px" }} dir="auto">
                  Step {index + 1} · {step.text}
                </p>
              </Dialog.Description>
              <p className="meta" style={{ margin: "0 0 4px", fontSize: 13 }}>
                About the step, not the product — the button moved, the wording is stale, the screen is gone.
                Its tests can still get a verdict. This note is how the flow gets fixed.
              </p>

              <label className="f" htmlFor="problem-note">What is wrong</label>
              <textarea
                id="problem-note"
                ref={noteRef}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                dir="auto"
                placeholder="What the step says, and what you found instead…"
              />

              <label className="f">Could you get past it?</label>
              <div className="radio" role="radiogroup" aria-label="Could you get past it?">
                <button
                  type="button"
                  role="radio"
                  aria-checked={passed === true}
                  className={passed === true ? "on" : ""}
                  onClick={() => setPassed(true)}
                >
                  <b>Yes, another way</b>
                  <span>Say how; the rest of the flow carries on</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={passed === false}
                  className={passed === false ? "on" : ""}
                  onClick={() => setPassed(false)}
                >
                  <b>No, I'm stuck</b>
                  <span>Remaining steps become blocked</span>
                </button>
              </div>

              {passed ? (
                <>
                  <label className="f" htmlFor="problem-how">How did you get there?</label>
                  {step.postState ? (
                    <p className="meta" style={{ margin: "0 0 5px", fontSize: 13 }} dir="auto">
                      Where the step should leave you: {step.postState}
                    </p>
                  ) : null}
                  <textarea
                    id="problem-how"
                    ref={howRef}
                    value={workaround}
                    onChange={(e) => setWorkaround(e.target.value)}
                    dir="auto"
                    placeholder="What you did instead, so the next person can do the same…"
                  />
                </>
              ) : null}

              <div className="flex gap-2 justify-end mt-4">
                <Dialog.Close asChild>
                  <button type="button" className="btn">Cancel</button>
                </Dialog.Close>
                <button type="button" className="btn primary" disabled={!canSubmit} onClick={submit}>
                  Flag this step
                </button>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
