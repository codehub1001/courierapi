/**
 * utils/geocodeAddress.js
 *
 * Swiftbox Lagos geocoding service.
 *
 * Resolution order:
 *   1. OpenStreetMap Nominatim (EXACT / STREET results only)
 *   2. Built-in Lagos area matrix (AREA precision, approximate)
 *   3. Best AREA-level Nominatim result, if any
 *   4. null
 *
 * Production safeguards:
 *   - Serialised, rate-limited outbound requests (Nominatim policy: max 1 req/s)
 *   - LRU + TTL cache and in-flight de-duplication (Nominatim policy: cache results)
 *   - Circuit breaker, honouring Retry-After on 429
 *   - Overall deadline so a request can never hang for tens of seconds
 *   - Results restricted to Lagos (viewbox + bounds + state check)
 *   - Addresses are personal data: they are never written to logs, only a short hash
 *
 * Config (env):
 *   GEOCODING_USER_AGENT      Required in production for the public Nominatim instance.
 *                             Must identify your app and a real contact address.
 *   GEOCODING_BASE_URL        Override to use a self-hosted Nominatim or a paid provider
 *                             exposing the same /search API.
 *   GEOCODING_MIN_INTERVAL_MS Min gap between upstream requests (default 1100; use 0
 *                             only for a self-hosted instance).
 *
 * Requires Node 18+ (global fetch, AbortSignal.timeout, structuredClone).
 *
 * Callers MUST check `precision` / `isApproximate`: AREA results are a neighbourhood
 * centre, not a drop-off point, and should not be used for automatic dispatch or pricing
 * without confirmation.
 */

import { createHash } from "node:crypto";

const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_URL = process.env.GEOCODING_BASE_URL || DEFAULT_BASE_URL;
const USING_PUBLIC_NOMINATIM = NOMINATIM_URL === DEFAULT_BASE_URL;

const USER_AGENT = process.env.GEOCODING_USER_AGENT || "";

if (
  process.env.NODE_ENV === "production" &&
  USING_PUBLIC_NOMINATIM &&
  (!USER_AGENT || /yourdomain\.com/i.test(USER_AGENT))
) {
  // Fail fast: the public Nominatim instance blocks anonymous / placeholder user agents.
  throw new Error(
    "[Geocoding] GEOCODING_USER_AGENT must be set to a real app name + contact in production " +
      'e.g. "Swiftbox Delivery (ops@swiftbox.ng)".'
  );
}

const EFFECTIVE_USER_AGENT = USER_AGENT || "Swiftbox Delivery Platform (development)";

const LAGOS_BOUNDS = {
  minLat: 6.3,
  maxLat: 6.9,
  minLon: 2.65,
  maxLon: 4.3,
};

const MAX_ADDRESS_LENGTH = 300;
const MIN_ADDRESS_LENGTH = 3;

const MIN_REQUEST_INTERVAL_MS = Number(process.env.GEOCODING_MIN_INTERVAL_MS ?? 1100);
const REQUEST_TIMEOUT_MS = 5000;
const OVERALL_DEADLINE_MS = 12000;
const MAX_QUERIES = 3;
const MAX_QUEUE_DEPTH = 20;

const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_OPEN_MS = 60_000;

const CACHE_MAX_ENTRIES = 5000;
const CACHE_TTL_HIT_MS = 7 * 24 * 60 * 60 * 1000; // resolved via live lookup
const CACHE_TTL_MISS_MS = 10 * 60 * 1000; // genuinely not found
const CACHE_TTL_DEGRADED_MS = 2 * 60 * 1000; // upstream was failing; retry soon

