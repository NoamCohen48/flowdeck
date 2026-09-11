import { createMiddleware } from "hono/factory";
import { getSignedCookie, setSignedCookie } from "hono/cookie";

/**
 * Identity (D38). A name picker, not authentication.
 *
 * Seven people in one room, no roles (D24), every change attributed. Real
 * authentication would add password resets, session security and an IdP dependency
 * to counter a threat that does not exist inside this team. It is trivially
 * spoofable and that is understood.
 *
 * Everything downstream reads `c.get("actor")`, so replacing this middleware with
 * OIDC later changes no call sites.
 */

export const ACTOR_COOKIE = "flowdeck_actor";

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
  const name = await getSignedCookie(c, SECRET, ACTOR_COOKIE);
  c.set("actor", typeof name === "string" && name.length > 0 ? name : null);
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
    super("Tell us who you are before recording anything.");
    this.name = "ActorRequiredError";
  }
}
