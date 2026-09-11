import { useEffect, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { api } from "./api.ts";
import { presenceOf, type PresenceRow } from "./collections.ts";

/** Heartbeat every 20s while the scope is open; leave on unmount (D37). */
export function usePresence(scope: string) {
  useEffect(() => {
    const beat = () => void api.PUT("/presence", { body: { scope } });
    beat();
    const id = setInterval(beat, 20_000);
    return () => {
      clearInterval(id);
      void api.DELETE("/presence", { body: { scope } });
    };
  }, [scope]);
}

const STALE_MS = 60_000;

/**
 * Who is in a scope right now. A tab that was closed without saying goodbye
 * (a crashed browser, a phone locked mid-flow) stops being "here" once its
 * heartbeat is a minute old, whether or not the server has swept the row yet.
 */
export function usePeers(scope: string): string[] {
  const coll = presenceOf(scope);
  const q = useLiveQuery(() => coll, [coll]);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);
  const cutoff = Date.now() - STALE_MS;
  return ((q.data ?? []) as PresenceRow[])
    .filter((p) => new Date(p.last_seen_at).getTime() > cutoff)
    .map((p) => p.actor);
}
