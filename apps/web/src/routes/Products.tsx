import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "../lib/api.ts";
import { useTitle } from "../lib/title.ts";

export function Products() {
  const products = useQuery({ queryKey: ["products"], queryFn: () => unwrap(api.GET("/products")) });
  useTitle("Products — Flowdeck");
  return (
    <main className="shell">
      <div className="pagehead">
        <div>
          <h1>Products</h1>
          <p className="sub">Each product has its own test library and templates. Nothing is shared between them.</p>
        </div>
      </div>
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
      {products.data && !products.data.length ? (
        <div className="empty"><b>No products yet</b><span>Products are created through the API — see the import guide in the docs.</span></div>
      ) : null}
    </main>
  );
}
