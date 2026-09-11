import { useRef, type ReactNode } from "react";
import { Link, Outlet, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "../lib/api.ts";
import { useMe } from "../lib/identity.tsx";
import { useTheme, type Theme } from "../lib/theme.ts";

export function Root() {
  const { productId } = useParams({ strict: false }) as { productId?: string };
  const me = useMe();
  const products = useQuery({ queryKey: ["products"], queryFn: () => unwrap(api.GET("/products")) });
  const product = products.data?.find((p) => p.id === productId);
  const [theme, setTheme] = useTheme();

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="mark" aria-hidden><BrandMark /></span>
          Flowdeck
        </Link>

        {products.data?.length ? (
          <Menu
            align="left"
            trigger={
              <span className="switcher">
                {product ? <span dir="auto">{product.name}</span> : <span className="placeholder">Choose a product</span>}
                <Chevron />
              </span>
            }
            label="Switch product"
          >
            <span className="cap">Products</span>
            {products.data.map((p) => (
              <Link key={p.id} to="/products/$productId" params={{ productId: p.id }} aria-current={p.id === productId ? "true" : undefined}>
                <span className="avatar" aria-hidden style={{ background: p.id === productId ? "var(--primary)" : "var(--primary-soft)", color: p.id === productId ? "var(--on-primary)" : "var(--primary-ink)" }}>
                  {initial(p.name)}
                </span>
                <span dir="auto">{p.name}<span className="desc" dir="auto">{p.description}</span></span>
              </Link>
            ))}
            <hr />
            <Link to="/">All products</Link>
          </Menu>
        ) : null}

        {productId ? (
          <>
            <span className="topsep" aria-hidden />
            <nav className="tabs" aria-label="Product">
              <Link to="/products/$productId" params={{ productId }} activeOptions={{ exact: true }}>Overview</Link>
              <Link to="/products/$productId/templates" params={{ productId }}>Templates</Link>
              <Link to="/products/$productId/runs" params={{ productId }}>Runs</Link>
              <Link to="/products/$productId/tests" params={{ productId }} search={{ test: undefined }}>Tests</Link>
            </nav>
          </>
        ) : null}

        <div className="topright">
          <Menu
            align="right"
            label={`Theme: ${theme}`}
            trigger={<span className="iconbtn" title="Theme"><ThemeIcon theme={theme} /></span>}
          >
            <span className="cap">Appearance</span>
            {(["system", "light", "dark"] as Theme[]).map((t) => (
              <button key={t} type="button" onClick={() => setTheme(t)} aria-current={t === theme ? "true" : undefined} style={t === theme ? { background: "var(--primary-soft)", color: "var(--primary-ink)", fontWeight: 500 } : undefined}>
                <ThemeIcon theme={t} />
                {{ system: "Match the system", light: "Light", dark: "Dark" }[t]}
              </button>
            ))}
          </Menu>

          <Menu
            align="right"
            label="Account"
            trigger={
              <span className="me">
                <span className="avatar" aria-hidden>{initial(me.name ?? "?")}</span>
                <span className="name" dir="auto">{me.name}</span>
                <Chevron />
              </span>
            }
          >
            <div className="whoami">
              <span className="avatar" aria-hidden>{initial(me.name ?? "?")}</span>
              <span><b dir="auto">{me.name}</b><span className="desc">Everything you record is attributed to this name</span></span>
            </div>
            <hr />
            <button type="button" onClick={() => { document.cookie = "flowdeck_actor=; Max-Age=0; path=/"; window.location.reload(); }}>
              <SwapIcon />
              Switch person
            </button>
          </Menu>
        </div>
      </header>
      <Outlet />
    </>
  );
}

/**
 * A dropdown built on <details>: opens and closes without script, dismisses on
 * a click outside via the backdrop, and closes itself after any choice inside.
 */
function Menu({ trigger, children, align, label }: { trigger: ReactNode; children: ReactNode; align: "left" | "right"; label: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  return (
    <details className="dd" ref={ref} onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
      <summary aria-label={label}>{trigger}</summary>
      <div className="backdrop" onClick={close} aria-hidden />
      <div className={`sheet ${align}`} onClick={close}>{children}</div>
    </details>
  );
}

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function BrandMark() {
  // Three step bands, the way a flow reads down the page.
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="1" y="2" width="12" height="2.4" rx="1.2" fill="#fff" />
      <rect x="1" y="5.8" width="8.5" height="2.4" rx="1.2" fill="#fff" opacity="0.8" />
      <rect x="1" y="9.6" width="10.5" height="2.4" rx="1.2" fill="#fff" opacity="0.6" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg className="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, width: 18, height: 18, "aria-hidden": true };
  if (theme === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg {...common}>
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden>
      <path d="M16 3l4 4-4 4M20 7H8M8 21l-4-4 4-4M4 17h12" />
    </svg>
  );
}
