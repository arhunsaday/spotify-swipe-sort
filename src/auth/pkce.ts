import type { Tokens } from "@/types";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

export const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
  "user-library-modify",
  "user-read-private", // for /me `product` (Premium check)
].join(" ");

const LS = {
  clientId: "sw.clientId",
  verifier: "sw.pkce_verifier",
  state: "sw.pkce_state",
} as const;

/** Redirect URI = app origin root. Register this EXACTLY in the dashboard.
 *  Local dev resolves to http://127.0.0.1:5173/ (loopback, not localhost). */
export function redirectUri(): string {
  return window.location.origin + "/";
}

function b64url(bytes: ArrayBuffer): string {
  const s = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(len = 64): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  const charset =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from(arr, (b) => charset[b % charset.length]).join("");
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return b64url(digest);
}

export function getClientId(): string {
  return (
    localStorage.getItem(LS.clientId) ||
    import.meta.env.VITE_SPOTIFY_CLIENT_ID ||
    ""
  );
}

export function setClientId(id: string) {
  localStorage.setItem(LS.clientId, id.trim());
}

/** Kick off the Authorization Code + PKCE flow (full-page redirect). */
export async function beginLogin(): Promise<void> {
  const clientId = getClientId();
  if (!clientId) throw new Error("missing client id");
  const verifier = randomString();
  const state = randomString(16);
  localStorage.setItem(LS.verifier, verifier);
  localStorage.setItem(LS.state, state);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: await challenge(verifier),
    state,
  });
  window.location.assign(`${AUTH_URL}?${params}`);
}

/** If we came back from Spotify with ?code=, exchange it. Returns tokens or null. */
export async function completeLoginFromRedirect(): Promise<Tokens | null> {
  const q = new URLSearchParams(window.location.search);
  const err = q.get("error");
  if (err) {
    cleanUrl();
    throw new Error(`auth error: ${err}`);
  }
  const code = q.get("code");
  if (!code) return null;
  if (q.get("state") !== localStorage.getItem(LS.state)) {
    cleanUrl();
    throw new Error("state mismatch");
  }
  const verifier = localStorage.getItem(LS.verifier) || "";
  const body = new URLSearchParams({
    client_id: getClientId(),
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  cleanUrl();
  if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

/** Refresh, carrying the old refresh_token forward if Spotify omits a new one. */
export async function refreshTokens(current: Tokens): Promise<Tokens> {
  const body = new URLSearchParams({
    client_id: getClientId(),
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`refresh failed: ${JSON.stringify(data)}`);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || current.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

function cleanUrl() {
  window.history.replaceState({}, "", redirectUri());
}
