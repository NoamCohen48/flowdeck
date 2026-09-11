/**
 * The name picker (D38). Not authentication: seven people in one room, no roles,
 * every change attributed. Everything that writes reads `useMe()`.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./api.ts";

const MeContext = createContext<{ name: string | null; setName: (n: string) => Promise<void> }>({
  name: null,
  setName: async () => {},
});

export function IdentityProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => unwrap(api.GET("/me")),
    staleTime: Infinity,
  });

  async function setName(name: string) {
    await unwrap(api.PUT("/me", { body: { name } }));
    await qc.invalidateQueries({ queryKey: ["me"] });
    await qc.invalidateQueries({ queryKey: ["actors"] });
  }

  if (me.isPending) return null;
  const name = me.data?.name ?? null;
  return (
    <MeContext.Provider value={{ name, setName }}>
      {name ? children : <NamePicker onPick={setName} />}
    </MeContext.Provider>
  );
}

export function useMe() {
  return useContext(MeContext);
}

function NamePicker({ onPick }: { onPick: (name: string) => Promise<void> }) {
  const actors = useQuery({
    queryKey: ["actors"],
    queryFn: () => unwrap(api.GET("/actors")),
  });
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Who are you? — Flowdeck";
  }, []);

  async function pick(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onPick(trimmed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell" style={{ maxWidth: 520, paddingTop: 60 }}>
      <h1>Who are you?</h1>
      <p className="sub">
        Everything you record is attributed to a name. There is no password — this is a room of
        seven people, not a bank.
      </p>
      <div className="panel pad stack">
        {actors.data?.length ? (
          <div className="flex flex-wrap gap-2">
            {actors.data.map((a) => (
              <button key={a} className="btn" disabled={busy} onClick={() => pick(a)}>
                {a}
              </button>
            ))}
          </div>
        ) : null}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void pick(typed);
          }}
        >
          <input
            type="text"
            placeholder={actors.data?.length ? "Or a new name" : "Your name"}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            dir="auto"
            autoFocus
          />
          <button className="btn primary" disabled={busy || !typed.trim()} type="submit">
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
