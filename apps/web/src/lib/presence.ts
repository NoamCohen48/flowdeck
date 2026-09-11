import { useEffect } from "react";
import { api } from "./api.ts";

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
