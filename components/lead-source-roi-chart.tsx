"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts"
import { Globe, Share2, Layers } from "lucide-react"

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b']

interface SourceItem {
  name: string
  value: number
  qualified: number
  conversionRate: string
  color: string
}

export function LeadSourceROIChart({ startDate, endDate }: { startDate: string, endDate: string }) {
  const [data, setData] = useState<SourceItem[]>([])
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
          .from('leads')
          .select('source, status')
          .gte('created_at', `${startDate}T00:00:00`)
          .lte('created_at', `${endDate}T23:59:59`)
          .limit(10000)

        if (tenantId) {
          query = query.eq('tenant_id', tenantId)
        }

        const { data: leads } = await query

        if (!isMounted) return

        if (leads && leads.length > 0) {
          const sourceMap: Record<string, { total: number; qualified: number }> = {}

          const qualifiedStatuses = new Set([
            "interested", "documents_sent", "docs pending", "login done", 
            "transferred to kyc", "underwriting", "approved", "disbursed", "closed_won", "booked"
          ])

          leads.forEach((l) => {
            let src = (l.source || "").trim()
            if (!src || src.toLowerCase() === "null" || src.toLowerCase() === "undefined") {
              src = "Direct / Website"
            } else {
              // Capitalize nicely
              src = src.charAt(0).toUpperCase() + src.slice(1).replace(/_/g, " ")
            }

            if (!sourceMap[src]) {
              sourceMap[src] = { total: 0, qualified: 0 }
            }

            sourceMap[src].total += 1

            const statusNorm = (l.status || "").toLowerCase().trim()
            if (qualifiedStatuses.has(statusNorm)) {
              sourceMap[src].qualified += 1
            }
          })

          const sorted = Object.entries(sourceMap)
            .map(([name, counts], idx) => {
              const conv = counts.total > 0 ? ((counts.qualified / counts.total) * 100).toFixed(1) : "0"
              return {
                name,
                value: counts.total,
                qualified: counts.qualified,
                conversionRate: conv,
                color: COLORS[idx % COLORS.length],
              }
            })
            .sort((a, b) => b.value - a.value)
            .slice(0, 7) // Top 7 sources

          setData(sorted)
        } else {
          setData([])
        }
      } catch (error) {
        console.error("Error fetching lead source data", error)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    fetchData()

    return () => {
      isMounted = false
    }
  }, [startDate, endDate, supabase])

  const totalLeads = data.reduce((sum, item) => sum + item.value, 0)

  if (isLoading) {
    return (
      <div className="h-64 flex flex-col items-center justify-center space-y-2 text-slate-400">
        <div className="h-5 w-5 border-2 border-orange-500 border-t-transparent animate-spin rounded-full" />
        <span className="text-xs font-medium">Analyzing acquisition channels...</span>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-xs space-y-2">
        <Layers className="h-8 w-8 text-slate-300 stroke-[1.5]" />
        <span>No lead source records found for this period.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col md:flex-row items-center gap-4">
      {/* Chart */}
      <div className="h-60 w-full md:w-1/2 relative flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={4}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
              ))}
            </Pie>
            <Tooltip 
              contentStyle={{ 
                borderRadius: '10px', 
                border: '1px solid #e2e8f0', 
                fontSize: '12px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' 
              }}
              formatter={(value: any, name: any) => [
                `${Number(value).toLocaleString()} leads (${((Number(value) / totalLeads) * 100).toFixed(1)}%)`,
                name
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
            {totalLeads.toLocaleString()}
          </span>
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
            Total Inflow
          </span>
        </div>
      </div>

      {/* Sources Performance Cards */}
      <div className="w-full md:w-1/2 max-h-56 overflow-y-auto space-y-1.5 pr-1">
        {data.map((item) => {
          const share = totalLeads > 0 ? ((item.value / totalLeads) * 100).toFixed(1) : "0"
          return (
            <div 
              key={item.name}
              className="p-2 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2 truncate">
                <span 
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0" 
                  style={{ backgroundColor: item.color }} 
                />
                <div className="truncate">
                  <p className="font-bold text-slate-800 dark:text-slate-200 truncate">{item.name}</p>
                  <p className="text-[10px] text-slate-400">{share}% share</p>
                </div>
              </div>

              <div className="text-right flex-shrink-0">
                <p className="font-extrabold text-slate-900 dark:text-slate-100">{item.value.toLocaleString()} leads</p>
                <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {item.conversionRate}% qualified
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
