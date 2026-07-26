const API = "https://api.spotify.com/v1";

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;
let quotaListener: (() => void) | null = null;

/** The auth store registers how to obtain a fresh access token. */
export function registerTokenProvider(fn: TokenProvider) {
  tokenProvider = fn;
}

/** UI subscribes to be notified when we hit the dev-mode quota bucket (429). */
export function onQuotaExceeded(fn: () => void) {
  quotaListener = fn;
}

export class QuotaError extends Error {
  constructor() {
    super("QUOTA_EXCEEDED");
    this.name = "QuotaError";
  }
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Fetch against the Spotify Web API with auth + one 429/5xx retry. */
export async function spotifyFetch<T = unknown>(
  path: string,
  opts: RequestInit = {},
  attempt = 0,
): Promise<T> {
  const token = await tokenProvider();
  if (!token) throw new ApiError(401, "not authenticated");

  const res = await fetch(path.startsWith("http") ? path : API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });

  if (res.status === 429) {
    quotaListener?.();
    const retryAfter = Number(res.headers.get("retry-after") || "1");
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, (retryAfter + 0.5) * 1000));
      return spotifyFetch<T>(path, opts, attempt + 1);
    }
    throw new QuotaError();
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (data as { error?: { message?: string } })?.error?.message ||
        `HTTP ${res.status}`,
    );
  }
  return data as T;
}
