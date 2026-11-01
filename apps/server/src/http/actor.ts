import { createMiddleware } from "hono/factory";
import { getSignedCookie, setSignedCookie } from "hono/cookie";

/**
 * Identity. A name picker, not authentication.
 *
 * Seven people in one room, no roles, every change attributed. Real
 * authentication would add password resets, session security and an IdP dependency
 * to counter a threat that does not exist inside this team. It is trivially
 * spoofable and that is understood.
 *
 * Everything downstream reads `c.get("actor")`, so replacing this middleware with
 * OIDC later changes no call sites.
 */

export const ACTOR_COOKIE = "flowdeck_actor";

/**
 * The same identity, for scripts. An import script or a tracker adapter has no
 * cookie jar; it names itself on every request instead. The header wins over the
 * cookie when both are present, so a script run from a signed-in machine is still
 * attributed to the name it chose.
 */
export const ACTOR_HEADER = "X-Flowdeck-Actor";
export const ACTOR_NAME_MAX = 60;

/**
 * Empty counts as unset: `.env` files ship `COOKIE_SECRET=` blank, and an
 * empty HMAC key makes the signer throw on every sign-in with a DataError that
 * says nothing about cookies. Fail at boot with the real reason instead.
 */
const SECRET = (() => {
  const given = process.env.COOKIE_SECRET?.trim() ?? "";
  if (given.length >= 16) return given;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      given ? "COOKIE_SECRET is too short: use at least 16 characters (openssl rand -hex 32)" : "COOKIE_SECRET must be set in production (openssl rand -hex 32)",
    );
  }
  return "dev-only-not-a-secret";
})();

export type ActorEnv = { Variables: { actor: string | null } };

export const withActor = createMiddleware<ActorEnv>(async (c, next) => {
  const header = c.req.header(ACTOR_HEADER)?.trim() ?? "";
  if (header.length > 0) {
    c.set("actor", header.slice(0, ACTOR_NAME_MAX));
  } else {
    const name = await getSignedCookie(c, SECRET, ACTOR_COOKIE);
    c.set("actor", typeof name === "string" && name.length > 0 ? name : null);
  }
  await next();
});

export async function setActor(
  c: Parameters<typeof setSignedCookie>[0],
  name: string,
): Promise<void> {
  await setSignedCookie(c, ACTOR_COOKIE, name, SECRET, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * Every write is attributed, so a request without an identity is refused rather than
 * recorded as "unknown" — an unattributed result is worse than a blocked one, because
 * the audit trail is the only thing standing in for a permission system.
 */
export function requireActor(c: { get: (k: "actor") => string | null }): string {
  const actor = c.get("actor");
  if (!actor) {
    throw new ActorRequiredError();
  }
  return actor;
}

export class ActorRequiredError extends Error {
  constructor() {
    super(
      "Tell us who you are before recording anything: sign in with PUT /api/me, or send an X-Flowdeck-Actor header.",
    );
    this.name = "ActorRequiredError";
  }
}
