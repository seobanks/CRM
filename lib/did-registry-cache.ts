import { createClient } from "@supabase/supabase-js";

interface DidEntry {
  tenant_id: string;
  is_active: boolean;
}

// In-memory cache for DID -> Tenant mapping
let didCache: Map<string, DidEntry> | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createClient(url, key);
}

/**
 * Loads and caches all active DIDs from tenant_did_registry in memory.
 * Refreshes at most once every 5 minutes under high load.
 */
export async function getCachedDidRegistry(forceRefresh = false): Promise<Map<string, DidEntry>> {
  const now = Date.now();
  if (!forceRefresh && didCache && (now - lastFetchTime < CACHE_TTL_MS)) {
    return didCache;
  }

  try {
    const supabaseAdmin = getAdminClient();
    const { data, error } = await supabaseAdmin
      .from("tenant_did_registry")
      .select("did_number, tenant_id, is_active")
      .eq("is_active", true);

    if (!error && data) {
      const newMap = new Map<string, DidEntry>();
      for (const row of data) {
        if (row.did_number) {
          const cleanDid = String(row.did_number).replace(/\D/g, "").slice(-10);
          newMap.set(cleanDid, { tenant_id: row.tenant_id, is_active: row.is_active });
        }
      }
      didCache = newMap;
      lastFetchTime = now;
      return didCache;
    } else if (error) {
      console.error("[DID-CACHE] DB query error:", error.message);
    }
  } catch (err) {
    console.error("[DID-CACHE] Error refreshing DID cache:", err);
  }

  return didCache || new Map();
}

/**
 * Manually invalidate cache (e.g. when an admin adds/updates a DID in UI).
 */
export function invalidateDidCache() {
  didCache = null;
  lastFetchTime = 0;
}

/**
 * Resolves tenant ID from an array of potential DIDs using the in-memory cache.
 * Avoids hammering Supabase on high-frequency webhooks.
 */
export async function resolveTenantFromDids(
  dids: string[]
): Promise<{ tenantId: string | null; matchedDid: string | null }> {
  let cache = await getCachedDidRegistry();

  for (const did of dids) {
    const clean = String(did).replace(/\D/g, "").slice(-10);
    const entry = cache.get(clean);
    if (entry && entry.is_active) {
      return { tenantId: entry.tenant_id, matchedDid: clean };
    }
  }

  // If not found in cache and cache is older than 60 seconds, do one fresh reload
  if (Date.now() - lastFetchTime > 60 * 1000) {
    cache = await getCachedDidRegistry(true);
    for (const did of dids) {
      const clean = String(did).replace(/\D/g, "").slice(-10);
      const entry = cache.get(clean);
      if (entry && entry.is_active) {
        return { tenantId: entry.tenant_id, matchedDid: clean };
      }
    }
  }

  return { tenantId: null, matchedDid: null };
}

/**
 * Extracts embedded UUID tenant ID from campaign strings like:
 * "IVRBlast_7965995782_576a6280-a9a2-425c-b1dd-eabfff3a00c6"
 */
export function extractTenantFromCampaign(campaign?: string | null): string | null {
  if (!campaign) return null;
  const match = String(campaign).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : null;
}