// Guaranteed fallback coordinates for popular Lagos zones and corridors.
// `searchQuery` (optional) is an extra, more specific Nominatim query for that entry.
const LAGOS_AREA_FALLBACKS = {
  "ago palace": {
    lat: 6.505,
    lng: 3.328,
    name: "Ago Palace Way, Okota, Isolo, Lagos, Nigeria",
    searchQuery: "Ago Palace Way, Okota, Lagos, Nigeria",
  },
  okota: { lat: 6.5158, lng: 3.3105, name: "Okota, Isolo, Lagos, Nigeria" },
  ikeja: { lat: 6.6018, lng: 3.3515, name: "Ikeja, Lagos, Nigeria" },
  lekki: { lat: 6.4474, lng: 3.4723, name: "Lekki Phase 1, Lagos, Nigeria" },
  yaba: { lat: 6.5095, lng: 3.3711, name: "Yaba, Lagos, Nigeria" },
  surulere: { lat: 6.5, lng: 3.35, name: "Surulere, Lagos, Nigeria" },
  ajah: { lat: 6.4684, lng: 3.5653, name: "Ajah, Lagos, Nigeria" },
  oshodi: { lat: 6.5568, lng: 3.3444, name: "Oshodi, Lagos, Nigeria" },
  festac: { lat: 6.4667, lng: 3.2833, name: "Festac Town, Amuwo-Odofin, Lagos, Nigeria" },
  "computer village": { lat: 6.5966, lng: 3.3431, name: "Computer Village, Ikeja, Lagos, Nigeria" },
};

// ---------------------------------------------------------------------------
// Logging (injectable; never logs raw addresses)
// ---------------------------------------------------------------------------

let log = console;

/** Swap in your app logger (pino, winston, ...). Needs info/warn/error. */
export const setGeocodingLogger = (logger) => {
  if (logger && typeof logger.info === "function" && typeof logger.warn === "function") {
    log = logger;
  }
};

const addressRef = (value) => createHash("sha1").update(value).digest("hex").slice(0, 8);

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

const normalizeAddress = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/^,\s*|\s*,$/g, "")
    .trim();

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasValidCoordinates = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

export const isInsideLagosBounds = (latitude, longitude) =>
  latitude >= LAGOS_BOUNDS.minLat &&
  latitude <= LAGOS_BOUNDS.maxLat &&
  longitude >= LAGOS_BOUNDS.minLon &&
  longitude <= LAGOS_BOUNDS.maxLon;

// ---------------------------------------------------------------------------
// Local fallback matrix (whole-word matching, longest key first)
// ---------------------------------------------------------------------------

const FALLBACK_MATCHERS = Object.entries(LAGOS_AREA_FALLBACKS)
  .sort(([a], [b]) => b.length - a.length)
  .map(([key, value]) => ({
    key,
    value,
    regex: new RegExp(`\\b${escapeRegExp(key).replace(/\\? /g, "\\s+")}\\b`, "i"),
  }));

const findFallbackEntry = (address) =>
  FALLBACK_MATCHERS.find(({ regex }) => regex.test(address)) ?? null;

const getAreaFallback = (address) => {
  const match = findFallbackEntry(address);
  if (!match) return null;
  const { value } = match;
  return {
    latitude: value.lat,
    longitude: value.lng,
    displayName: `${address} (${value.name})`,
    precision: "AREA",
    isApproximate: true,
    source: "LOCAL_FALLBACK_MATRIX",
  };
};

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

const stripRegionSuffix = (value) =>
  value.replace(/(?:[,\s]+(?:lagos(?:\s+state)?|nigeria|ng))+$/i, "").trim();

const buildQueries = (address) => {
  const cleaned = normalizeAddress(address)
    .replace(/\bagos\b/gi, "Lagos")
    .replace(/\blag\b/gi, "Lagos");

  const base = stripRegionSuffix(cleaned);
  if (!base) return [];

  const withoutHouseNumber = base.replace(
    /^\s*(?:no\.?\s*)?\d+[a-z]?(?:\/\d+[a-z]?)?\s*,?\s*/i,
    ""
  );

  const fallbackEntry = findFallbackEntry(base);

  const queries = [
    `${base}, Lagos, Nigeria`,
    withoutHouseNumber && withoutHouseNumber !== base ? `${withoutHouseNumber}, Lagos, Nigeria` : null,
    fallbackEntry?.value.searchQuery ?? null,
  ];

  return [...new Set(queries.filter(Boolean))].slice(0, MAX_QUERIES);
};

