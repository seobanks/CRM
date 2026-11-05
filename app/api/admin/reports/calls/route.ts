import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from "@/lib/supabase/server"
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// In-memory cache to prevent duplicate queries from concurrent chart + table renders
const queryCache = new Map<string, { timestamp: number; data: any[] }>()
const inFlightRequests = new Map<string, Promise<any[]>>()
const CACHE_TTL_MS = 30000 // 30 seconds

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const callType = searchParams.get('callType') || 'agent'
    const telecallerId = searchParams.get('telecallerId')

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
    }

    // Authenticate user via session
    const serverSupabase = await createServerClient()
    const { data: { user } } = await serverSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Resolve tenant
    const { data: profile } = await serverSupabase
      .from('users')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single()

    const tenantId = profile?.tenant_id
    const cacheKey = `${tenantId || 'all'}:${startDate}:${endDate}:${callType}:${telecallerId || 'all'}`

    // 1. Check in-memory cache
    const cached = queryCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({ calls: cached.data, cached: true })
    }

    // 2. Deduplicate in-flight requests (if both components fetch simultaneously)
    let fetchPromise = inFlightRequests.get(cacheKey)
    if (!fetchPromise) {
      fetchPromise = (async () => {
        let callsQuery = supabaseAdmin
          .from('call_logs')
          .select('user_id, call_status, duration_seconds, created_at, disposition, call_type, notes')
          .gte('created_at', `${startDate}T00:00:00`)
          .lte('created_at', `${endDate}T23:59:59`)
          .limit(25000)

        if (tenantId) {
          callsQuery = callsQuery.eq('tenant_id', tenantId)
        }

        // Apply call channel filter
        if (callType === 'outbound') {
          callsQuery = callsQuery.eq('call_type', 'outbound')
        } else if (callType === 'c2c') {
          callsQuery = callsQuery.eq('call_type', 'outbound_c2c')
        } else if (callType === 'ivr') {
          callsQuery = callsQuery.eq('call_type', 'ivr')
        } else if (callType === 'inbound') {
          callsQuery = callsQuery.eq('call_type', 'inbound')
        } else if (callType === 'all') {
          // No channel filter
        } else {
          // Default: agent calls (outbound & click-to-call)
          callsQuery = callsQuery.in('call_type', ['outbound', 'outbound_c2c'])
        }

        if (telecallerId) {
          const ids = telecallerId.split(',').filter(Boolean)
          if (ids.length > 0) callsQuery = callsQuery.in('user_id', ids)
        }

        const { data: calls, error: callsError } = await callsQuery
        if (callsError) {
          throw new Error(callsError.message)
        }

        const result = calls || []
        queryCache.set(cacheKey, { timestamp: Date.now(), data: result })

        // Prune cache if it grows large
        if (queryCache.size > 100) {
          const now = Date.now()
          for (const [k, v] of queryCache.entries()) {
            if (now - v.timestamp > CACHE_TTL_MS) queryCache.delete(k)
          }
        }

        return result
      })().finally(() => {
        inFlightRequests.delete(cacheKey)
      })

      inFlightRequests.set(cacheKey, fetchPromise)
    }

    const calls = await fetchPromise
    return NextResponse.json({ calls, cached: false })
  } catch (error: any) {
    console.error('[API /api/admin/reports/calls] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
