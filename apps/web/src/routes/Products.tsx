import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../lib/api.ts";
import { useTitle } from "../lib/title.ts";
import { SuiteDialog } from "../components/SuiteDialog.tsx";

export function Products() {
  const products = useQuery({ queryKey: ["products"], queryFn: () => unwrap(api.GET("/products")) });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  useTitle("Products — Flowdeck");

  async function createProduct(name: string, description: string) {
    const p = await unwrap(api.POST("/products", { body: { name, description } }));
    await qc.invalidateQueries({ queryKey: ["products"] });
    void navigate({ to: "/products/$productId", params: { productId: p.id } });
  }

  return (
    <main className="shell">
      <div className="pagehead">
        <div>
          <h1>Products</h1>
          <p className="sub">Each product has its own test library and templates. Nothing is shared between them.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setImporting(true)}>Import a suite</button>
          <button className="btn primary" onClick={() => setCreating(true)}>New product</button>
        </div>
      </div>
      <SuiteDialog
        open={importing}
        into={{ kind: "new" }}
        onClose={() => setImporting(false)}
        onDone={async (p) => { setImporting(false); await qc.invalidateQueries({ queryKey: ["products"] }); void navigate({ to: "/products/$productId", params: { productId: p.id } }); }}
      />
      {creating ? <NewProduct onSave={createProduct} onCancel={() => setCreating(false)} /> : null}
      <div className="prodgrid">
        {(products.data ?? []).map((p) => (
          <Link key={p.id} className="prodcard" to="/products/$productId" params={{ productId: p.id }}>
            <span className="glyph" aria-hidden>{p.name.trim().charAt(0).toUpperCase()}</span>
            <span style={{ minWidth: 0 }}>
              <h3 dir="auto">{p.name}</h3>
              <p dir="auto">{p.description}</p>
              <span className="go">Open overview</span>
            </span>
          </Link>
        ))}
      </div>
      {products.data && !products.data.length && !creating ? (
        <div className="empty">
          <b>No products yet</b>
          <span>A product is one system under test, with its own library of tests and its own templates.</span>
          <div className="flex gap-2"><button className="btn primary" onClick={() => setCreating(true)}>Create the first product</button><button className="btn" onClick={() => setImporting(true)}>Import a suite</button></div>
        </div>
      ) : null}
    </main>
  );
}

function NewProduct({ onSave, onCancel }: { onSave: (name: string, description: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await onSave(name.trim(), description.trim()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return (
    <div className="panel pad" style={{ borderColor: "var(--primary-line)", marginBottom: 16 }}>
      <label className="f" htmlFor="prod-name" style={{ marginTop: 0 }}>Product name</label>
      <input id="prod-name" type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} dir="auto" placeholder="Relay" onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") onCancel(); }} />
      <label className="f" htmlFor="prod-desc">What is it? <span className="meta">(optional)</span></label>
      <textarea id="prod-desc" value={description} onChange={(e) => setDescription(e.target.value)} dir="auto" placeholder="The messaging app — phone, tablet and web clients." style={{ minHeight: 56 }} />
      {error ? <p className="note" style={{ marginLeft: 0 }}>{error}</p> : null}
      <div className="flex gap-2 mt-3">
        <button className="btn primary" disabled={!name.trim() || busy} onClick={() => void save()}>Create product</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
