/**
 * Bringing a suite in: from a file on this machine, or from a snapshot in the
 * backup bucket. The same dialog serves two doors — the products page (a new
 * product from the suite) and a product's overview (this product's suite becomes
 * the one in the file).
 *
 * Nothing is written until the last button. Into a new product, the preview is
 * the name and the counts. Over an existing product it is the plan — every test
 * and flow that would be created, edited or archived — made against the
 * product's current revision and applied against exactly that revision, so an
 * edit someone makes in the meantime is refused rather than overwritten.
 */
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, unwrap, type Schemas } from "../lib/api.ts";

type Suite = Schemas["Suite"];
type Plan = Schemas["SuitePlan"];
type Entry = Schemas["SuiteEntry"];
type Source = "file" | "bucket";

/** Where the suite goes: a new product, or over an existing one. */
export type Into = { kind: "new" } | { kind: "product"; id: string; name: string };

export function SuiteDialog({ open, into, onClose, onDone }: {
  open: boolean;
  into: Into;
  onClose: () => void;
  /** Called with the product the suite went into. */
  onDone: (product: { id: string; name: string }) => void;
}) {
  const status = useQuery({ queryKey: ["suites", "status"], queryFn: () => unwrap(api.GET("/suites/status")), staleTime: 60_000 });
  const [source, setSource] = useState<Source>("file");
  const [file, setFile] = useState<{ name: string; suite: Suite } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Entry | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSource("file"); setFile(null); setFileError(null); setPicked(null); setName(""); setBusy(false); setError(null);
  }, [open]);

  // A picked snapshot is read once, so both sources hand on the same thing: a suite.
  const snapshot = useQuery({
    queryKey: ["suites", "one", picked?.id],
    queryFn: () => unwrap(api.GET("/suites/{suiteId}", { params: { path: { suiteId: picked!.id } } })),
    enabled: !!picked,
  });
  const suite = source === "file" ? file?.suite : picked ? snapshot.data?.suite : undefined;

  const plan = useQuery({
    queryKey: ["suite-plan", into.kind === "product" ? into.id : "new", source, file?.name, picked?.id],
    queryFn: () => unwrap(api.POST("/products/{product}/suite/plan", { params: { path: { product: (into as { id: string }).id } }, body: suite! })),
    enabled: into.kind === "product" && !!suite,
    retry: false,
  });

  const canGo = !busy && !!suite && (into.kind === "new" ? (name.trim() || suite.product.name).length > 0 : !!plan.data && plan.data.changes.length > 0);

  async function go() {
    if (!canGo || !suite) return;
    setBusy(true); setError(null);
    try {
      if (into.kind === "new") {
        const productName = name.trim() || suite.product.name;
        const p = await unwrap(api.POST("/products", { body: { name: productName, description: suite.product.description ?? "" } }));
        try {
          await unwrap(api.PUT("/products/{product}/suite", { params: { path: { product: p.id } }, body: { force: true, suite: { ...suite, product: { ...suite.product, name: productName } } } }));
        } catch (e) {
          await api.DELETE("/products/{product}", { params: { path: { product: p.id }, query: { confirm: "true" } } });
          throw e;
        }
        onDone(p);
      } else {
        await unwrap(api.PUT("/products/{product}/suite", { params: { path: { product: into.id } }, body: { baseRevision: plan.data!.revision, force: false, suite } }));
        onDone({ id: into.id, name: into.name });
      }
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409 ? "The suite changed while this was open. Close and try again to see the new plan."
        : e instanceof ApiError && e.status === 400 ? "That suite has errors; nothing was changed."
        : e instanceof Error ? e.message : String(e),
      );
      setBusy(false);
    }
  }

  const counts = suite ? { tests: suite.tests.length, templates: suite.templates.length } : null;
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog suitedlg" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void go(); }}>
          <Dialog.Title asChild><h3>{into.kind === "new" ? "Import a suite" : `Replace the suite of ${into.name}`}</h3></Dialog.Title>
          <Dialog.Description asChild>
            <p className="meta" style={{ margin: "0 0 10px", fontSize: 13 }}>
              {into.kind === "new"
                ? "A suite file or a snapshot from the backup becomes a new product. Nothing existing is touched."
                : "This product's tests and flows become the suite's. Matched by key: what the suite leaves out is archived, never deleted, and runs keep their results."}
            </p>
          </Dialog.Description>

          <div className="radio" role="radiogroup" aria-label="Source">
            <button type="button" role="radio" aria-checked={source === "file"} className={source === "file" ? "on" : ""} onClick={() => setSource("file")}>
              <b>A file</b><span className="meta">Downloaded from Flowdeck</span>
            </button>
            <button type="button" role="radio" aria-checked={source === "bucket"} className={source === "bucket" ? "on" : ""} onClick={() => setSource("bucket")}>
              <b>The backup</b><span className="meta">{status.data?.available ? "Snapshots in the bucket" : "Not configured"}</span>
            </button>
          </div>

          {source === "file" ? (
            <FilePick file={file} error={fileError} onPick={(f, b) => { setFile({ name: f, suite: b }); setFileError(null); }} onError={(m) => { setFile(null); setFileError(m); }} />
          ) : (
            <BucketPick available={status.data?.available ?? false} picked={picked} onPick={setPicked} />
          )}

          {into.kind === "new" && suite && counts ? (
            <>
              <div className="preview">
                <b dir="auto">{suite.product.name}</b>
                <span className="meta">{counts.tests} {counts.tests === 1 ? "test" : "tests"} · {counts.templates} {counts.templates === 1 ? "template" : "templates"}</span>
              </div>
              <label className="f" htmlFor="suite-name">Name the new product</label>
              <input id="suite-name" type="text" value={name} onChange={(e) => setName(e.target.value)} dir="auto" placeholder={suite.product.name} />
            </>
          ) : null}

          {into.kind === "product" && suite ? <PlanPreview plan={plan.data} pending={plan.isPending} failed={plan.error} /> : null}

          {error ? <p className="note" style={{ marginLeft: 0 }}>{error}</p> : null}
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn primary" disabled={!canGo} onClick={() => void go()}>
              {busy ? "Importing…" : into.kind === "new" ? "Create product" : plan.data?.changes.length ? `Apply ${plan.data.changes.length} ${plan.data.changes.length === 1 ? "change" : "changes"}` : "Apply"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The plan, one line each, as the CLI prints it: + created or restored, ~ edited, - archived. */
function PlanPreview({ plan, pending, failed }: { plan: Plan | undefined; pending: boolean; failed: Error | null }) {
  if (failed) {
    const details = failed instanceof ApiError ? (failed.body as { details?: { level: string; message: string }[] } | null)?.details : undefined;
    return (
      <div className="note" style={{ marginLeft: 0 }}>
        That suite has errors, so nothing can be applied:
        <ul className="errlist">{(details ?? []).filter((d) => d.level === "error").slice(0, 6).map((d, i) => <li key={i}>{d.message}</li>)}</ul>
      </div>
    );
  }
  if (pending || !plan) return <p className="meta" style={{ margin: "12px 0 0" }}>Working out what would change…</p>;
  if (!plan.summary.length) return <p className="meta" style={{ margin: "12px 0 0" }}>Nothing would change: the product already holds exactly this suite.</p>;
  return (
    <ul className="planlist" aria-label="What would change">
      {plan.summary.slice(0, 40).map((line, i) => <li key={i} data-op={line[0]}>{line}</li>)}
      {plan.summary.length > 40 ? <li className="meta">…and {plan.summary.length - 40} more</li> : null}
    </ul>
  );
}

function FilePick({ file, error, onPick, onError }: { file: { name: string } | null; error: string | null; onPick: (name: string, s: Suite) => void; onError: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  async function read(f: File) {
    try {
      // A download is { revision, suite }; a hand-written file may be the bare suite.
      const raw = JSON.parse(await f.text()) as { suite?: Partial<Suite> } & Partial<Suite>;
      const parsed = raw && typeof raw === "object" && raw.suite ? raw.suite : raw;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tests) || !Array.isArray(parsed.templates) || !parsed.product?.name) {
        onError("This is not a Flowdeck suite file. It needs product, tests and templates — what “Download as a file” produces.");
        return;
      }
      onPick(f.name, parsed as Suite);
    } catch {
      onError("That file is not JSON.");
    }
  }
  return (
    <>
      <div
        className={`drop${over ? " over" : ""}${file ? " has" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void read(f); }}
      >
        {file ? <span><b>{file.name}</b></span> : <span>Drop a suite file here, or</span>}
        <button type="button" className="btn sm" onClick={() => input.current?.click()}>{file ? "Choose another" : "Choose a file"}</button>
        <input ref={input} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
      </div>
      {error ? <p className="note" style={{ marginLeft: 0 }}>{error}</p> : null}
    </>
  );
}

function BucketPick({ available, picked, onPick }: { available: boolean; picked: Entry | null; onPick: (e: Entry) => void }) {
  const list = useQuery({ queryKey: ["suites", "all"], queryFn: () => unwrap(api.GET("/suites", { params: { query: {} } })), enabled: available });
  if (!available) {
    return <p className="meta" style={{ margin: "12px 0 0" }}>No backup bucket is configured. Set <span className="kbd">BACKUP_REPOSITORY</span> and the S3 key in <span className="kbd">.env</span> — the same values the backup service uses — and snapshots appear here.</p>;
  }
  if (list.isPending) return <p className="meta" style={{ margin: "12px 0 0" }}>Reading the bucket…</p>;
  if (!list.data?.length) return <p className="meta" style={{ margin: "12px 0 0" }}>Nothing saved yet. “Save to backup” on a product's overview puts a snapshot here.</p>;
  return (
    <ul className="snaplist" role="listbox" aria-label="Snapshots">
      {list.data.map((s) => (
        <li key={s.id}>
          <button type="button" role="option" aria-selected={picked?.id === s.id} className={picked?.id === s.id ? "on" : ""} onClick={() => onPick(s)}>
            <b dir="auto">{s.productName}</b>
            <span className="meta">{when(s.savedAt)} · {s.savedBy} · {s.tests} tests, {s.templates} templates</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
