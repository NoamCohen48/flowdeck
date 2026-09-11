/**
 * The test picker (`02-authoring.md`): attach tests to a step. It shows coverage
 * state so an author can prioritise what nothing covers yet — the number an
 * author is looking for is zero (D2).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Test } from "../lib/api.ts";

export function TestPicker({
  open, tests, marked, markCount, onToggle, onClose,
}: {
  open: boolean;
  tests: Test[];
  marked: Set<string>;
  markCount: (id: string) => number;
  onToggle: (testId: string, marked: boolean) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [uncoveredOnly, setUncoveredOnly] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(""); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tests
      .filter((t) => !t.archived)
      .filter((t) => !uncoveredOnly || markCount(t.id) === 0)
      .filter((t) => !needle || t.current.title.toLowerCase().includes(needle) || t.current.expectedResult.toLowerCase().includes(needle))
      .sort((a, b) => markCount(a.id) - markCount(b.id) || a.current.title.localeCompare(b.current.title));
  }, [tests, q, uncoveredOnly, markCount]);

  const uncovered = tests.filter((t) => !t.archived && markCount(t.id) === 0).length;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog picker" aria-describedby={undefined}>
          <Dialog.Title asChild><h3>Mark a test on this step</h3></Dialog.Title>
          <p className="meta" style={{ margin: "0 0 8px", fontSize: 13 }}>
            A test can be marked on any number of steps. Uncovered tests are listed first.
          </p>
          <div className="flex gap-2 items-center">
            <input ref={input} type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles or expected results" dir="auto" style={{ flex: 1 }} />
            <button className={`btn sm${uncoveredOnly ? " on" : ""}`} onClick={() => setUncoveredOnly((v) => !v)} style={uncovered ? { borderColor: "var(--pill-fail-line)", color: "var(--color-fail)" } : undefined}>
              Uncovered only ({uncovered})
            </button>
          </div>
          <ul className="picklist">
            {rows.map((t) => {
              const on = marked.has(t.id);
              const n = markCount(t.id);
              return (
                <li key={t.id}>
                  <label>
                    <input type="checkbox" checked={on} onChange={(e) => onToggle(t.id, e.target.checked)} />
                    <span className="body">
                      <b dir="auto">{t.current.title}</b>
                      <span className="meta" dir="auto">{t.current.expectedResult}</span>
                    </span>
                    {n === 0
                      ? <span className="pill fail"><span className="dot" />Not covered</span>
                      : <span className="meta nowrap">{n} step{n === 1 ? "" : "s"}</span>}
                  </label>
                </li>
              );
            })}
            {!rows.length ? <li className="meta" style={{ padding: 12 }}>Nothing matches.</li> : null}
          </ul>
          <div className="flex justify-end gap-2 mt-3">
            <Dialog.Close asChild><button className="btn primary">Done</button></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
