import { Link, Outlet, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "../lib/api.ts";
import { useMe } from "../lib/identity.tsx";
import { useTheme } from "../lib/theme.ts";

export function Root() {
  const { productId } = useParams({ strict: false }) as { productId?: string };
  const me = useMe();
  const products = useQuery({ queryKey: ["products"], queryFn: () => unwrap(api.GET("/products")) });
  const product = products.data?.find((p) => p.id === productId);
  const [theme, cycleTheme] = useTheme();

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Flowdeck {product ? <span dir="auto">/ {product.name}</span> : null}
        </Link>
        {products.data && products.data.length > 1 ? (
          <select
            aria-label="Product"
            value={productId ?? ""}
            onChange={(e) => { if (e.target.value) window.location.assign(`/products/${e.target.value}`); }}
            style={{ width: "auto", background: "var(--topbar-hover)", color: "var(--topbar-ink)", border: 0, fontSize: 13.5 }}
          >
            <option value="">Switch product…</option>
            {products.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : null}
        <nav className="topnav">
          {productId ? <Link to="/products/$productId" params={{ productId }} activeOptions={{ exact: true }}>Overview</Link> : null}
          <button onClick={cycleTheme} title={`Theme: ${theme}`} aria-label={`Theme: ${theme}. Click to change.`}>
            {theme === "dark" ? "☾" : theme === "light" ? "☼" : "◐"}
          </button>
          <button title="Signed in as" onClick={() => { document.cookie = "flowdeck_actor=; Max-Age=0; path=/"; window.location.reload(); }}>
            <span dir="auto">{me.name}</span> · switch
          </button>
        </nav>
      </header>
      <Outlet />
    </>
  );
}