// ---------------------------------------------------------------------------
// Nominatim result handling
// ---------------------------------------------------------------------------

const ROAD_KEYS = ["road", "pedestrian", "footway", "residential", "path", "living_street"];

const determinePrecision = (result) => {
  const details = result.address ?? {};
  const hasRoad = ROAD_KEYS.some((key) => Boolean(details[key]));
  const hasHouseNumber = Boolean(details.house_number);
  const isHighwayClass = String(result.class ?? "").toLowerCase() === "highway";

  if (hasRoad && hasHouseNumber) return { precision: "EXACT", isApproximate: false };
  if (hasRoad || isHighwayClass) return { precision: "STREET", isApproximate: true };
  return { precision: "AREA", isApproximate: true };
};

const isLagosState = (details) => {
  const state = details?.state ?? details?.["ISO3166-2-lvl4"];
  // If the provider gives no state, rely on the bounds check alone.
  return !state || /lagos|NG-LA/i.test(String(state));
};

const convertResult = (result, query) => {
  const latitude = Number(result?.lat);
  const longitude = Number(result?.lon);
  const details = result?.address ?? {};

  if (!hasValidCoordinates(latitude, longitude)) return null;
  if (!isInsideLagosBounds(latitude, longitude)) return null;
  if (!isLagosState(details)) return null;

  const { precision, isApproximate } = determinePrecision(result);

  return {
    latitude,
    longitude,
    displayName: String(result.display_name ?? query),
    precision,
    isApproximate,
    addressDetails: details,
    source: "NOMINATIM",
  };
};

const pickBest = (candidates) =>
  candidates.find((c) => c.precision === "EXACT") ??
  candidates.find((c) => c.precision === "STREET") ??
  null;

// ---------------------------------------------------------------------------
// Outbound request control: throttle queue + circuit breaker
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let queueTail = Promise.resolve();
let pending = 0;
let lastRequestAt = 0;

const throttled = (task) => {
  pending += 1;
  const run = queueTail.then(async () => {
    try {
      const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
      return await task();
    } finally {
      pending -= 1;
    }
  });
  queueTail = run.catch(() => {});
  return run;
};

let consecutiveFailures = 0;
let breakerOpenUntil = 0;

const circuitIsOpen = () => Date.now() < breakerOpenUntil;

const recordSuccess = () => {
  consecutiveFailures = 0;
};

const recordFailure = (error) => {
  consecutiveFailures += 1;
  if (error?.retryAfterMs) {
    breakerOpenUntil = Date.now() + error.retryAfterMs;
  } else if (consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
    breakerOpenUntil = Date.now() + BREAKER_OPEN_MS;
  }
};

const parseRetryAfter = (header) => {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, 600_000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), 600_000) : null;
};

const fetchNominatim = async (query) => {
  const params = new URLSearchParams({
    format: "jsonv2",
    q: query,
    countrycodes: "ng",
    limit: "3",
    addressdetails: "1",
    // left,top,right,bottom
    viewbox: `${LAGOS_BOUNDS.minLon},${LAGOS_BOUNDS.maxLat},${LAGOS_BOUNDS.maxLon},${LAGOS_BOUNDS.minLat}`,
    bounded: "1",
  });

  const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": EFFECTIVE_USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = new Error(`Geocoder responded with HTTP ${response.status}`);
    error.status = response.status;
    if (response.status === 429) {
      error.retryAfterMs = parseRetryAfter(response.headers.get("retry-after")) ?? BREAKER_OPEN_MS;
    } else if (response.status === 403) {
      // Blocked (bad/missing User-Agent or abuse). Back off hard and make noise.
      error.retryAfterMs = 5 * 60_000;
    }
    throw error;
  }

  const results = await response.json();
  return Array.isArray(results) ? results : [];
};

