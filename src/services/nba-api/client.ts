// Client for the NBA's stats API (the endpoints behind nba.com/stats).
//
// Undocumented and header-sensitive. The header set below is lifted from the
// `nba_api` Python package, which is the de-facto reference for these endpoints,
// and verified working from a plain fetch — no Python is needed at runtime.
//
// ── The failure mode to know about ──────────────────────────────────────────
//
// When this API declines a request it does NOT return 403. It completes the TLS
// handshake, accepts the request, and then never replies — so a wrong header set
// is indistinguishable from a network outage. Two headers matter more than they
// look:
//
//   Referer must be https://www.nba.com/  — not https://stats.nba.com/
//   The Sec-Ch-Ua / Sec-Fetch-Dest headers must be present
//
// And the `x-nba-stats-origin` / `x-nba-stats-token` headers that circulate in
// blog posts and Stack Overflow answers are NOT sent by nba_api. Adding them
// while omitting the Sec-* headers is what produced hours of "the API is
// blocking us" during design. It was not.
//
// Because a rejection looks like a hang, every request carries a timeout and
// reports it as a distinct error rather than letting a caller wait forever.

const BASE_URL = "https://stats.nba.com/stats";

/** Verified working. Do not add x-nba-stats-* headers; see the note above. */
const HEADERS: Record<string, string> = {
  Host: "stats.nba.com",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  Connection: "keep-alive",
  Referer: "https://www.nba.com/",
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  "Sec-Ch-Ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Fetch-Dest": "empty",
};

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * The envelope every stats endpoint returns.
 *
 * Note the shape: `headers` is a column-name array and `rowSet` is an array of
 * positional arrays. Values are NOT keyed by name on the wire, which is why
 * `rowsToObjects` exists and why nothing should index `rowSet` by a hard-coded
 * position — column order is not part of any contract.
 */
export type StatsResultSet = {
  name: string;
  headers: string[];
  rowSet: unknown[][];
};

export type StatsResponse = {
  resource: string;
  parameters: Record<string, unknown>;
  resultSets: StatsResultSet[];
};

export class NbaApiError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "NbaApiError";
  }
}

/** Zip a result set's column names onto its rows. */
export function rowsToObjects<T = Record<string, unknown>>(
  set: StatsResultSet,
): T[] {
  return set.rowSet.map((row) => {
    const out: Record<string, unknown> = {};
    set.headers.forEach((h, i) => (out[h] = row[i]));
    return out as T;
  });
}

/**
 * Call a stats endpoint and return the parsed body, whatever its shape.
 *
 * `params` are appended as-is. Many endpoints require parameters to be present
 * but empty (`LeagueID=`), so empty strings are sent rather than dropped.
 *
 * ── Why this is separate from `nbaStats` ──────────────────────────────────
 *
 * The classic endpoints answer with `{ resultSets: [{ headers, rowSet }] }`.
 * The v3 endpoints do not — `scoreboardv3` answers with
 * `{ scoreboard: { games: [...] } }`, already keyed by name. Running it through
 * `nbaStats` fails on the result-set assertion, which is a correct assertion for
 * the endpoints that have result sets and simply does not apply here.
 *
 * So the transport is shared and the envelope check is not.
 */
export async function nbaStatsJson<T = unknown>(
  endpoint: string,
  params: Record<string, string> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const url = `${BASE_URL}/${endpoint}?${new URLSearchParams(params)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new NbaApiError(
        `${endpoint} did not respond within ${timeoutMs / 1000}s. This API holds ` +
          `the connection open rather than refusing, so a timeout usually means ` +
          `the request was declined — check the headers in this file before ` +
          `assuming a network problem.`,
        endpoint,
      );
    }
    throw new NbaApiError(`${endpoint} failed: ${String(err)}`, endpoint);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new NbaApiError(`${endpoint} returned ${res.status}`, endpoint, res.status);
  }

  return (await res.json()) as T;
}

/**
 * Call a classic stats endpoint, asserting the result-set envelope.
 *
 * Use this for anything that returns `headers` + `rowSet`. For the v3 endpoints
 * that return named JSON instead, use `nbaStatsJson`.
 */
export async function nbaStats(
  endpoint: string,
  params: Record<string, string> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<StatsResponse> {
  const body = await nbaStatsJson<StatsResponse>(endpoint, params, timeoutMs);
  if (!body.resultSets?.length) {
    throw new NbaApiError(`${endpoint} returned no result sets`, endpoint);
  }
  return body;
}

/** Fetch an endpoint and return its first result set as objects. */
export async function nbaStatsRows<T = Record<string, unknown>>(
  endpoint: string,
  params: Record<string, string> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T[]> {
  const body = await nbaStats(endpoint, params, timeoutMs);
  return rowsToObjects<T>(body.resultSets[0]);
}
