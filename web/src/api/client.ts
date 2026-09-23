/**
 * Every request to the gym, in one place.
 *
 * A thin wrapper rather than a client library: the API is a handful of GETs returning shapes
 * already described in `src/wire.ts`, and the value here is that a non-2xx becomes a thrown error
 * with the server's own words in it, so TanStack Query can retry, cache and report it.
 */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    // The server says why in `error`; falling back to the status is better than an empty message.
    const said = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(response.status, said?.error ?? `${response.status} ${response.statusText}`);
  }
  return await response.json() as T;
}