// ---------------------------------------------------------------------------
// Cache (LRU + TTL) and in-flight de-duplication
// ---------------------------------------------------------------------------

const cache = new Map();
const inFlight = new Map();

const cacheGet = (key) => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // Refresh recency.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
};

const cacheSet = (key, value, ttlMs) => {
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (cache.size > CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
};

const clone = (value) => (value === null ? null : structuredClone(value));

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const resolveAddress = async (address, ref) => {
  const deadline = Date.now() + OVERALL_DEADLINE_MS;
  let degraded = false;
  let areaCandidate = null;

  for (const query of buildQueries(address)) {
    if (Date.now() >= deadline || circuitIsOpen() || pending >= MAX_QUEUE_DEPTH) {
      degraded = true;
      break;
    }

    try {
      const results = await throttled(() => fetchNominatim(query));
      recordSuccess();

      const candidates = results.map((r) => convertResult(r, query)).filter(Boolean);
      const best = pickBest(candidates);
      if (best) return { value: best, degraded: false };

      areaCandidate ??= candidates[0] ?? null;
    } catch (error) {
      degraded = true;
      recordFailure(error);
      log.warn(
        `[Geocoding] Upstream lookup failed (ref=${ref}, status=${error?.status ?? "n/a"}, ` +
          `reason=${error?.name ?? "Error"}: ${error?.message ?? "unknown"})`
      );
      if (error?.status === 403) {
        log.error("[Geocoding] Upstream returned 403. Check GEOCODING_USER_AGENT and usage policy.");
      }
    }
  }

  const fallback = getAreaFallback(address);
  if (fallback) return { value: fallback, degraded };

  if (areaCandidate) return { value: areaCandidate, degraded };

  return { value: null, degraded };
};

/**
 * Geocode a Lagos address.
 *
 * @param {string} address
 * @returns {Promise<null | {
 *   latitude: number,
 *   longitude: number,
 *   displayName: string,
 *   precision: "EXACT" | "STREET" | "AREA",
 *   isApproximate: boolean,
 *   addressDetails?: object,
 *   source: "NOMINATIM" | "LOCAL_FALLBACK_MATRIX"
 * }>} null when the input is invalid or the address cannot be located in Lagos.
 *     Never throws.
 */
export const geocodeAddress = async (address) => {
  if (typeof address !== "string") return null;

  const normalized = normalizeAddress(address);
  if (normalized.length < MIN_ADDRESS_LENGTH || normalized.length > MAX_ADDRESS_LENGTH) {
    return null;
  }

  const key = normalized.toLowerCase();

  const cached = cacheGet(key);
  if (cached !== undefined) return clone(cached);

  if (inFlight.has(key)) return clone(await inFlight.get(key));

  const ref = addressRef(key);

  const work = (async () => {
    try {
      const { value, degraded } = await resolveAddress(normalized, ref);

      const ttl = degraded
        ? CACHE_TTL_DEGRADED_MS
        : value === null
          ? CACHE_TTL_MISS_MS
          : value.source === "NOMINATIM"
            ? CACHE_TTL_HIT_MS
            : CACHE_TTL_MISS_MS;
      cacheSet(key, value, ttl);

      log.info(
        `[Geocoding] ref=${ref} source=${value?.source ?? "NONE"} precision=${value?.precision ?? "NONE"}` +
          `${degraded ? " degraded=true" : ""}`
      );
      return value;
    } catch (error) {
      // Defensive: geocodeAddress must never throw into request handlers.
      log.warn(`[Geocoding] Unexpected error (ref=${ref}): ${error?.message ?? error}`);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, work);
  return clone(await work);
};