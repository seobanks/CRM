"use client"

import { useEffect, useState, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"

const STATUS_COLOR_PALETTE: Record<string, string> = {
  "NEW": "#3B82F6",
  "CONTACTED": "#06B6D4",
  "INTERESTED": "#10B981",
  "DOCUMENTS SENT": "#8B5CF6",
  "DOCS PENDING": "#8B5CF6",
  "LOGIN DONE": "#F97316",
  "TRANSFERRED TO KYC": "#6366F1",
  "UNDERWRITING": "#EAB308",
  "APPROVED": "#059669",
  "DISBURSED": "#16A34A",
  "NOT INTERESTED": "#EF4444",
  "FOLLOW UP": "#8B5CF6",
  "NOT ELIGIBLE": "#F43F5E",
  "NR": "#64748B",
  "SELF EMPLOYED": "#D97706",
  "RECYCLE POOL": "#94A3B8",
}

const FALLBACK_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#84CC16", "#F97316"]

interface LeadConversionChartProps {
  startDate: string
  endDate: string
  telecallerId?: string
}

export function LeadConversionChart({ startDate, endDate, telecallerId }: LeadConversionChartProps) {
  const [data, setData] = useState<Array<{ name: string; value: number; color: string; percent: string }>>([])
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()

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

        let query = supabase
          .from("leads")
          .select("status")
          .gte("created_at", `${startDate}T00:00:00`)
          .lte("created_at", `${endDate}T23:59:59`)
          .limit(10000)

        if (tenantId) {
          query = query.eq('tenant_id', tenantId)
        }

        if (telecallerId) {
          const ids = telecallerId.split(',').filter(Boolean)
          if (ids.length > 0) query = query.in("assigned_to", ids)
        }

        const { data: leads } = await query

        if (!isMounted) return

        if (leads && leads.length > 0) {
          const totalCount = leads.length
          const statusCounts: Record<string, number> = {}

          leads.forEach((lead: any) => {
            const raw = (lead.status || "NEW").replace(/_/g, " ").trim().toUpperCase()
            statusCounts[raw] = (statusCounts[raw] || 0) + 1
          })

          const sortedEntries = Object.entries(statusCounts).sort((a, b) => b[1] - a[1])

          const chartData = sortedEntries.map(([status, count], index) => {
            const color = STATUS_COLOR_PALETTE[status] || FALLBACK_COLORS[index % FALLBACK_COLORS.length]
            const percent = ((count / totalCount) * 100).toFixed(1)
            return {
              name: status,
              value: count,
              color,
              percent,
            }
          })

          setData(chartData)
        } else {
          setData([])
        }
      } catch (error) {
        console.error("Error fetching conversion status data:", error)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    fetchData()

    return () => {
      isMounted = false
    }
  }, [startDate, endDate, telecallerId, supabase])

  const totalLeads = useMemo(() => {
    return data.reduce((sum, item) => sum + item.value, 0)
  }, [data])

  if (isLoading) {
    return (
      <div className="h-64 flex flex-col items-center justify-center space-y-2 text-slate-400">
        <div className="h-5 w-5 border-2 border-blue-600 border-t-transparent animate-spin rounded-full" />
        <span className="text-xs font-medium">Loading status distribution...</span>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-xs">
        No lead status data for selected range.
      </div>
    )
  }

  return (
    <div className="flex flex-col md:flex-row items-center gap-4">
      {/* Donut Chart with Center Total */}
      <div className="h-60 w-full md:w-1/2 relative flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={3}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#ffffff",
                borderRadius: "10px",
                border: "1px solid #e2e8f0",
                fontSize: "12px",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              }}
              formatter={(value: any, name: any) => [
                `${Number(value).toLocaleString()} leads (${((Number(value) / totalLeads) * 100).toFixed(1)}%)`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center Total Overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
            {totalLeads.toLocaleString()}
          </span>
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
            Total Leads
          </span>
        </div>
      </div>

      {/* Status Breakdown Legend List */}
      <div className="w-full md:w-1/2 max-h-56 overflow-y-auto space-y-1.5 pr-1">
        {data.map((item) => (
          <div
            key={item.name}
            className="flex items-center justify-between text-xs p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
          >
            <div className="flex items-center gap-2 truncate">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="font-semibold text-slate-700 dark:text-slate-300 truncate text-[11px]">
                {item.name}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="font-bold text-slate-900 dark:text-slate-100">
                {item.value.toLocaleString()}
              </span>
              <span className="text-[10px] font-semibold text-slate-400 w-10 text-right">
                {item.percent}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
