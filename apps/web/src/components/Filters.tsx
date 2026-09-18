/**
 * The one filter bar every list uses: a search field on the left, whatever
 * narrows the list in the middle, and the archived switch on the right. The
 * default view is always the working set — archived things are kept, not shown,
 * until asked for (D7: nothing is ever erased, so the lists would otherwise
 * only ever grow).
 */
import type { ReactNode } from "react";

export function FilterBar({ q, onSearch, placeholder, children, archived, count }: {
  q: string;
  onSearch: (q: string) => void;
  placeholder: string;
  /** Extra controls between the search and the archived switch. */
  children?: ReactNode;
  /** Omit for lists whose items cannot be archived. */
  archived?: { shown: boolean; total: number; onToggle: (shown: boolean) => void };
  /** "12 of 40" — shown when a search or filter is narrowing the list. */
  count?: { shown: number; total: number };
}) {
  return (
    <div className="filterbar" role="search">
      <label className="search">
        <svg viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        <input type="search" value={q} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} aria-label={placeholder} dir="auto" onKeyDown={(e) => { if (e.key === "Escape") onSearch(""); }} />
      </label>
      {children}
      {count && count.shown !== count.total ? <span className="meta count" aria-live="polite">{count.shown} of {count.total}</span> : null}
      {archived ? (
        <label className={`switch${archived.total ? "" : " off"}`}>
          <span className="track">
            <input type="checkbox" role="switch" checked={archived.shown} disabled={!archived.total} onChange={(e) => archived.onToggle(e.target.checked)} />
            <span className="knob" aria-hidden />
          </span>
          <span>Show archived{archived.total ? ` (${archived.total})` : ""}</span>
        </label>
      ) : null}
    </div>
  );
}
