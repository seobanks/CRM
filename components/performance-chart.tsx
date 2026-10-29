"use client"

import { useEffect, useState, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { Badge } from "@/components/ui/badge"

interface PerformanceChartProps {
  startDate: string
  endDate: string
  telecallerId?: string
  callType?: string
}

export function PerformanceChart({ startDate, endDate, telecallerId, callType = "agent" }: PerformanceChartProps) {
  const [data, setData] = useState<Array<{ label: string; leads: number; calls: number; connected: number }>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeSeries, setActiveSeries] = useState<Record<string, boolean>>({
    calls: true,
    connected: true,
    leads: true,
  })

  const supabase = createClient()
  const isSingleDay = startDate === endDate

  useEffect(() => {
    let isMounted = true

    const fetchData = async () => {
      setIsLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        let tenantId: string | null = null
        let role: string | null = null
        
        if (user) {
          const { data: profile } = await supabase
            .from('users')
            .select('tenant_id, role')
            .eq('id', user.id)
            .single()
            
          tenantId = profile?.tenant_id
          role = profile?.role
        }

        let leadsQuery = supabase
          .from("leads")
          .select("created_at")
          .gte("created_at", `${startDate}T00:00:00`)
          .lte("created_at", `${endDate}T23:59:59`)
          .limit(20000)

        let callsQuery = supabase
          .from("call_logs")
          .select("created_at, call_status, disposition, duration_seconds, call_type, notes, leads:leads(status)")
          .gte("created_at", `${startDate}T00:00:00`)
          .lte("created_at", `${endDate}T23:59:59`)
          .limit(20000)

        // Strict Tenant Isolation
        if (tenantId && role !== 'super_admin') {
          leadsQuery = leadsQuery.eq('tenant_id', tenantId)
          callsQuery = callsQuery.eq('tenant_id', tenantId)
        }

        // Call Type Filter
        if (callType === "outbound") {
      callsQuery = callsQuery.eq('call_type', 'outbound')
    } else if (callType === "c2c") {
      callsQuery = callsQuery.eq('call_type', 'outbound_c2c')
    } else if (callType === "ivr") {
      callsQuery = callsQuery.eq('call_type', 'ivr')
    } else if (callType === "inbound") {
      callsQuery = callsQuery.eq('call_type', 'inbound')
    } else {
      callsQuery = callsQuery.in('call_type', ['outbound', 'outbound_c2c'])
    }

        if (telecallerId) {
          const ids = telecallerId.split(',').filter(Boolean)
          if (ids.length > 0) {
            leadsQuery = leadsQuery.in("assigned_to", ids)
            callsQuery = callsQuery.in("user_id", ids)
          }
        }

        const [{ data: leadsRaw }, { data: callsRaw }] = await Promise.all([leadsQuery, callsQuery])

        if (!isMounted) return

        // Accurate connection check
        const isConnected = (call: any) => {
          const status = (call.call_status || "").toLowerCase()
          const disp = (call.disposition || "").toUpperCase()
          const notes = (call.notes || "").toLowerCase()
          const leadSt = (call.leads?.status || "").toLowerCase()

          if (
            status === "notanswered" || 
            status === "no_answer" || 
            status === "failed" ||
            disp === "NOANSWER" || 
            disp === "CANCEL" || 
            disp === "BUSY" || 
            disp === "CONGESTION" ||
            leadSt === "nr" ||
            notes.includes("nr (") ||
            notes === "status updated to nr"
          ) {
            return false
          }
          return status === "connected" || status === "answered" || disp === "ANSWERED"
        }

        if (isSingleDay) {
          // --- HOURLY BREAKDOWN FOR SINGLE DAY (08:00 - 20:00) ---
          const hourMap = new Map<number, { leads: number; calls: number; connected: number }>()
          for (let h = 8; h <= 20; h++) {
            hourMap.set(h, { leads: 0, calls: 0, connected: 0 })
          }

          leadsRaw?.forEach((item: any) => {
            const h = new Date(item.created_at).getHours()
            if (hourMap.has(h)) hourMap.get(h)!.leads += 1
          })

          callsRaw?.forEach((item: any) => {
            const h = new Date(item.created_at).getHours()
            if (hourMap.has(h)) {
              hourMap.get(h)!.calls += 1
              if (isConnected(item)) hourMap.get(h)!.connected += 1
            }
          })

          const chartData = Array.from(hourMap.entries()).map(([h, counts]) => {
            const period = h >= 12 ? "PM" : "AM"
            const displayHour = h % 12 === 0 ? 12 : h % 12
            return {
              label: `${displayHour} ${period}`,
              ...counts,
            }
          })

          setData(chartData)
        } else {
          // --- DAILY BREAKDOWN FOR MULTI-DAY ---
          const dateMap = new Map<string, { leads: number; calls: number; connected: number }>()
          const start = new Date(startDate)
          const end = new Date(endDate)
          
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, "0")
            const day = String(d.getDate()).padStart(2, "0")
            dateMap.set(`${y}-${m}-${day}`, { leads: 0, calls: 0, connected: 0 })
          }

          leadsRaw?.forEach((item: any) => {
            const d = new Date(item.created_at)
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, "0")
            const day = String(d.getDate()).padStart(2, "0")
            const key = `${y}-${m}-${day}`
            if (dateMap.has(key)) dateMap.get(key)!.leads += 1
          })

          callsRaw?.forEach((item: any) => {
            const d = new Date(item.created_at)
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, "0")
            const day = String(d.getDate()).padStart(2, "0")
            const key = `${y}-${m}-${day}`
            if (dateMap.has(key)) {
              dateMap.get(key)!.calls += 1
              if (isConnected(item)) dateMap.get(key)!.connected += 1
            }
          })

          const chartData = Array.from(dateMap.entries()).map(([dateStr, counts]) => {
            const [y, m, d] = dateStr.split("-").map(Number)
            const dateObj = new Date(y, m - 1, d)
            return {
              label: dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
              ...counts,
            }
          })

          setData(chartData)
        }
      } catch (error) {
        console.error("Error fetching performance data:", error)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    fetchData()

    return () => {
      isMounted = false
    }
  }, [startDate, endDate, telecallerId, callType, supabase, isSingleDay])

  const totals = useMemo(() => {
    return data.reduce(
      (acc, curr) => ({
        calls: acc.calls + curr.calls,
        connected: acc.connected + curr.connected,
        leads: acc.leads + curr.leads,
      }),
      { calls: 0, connected: 0, leads: 0 }
    )
  }, [data])

  const connectRate = totals.calls > 0 ? ((totals.connected / totals.calls) * 100).toFixed(1) : "0"

  if (isLoading) {
    return (
      <div className="h-64 flex flex-col items-center justify-center space-y-2 text-slate-400">
        <div className="h-5 w-5 border-2 border-blue-600 border-t-transparent animate-spin rounded-full" />
        <span className="text-xs font-medium">Loading activity trend...</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Mini metric summary chips */}
      <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-3">
          <button 
            type="button"
            onClick={() => setActiveSeries(prev => ({ ...prev, calls: !prev.calls }))}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all text-xs font-semibold ${
              activeSeries.calls 
                ? "bg-blue-50 dark:bg-blue-950/40 border-blue-200 text-blue-700 dark:text-blue-300" 
                : "opacity-40 border-slate-200 text-slate-500"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-blue-600" />
            Calls: <span className="font-extrabold">{totals.calls.toLocaleString()}</span>
          </button>

          <button 
            type="button"
            onClick={() => setActiveSeries(prev => ({ ...prev, connected: !prev.connected }))}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all text-xs font-semibold ${
              activeSeries.connected 
                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 text-emerald-700 dark:text-emerald-300" 
                : "opacity-40 border-slate-200 text-slate-500"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Connected: <span className="font-extrabold">{totals.connected.toLocaleString()} ({connectRate}%)</span>
          </button>

          <button 
            type="button"
            onClick={() => setActiveSeries(prev => ({ ...prev, leads: !prev.leads }))}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all text-xs font-semibold ${
              activeSeries.leads 
                ? "bg-purple-50 dark:bg-purple-950/40 border-purple-200 text-purple-700 dark:text-purple-300" 
                : "opacity-40 border-slate-200 text-slate-500"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-purple-500" />
            New Leads: <span className="font-extrabold">{totals.leads.toLocaleString()}</span>
          </button>
        </div>

        <Badge variant="outline" className="text-[10px] text-slate-500 border-slate-200">
          {isSingleDay ? "Hourly Activity Curve (8 AM - 8 PM)" : "Daily Volume Trend"}
        </Badge>
      </div>

      {/* Chart Canvas */}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="colorConnected" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" className="dark:stroke-slate-800" />
            <XAxis 
              dataKey="label" 
              fontSize={11} 
              tickLine={false} 
              axisLine={false} 
              tick={{ fill: "#64748b" }}
            />
            <YAxis 
              fontSize={11} 
              tickLine={false} 
              axisLine={false} 
              tick={{ fill: "#64748b" }}
              allowDecimals={false}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: "#ffffff", 
                borderRadius: "12px", 
                border: "1px solid #e2e8f0", 
                boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                fontSize: "12px"
              }}
              formatter={(value: any, name: any) => [
                Number(value).toLocaleString(), 
                name === "calls" ? "Calls" : name === "connected" ? "Connected Calls" : "New Leads"
              ]}
            />

            {activeSeries.calls && (
              <Area 
                type="monotone" 
                dataKey="calls" 
                stroke="#3b82f6" 
                strokeWidth={2} 
                fillOpacity={1} 
                fill="url(#colorCalls)" 
                name="calls"
              />
            )}

            {activeSeries.connected && (
              <Area 
                type="monotone" 
                dataKey="connected" 
                stroke="#10b981" 
                strokeWidth={2} 
                fillOpacity={1} 
                fill="url(#colorConnected)" 
                name="connected"
              />
            )}

            {activeSeries.leads && (
              <Area 
                type="monotone" 
                dataKey="leads" 
                stroke="#8b5cf6" 
                strokeWidth={2} 
                fillOpacity={1} 
                fill="url(#colorLeads)" 
                name="leads"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
