/**
 * The dialog behind fail, skipped and (optionally) minor.
 *
 * It asks a human question — "Can you keep going?" — rather than exposing the data
 * model's word for it. The answer decides whether the rest of the flow is blocked
 * (D11), taken at the moment the tester has the most context.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import type { Verdict } from "@flowdeck/domain";

export interface VerdictSubmission {
  verdict: Verdict;
  note: string;
  blocking: boolean;
  files: File[];
}

const TITLE: Record<Verdict, string> = {
  fail: "What went wrong?",
  skipped: "What is wrong with the test?",
  minor: "What was off?",
  pass: "",
};

const HELP: Record<Verdict, string> = {
  fail: "This becomes the bug report. Write what you saw, not what you expected.",
  skipped:
    "Skipped means the test is stale — the UI moved, the wording no longer matches. It is not a verdict on the product. This note is how the suite gets fixed.",
  minor: "Optional. Something was off but nothing is broken — a delay, a cosmetic oddity.",
  pass: "",
};

export function VerdictDialog({
  verdict,
  testTitle,
  onSubmit,
  onCancel,
}: {
  verdict: Verdict | null;
  testTitle: string;
  onSubmit: (s: VerdictSubmission) => Promise<void>;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [blocking, setBlocking] = useState<boolean | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (verdict) {
      setNote("");
      setBlocking(null);
      setFiles([]);
      setError(null);
      setTimeout(() => noteRef.current?.focus(), 0);
    }
  }, [verdict]);

  const open = verdict !== null && verdict !== "pass";
  const requiresNote = verdict === "fail" || verdict === "skipped";
  const canSubmit =
    !busy && (!requiresNote || note.trim().length > 0) && (verdict !== "fail" || blocking !== null);

  async function submit() {
    if (!verdict || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ verdict, note: note.trim(), blocking: blocking === true, files });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list).filter((x) => x.type.startsWith("image/"))]);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className="dialog"
          onPaste={(e) => addFiles(e.clipboardData.files)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
          }}
        >
          {verdict ? (
            <>
              <Dialog.Title asChild>
                <h3>{TITLE[verdict]}</h3>
              </Dialog.Title>
              <Dialog.Description asChild>
                <p className="meta" style={{ margin: "0 0 6px" }} dir="auto">
                  {testTitle}
                </p>
              </Dialog.Description>
              <p className="meta" style={{ margin: "0 0 4px", fontSize: 13 }}>
                {HELP[verdict]}
              </p>

              <label className="f" htmlFor="verdict-note">
                {verdict === "minor" ? "Note (optional)" : "Note"}
              </label>
              <textarea
                id="verdict-note"
                ref={noteRef}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                dir="auto"
                // What a useful note contains, not a sample answer from some other
                // test — an example about reactions on a test about sign-in reads as noise.
                placeholder={
                  verdict === "fail"
                    ? "What you saw, on which device, and what you did just before…"
                    : verdict === "skipped"
                      ? "What no longer matches — the screen, the wording, the feature…"
                      : "What was off, and whether it happened every time…"
                }
              />

              {verdict !== "skipped" ? (
                <>
                  <label className="f">Screenshots</label>
                  <div className="drop">
                    {files.length ? (
                      <ul className="flex flex-wrap gap-2 justify-center m-0 p-0 list-none">
                        {files.map((f, i) => (
                          <li key={`${f.name}-${i}`} className="relative">
                            <img
                              src={URL.createObjectURL(f)}
                              alt=""
                              style={{ height: 64, borderRadius: 4, border: "1px solid var(--line)" }}
                            />
                            <button
                              type="button"
                              className="btn sm"
                              style={{ position: "absolute", top: -6, right: -6, padding: "0 6px", lineHeight: "18px" }}
                              aria-label="Remove screenshot"
                              onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span>Paste, or add from your device. Several are fine — before and after, both screens.</span>
                    )}
                    <div className="flex gap-2 justify-center mt-2">
                      <label className="btn sm">
                        Choose image
                        <input type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
                      </label>
                      <label className="btn sm">
                        Take photo
                        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => addFiles(e.target.files)} />
                      </label>
                    </div>
                  </div>
                </>
              ) : null}

              {verdict === "fail" ? (
                <>
                  <label className="f">Can you keep going?</label>
                  <div className="radio" role="radiogroup" aria-label="Can you keep going?">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={blocking === false}
                      className={blocking === false ? "on" : ""}
                      onClick={() => setBlocking(false)}
                    >
                      <b>Yes, carry on</b>
                      <span>The rest of the flow still works</span>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={blocking === true}
                      className={blocking === true ? "on" : ""}
                      onClick={() => setBlocking(true)}
                    >
                      <b>No, I'm stuck</b>
                      <span>Remaining steps become blocked</span>
                    </button>
                  </div>
                </>
              ) : null}

              {error ? <p className="note" role="alert">{error}</p> : null}

              <div className="flex gap-2 justify-end mt-4">
                <Dialog.Close asChild>
                  <button type="button" className="btn" disabled={busy}>
                    Cancel
                  </button>
                </Dialog.Close>
                <button type="button" className="btn primary" disabled={!canSubmit} onClick={() => void submit()}>
                  {busy ? "Saving…" : "Save report"}
                </button>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
