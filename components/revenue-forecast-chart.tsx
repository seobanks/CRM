"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { IndianRupee, TrendingUp, Sparkles, AlertCircle } from "lucide-react"

interface MonthMetric {
  name: string
  disbursed: number
  pipeline: number
}

export function RevenueForecastChart({ startDate, endDate }: { startDate: string, endDate: string }) {
  const [data, setData] = useState<MonthMetric[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [totalDisbursedPeriod, setTotalDisbursedPeriod] = useState(0)
  const [totalPipelineValue, setTotalPipelineValue] = useState(0)
  const supabase = createClient()

  useEffect(() => {
    let isMounted = true

    const fetchFinancialData = async () => {
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

        // Fetch leads with financial data
        let query = supabase
          .from('leads')
          .select('disbursed_amount, loan_amount, disbursed_at, created_at, status')
          .limit(10000)

        if (tenantId) {
          query = query.eq('tenant_id', tenantId)
        }

        const { data: leads } = await query

        if (!isMounted) return

        // Build 6-month monthly trend leading up to current date
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        const now = new Date()
        const monthlyBuckets = new Map<string, { name: string; disbursed: number; pipeline: number }>()

        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          monthlyBuckets.set(key, {
            name: `${monthNames[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`,
            disbursed: 0,
            pipeline: 0,
          })
        }

        let periodDisbursed = 0
        let periodPipeline = 0

        const activePipelineStatuses = new Set([
          "interested", "documents_sent", "docs pending", "login done", 
          "transferred to kyc", "underwriting", "approved"
        ])

        leads?.forEach((lead) => {
          const disbursedAmt = Number(lead.disbursed_amount) || 0
          const loanAmt = Number(lead.loan_amount) || 0
          const statusNorm = (lead.status || "").toLowerCase().trim()

          // Track overall sums
          if (disbursedAmt > 0) periodDisbursed += disbursedAmt
          if (activePipelineStatuses.has(statusNorm) && loanAmt > 0) periodPipeline += loanAmt

          // Map to month bucket
          const dateStr = lead.disbursed_at || lead.created_at
          if (dateStr) {
            const d = new Date(dateStr)
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            if (monthlyBuckets.has(key)) {
              monthlyBuckets.get(key)!.disbursed += disbursedAmt
              if (activePipelineStatuses.has(statusNorm)) {
                monthlyBuckets.get(key)!.pipeline += loanAmt
              }
            }
          }
        })

        setTotalDisbursedPeriod(periodDisbursed)
        setTotalPipelineValue(periodPipeline)

        const chartPoints = Array.from(monthlyBuckets.values())
        setData(chartPoints)
      } catch (err) {
        console.error("Error fetching financial forecast:", err)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    fetchFinancialData()

    return () => {
      isMounted = false
    }
  }, [startDate, endDate, supabase])

  const formatLakhs = (val: number) => {
    if (val >= 10000000) {
      return `₹${(val / 10000000).toFixed(2)} Cr`
    }
    return `₹${(val / 100000).toFixed(1)} Lakhs`
  }

  if (isLoading) {
    return (
      <div className="h-64 flex flex-col items-center justify-center space-y-2 text-slate-400">
        <div className="h-5 w-5 border-2 border-emerald-500 border-t-transparent animate-spin rounded-full" />
        <span className="text-xs font-medium">Computing financial velocity...</span>
      </div>
    )
  }

  const hasData = data.some(d => d.disbursed > 0 || d.pipeline > 0)

  return (
    <div className="space-y-3">
      {/* Financial Summary Badges */}
      <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 dark:text-emerald-300 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Total Disbursed: <span className="font-extrabold">{formatLakhs(totalDisbursedPeriod)}</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/40 border border-purple-200 text-purple-700 dark:text-purple-300 font-semibold">
            <span className="w-2 h-2 rounded-full bg-purple-500" />
            Active Pipeline Demand: <span className="font-extrabold">{formatLakhs(totalPipelineValue)}</span>
          </div>
        </div>

        <span className="text-[11px] font-medium text-slate-400">
          6-Month Disbursement Velocity
        </span>
      </div>

      {/* Chart Canvas */}
      <div className="h-64 w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 5, bottom: 0 }}>
              <defs>
                <linearGradient id="colorDisbursed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorPipeline" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" className="dark:stroke-slate-800" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fill: '#64748b' }} 
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fill: '#64748b' }} 
                tickFormatter={(val) => {
                  if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`
                  return `₹${(val / 100000).toFixed(0)}L`
                }}
              />
              <Tooltip 
                formatter={(value: any, name: any) => [
                  formatLakhs(Number(value) || 0),
                  name === "disbursed" ? "Disbursed Amount" : "Pipeline Loan Demand"
                ]}
                contentStyle={{ 
                  borderRadius: '10px', 
                  border: '1px solid #e2e8f0', 
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  fontSize: '12px'
                }}
              />
              <Area 
                type="monotone" 
                dataKey="pipeline" 
                stroke="#8b5cf6" 
                fillOpacity={1} 
                fill="url(#colorPipeline)" 
                strokeDasharray="4 4" 
                name="pipeline"
              />
              <Area 
                type="monotone" 
                dataKey="disbursed" 
                stroke="#10b981" 
                strokeWidth={2.5} 
                fillOpacity={1} 
                fill="url(#colorDisbursed)" 
                name="disbursed"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs space-y-1">
            <IndianRupee className="h-7 w-7 text-slate-300 stroke-[1.5]" />
            <span>No disbursement or loan values recorded in recent months.</span>
          </div>
        )}
      </div>
    </div>
  )
}
