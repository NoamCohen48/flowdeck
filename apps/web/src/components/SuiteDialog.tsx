/**
 * Bringing a suite in: from a file on this machine, or from a snapshot in the
 * backup bucket. The same dialog serves two doors — the products page (a new
 * product from the suite) and a product's overview (add it to this product).
 *
 * Nothing is written until the last button. The middle of the dialog is a
 * preview — the product's name, how many tests and templates — so what is
 * about to happen is visible before it does.
 */
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, unwrap, type Schemas } from "../lib/api.ts";

type Bundle = Schemas["ExportBundle"];
type Entry = Schemas["SuiteEntry"];
type Source = "file" | "bucket";

/** Where the suite goes: a new product, or the tests and templates of an existing one. */
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
  const [file, setFile] = useState<{ name: string; bundle: Bundle } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Entry | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSource("file"); setFile(null); setFileError(null); setPicked(null); setName(""); setBusy(false); setError(null);
  }, [open]);

  const chosen = source === "file" ? file?.bundle.product : picked ? { name: picked.productName } : null;
  const counts = source === "file"
    ? file ? { tests: file.bundle.tests.length, templates: file.bundle.templates.length } : null
    : picked ? { tests: picked.tests, templates: picked.templates } : null;
  const canGo = !busy && !!chosen && (into.kind === "product" || (name.trim() || chosen.name).length > 0);

  async function go() {
    if (!canGo) return;
    setBusy(true); setError(null);
    try {
      if (source === "file" && file) {
        const b = file.bundle;
        if (into.kind === "new") {
          const r = await unwrap(api.POST("/products/import", { body: { product: { name: name.trim() || b.product.name, description: b.product.description }, tests: b.tests, templates: b.templates } }));
          onDone(r.product);
        } else {
          await unwrap(api.POST("/products/{productId}/import", { params: { path: { productId: into.id } }, body: { tests: b.tests, templates: b.templates } }));
          onDone({ id: into.id, name: into.name });
        }
      } else if (picked) {
        const body = into.kind === "new" ? { into: "new" as const, name: name.trim() || undefined } : { into: into.id };
        const r = await unwrap(api.POST("/suites/{suiteId}/import", { params: { path: { suiteId: picked.id } }, body }));
        onDone(r.product);
      }
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? "That suite does not fit: a step marks a test that is neither in the file nor in this product." : e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog suitedlg" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void go(); }}>
          <Dialog.Title asChild><h3>{into.kind === "new" ? "Import a suite" : `Import into ${into.name}`}</h3></Dialog.Title>
          <Dialog.Description asChild>
            <p className="meta" style={{ margin: "0 0 10px", fontSize: 13 }}>
              {into.kind === "new"
                ? "A suite file or a snapshot from the backup becomes a new product. Nothing existing is touched."
                : "The suite's tests and templates are added to this product. Existing ones stay; nothing is merged or replaced."}
            </p>
          </Dialog.Description>

          <div className="radio" role="radiogroup" aria-label="Source">
            <button type="button" role="radio" aria-checked={source === "file"} className={source === "file" ? "on" : ""} onClick={() => setSource("file")}>
              <b>A file</b><span className="meta">Exported from Flowdeck</span>
            </button>
            <button type="button" role="radio" aria-checked={source === "bucket"} className={source === "bucket" ? "on" : ""} onClick={() => setSource("bucket")}>
              <b>The backup</b><span className="meta">{status.data?.available ? "Snapshots in the bucket" : "Not configured"}</span>
            </button>
          </div>

          {source === "file" ? (
            <FilePick file={file} error={fileError} onPick={(f, b) => { setFile({ name: f, bundle: b }); setFileError(null); }} onError={(m) => { setFile(null); setFileError(m); }} />
          ) : (
            <BucketPick available={status.data?.available ?? false} picked={picked} onPick={setPicked} />
          )}

          {source === "file" && chosen && counts ? (
            <div className="preview">
              <b dir="auto">{chosen.name}</b>
              <span className="meta">{counts.tests} {counts.tests === 1 ? "test" : "tests"} · {counts.templates} {counts.templates === 1 ? "template" : "templates"}</span>
            </div>
          ) : null}

          {into.kind === "new" && chosen ? (
            <>
              <label className="f" htmlFor="suite-name">Name the new product</label>
              <input id="suite-name" type="text" value={name} onChange={(e) => setName(e.target.value)} dir="auto" placeholder={chosen.name} />
            </>
          ) : null}

          {error ? <p className="note" style={{ marginLeft: 0 }}>{error}</p> : null}
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn primary" disabled={!canGo} onClick={() => void go()}>
              {busy ? "Importing…" : into.kind === "new" ? "Create product" : "Add to product"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FilePick({ file, error, onPick, onError }: { file: { name: string } | null; error: string | null; onPick: (name: string, b: Bundle) => void; onError: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  async function read(f: File) {
    try {
      const parsed = JSON.parse(await f.text()) as Partial<Bundle>;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tests) || !Array.isArray(parsed.templates) || !parsed.product?.name) {
        onError("This is not a Flowdeck suite file. It needs product, tests and templates — what “Download as a file” produces.");
        return;
      }
      onPick(f.name, parsed as Bundle);
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
