import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "../lib/api.ts";
import { useTitle } from "../lib/title.ts";

export function Products() {
  const products = useQuery({ queryKey: ["products"], queryFn: () => unwrap(api.GET("/products")) });
  useTitle("Products — Flowdeck");
  return (
    <main className="shell">
      <h1>Products</h1>
      <p className="sub">Each product has its own test library and templates. Nothing is shared between them.</p>
      <div className="grid2">
        {(products.data ?? []).map((p) => (
          <Link key={p.id} className="panel pad" to="/products/$productId" params={{ productId: p.id }} style={{ textDecoration: "none" }}>
            <h3 dir="auto">{p.name}</h3>
            <p className="meta" style={{ margin: 0 }} dir="auto">{p.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
