"use client"

import { useEffect, useState, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Users, PhoneCall, ThumbsUp, FileCheck, CheckCircle2, ArrowDown, Sparkles } from "lucide-react"

interface LeadConversionFunnelProps {
  startDate: string
  endDate: string
  telecallerId?: string
}

interface FunnelStage {
  id: string
  name: string
  description: string
  count: number
  icon: any
  color: string
  bgColor: string
  barColor: string
}

export function LeadConversionFunnel({ startDate, endDate, telecallerId }: LeadConversionFunnelProps) {
  const [stages, setStages] = useState<FunnelStage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    let isMounted = true

    const fetchFunnelData = async () => {
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

        // Fetch leads in range
        let leadsQuery = supabase
          .from("leads")
          .select("status, created_at, id")
          .gte("created_at", `${startDate}T00:00:00`)
          .lte("created_at", `${endDate}T23:59:59`)
          .limit(10000)

        if (tenantId) {
          leadsQuery = leadsQuery.eq('tenant_id', tenantId)
        }

        if (telecallerId) {
          const ids = telecallerId.split(',').filter(Boolean)
          if (ids.length > 0) leadsQuery = leadsQuery.in("assigned_to", ids)
        }

        const { data: leads } = await leadsQuery

        if (!isMounted) return

        const allLeads = leads || []
        const total = allLeads.length

        // Categorize leads into pipeline funnel stages
        const normalize = (s: string) => (s || "").toLowerCase().trim()

        // 1. Contacted: any status other than "new"
        const contactedLeads = allLeads.filter(l => {
          const s = normalize(l.status)
          return s !== "new" && s !== ""
        })

        // 2. Qualified / Interested:
        const qualifiedStatuses = new Set([
          "interested", "documents_sent", "docs pending", "login done", 
          "transferred to kyc", "underwriting", "approved", "disbursed", 
          "closed_won", "booked", "site_visit_scheduled", "site_visit_done", "negotiation"
        ])
        const qualifiedLeads = allLeads.filter(l => qualifiedStatuses.has(normalize(l.status)))

        // 3. Documentation & KYC Processing:
        const processingStatuses = new Set([
          "documents_sent", "docs pending", "login done", "transferred to kyc", 
          "underwriting", "approved", "disbursed", "closed_won", "booked"
        ])
        const processingLeads = allLeads.filter(l => processingStatuses.has(normalize(l.status)))

        // 4. Won / Disbursed:
        const wonStatuses = new Set(["approved", "disbursed", "closed_won", "booked"])
        const wonLeads = allLeads.filter(l => wonStatuses.has(normalize(l.status)))

        const funnelStages: FunnelStage[] = [
          {
            id: "total",
            name: "Total Lead Intake",
            description: "Total leads captured",
            count: total,
            icon: Users,
            color: "text-blue-600 dark:text-blue-400",
            bgColor: "bg-blue-50 dark:bg-blue-950/40",
            barColor: "bg-blue-600",
          },
          {
            id: "contacted",
            name: "Contacted / Engaged",
            description: "Leads called by telecallers",
            count: contactedLeads.length,
            icon: PhoneCall,
            color: "text-cyan-600 dark:text-cyan-400",
            bgColor: "bg-cyan-50 dark:bg-cyan-950/40",
            barColor: "bg-cyan-600",
          },
          {
            id: "qualified",
            name: "Qualified Interest",
            description: "Prospects interested in offer",
            count: qualifiedLeads.length,
            icon: ThumbsUp,
            color: "text-indigo-600 dark:text-indigo-400",
            bgColor: "bg-indigo-50 dark:bg-indigo-950/40",
            barColor: "bg-indigo-600",
          },
          {
            id: "processing",
            name: "In Documentation / KYC",
            description: "Docs collected & verification",
            count: processingLeads.length,
            icon: FileCheck,
            color: "text-amber-600 dark:text-amber-400",
            bgColor: "bg-amber-50 dark:bg-amber-950/40",
            barColor: "bg-amber-500",
          },
          {
            id: "won",
            name: "Approved / Disbursed",
            description: "Final closed deals",
            count: wonLeads.length,
            icon: CheckCircle2,
            color: "text-emerald-600 dark:text-emerald-400",
            bgColor: "bg-emerald-50 dark:bg-emerald-950/40",
            barColor: "bg-emerald-600",
          },
        ]

        setStages(funnelStages)
      } catch (err) {
        console.error("Error fetching funnel data:", err)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    fetchFunnelData()

    return () => {
      isMounted = false
    }
  }, [startDate, endDate, telecallerId, supabase])

  if (isLoading) {
    return (
      <div className="h-64 flex flex-col items-center justify-center space-y-2 text-slate-400">
        <div className="h-5 w-5 border-2 border-purple-600 border-t-transparent animate-spin rounded-full" />
        <span className="text-xs font-medium">Computing conversion stages...</span>
      </div>
    )
  }

  const baseCount = stages[0]?.count || 0

  if (baseCount === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-xs">
        No lead activity recorded for this period.
      </div>
    )
  }

  return (
    <div className="space-y-3 pt-1">
      {stages.map((stage, idx) => {
        const percentOfTotal = baseCount > 0 ? ((stage.count / baseCount) * 100).toFixed(1) : "0"
        const prevCount = idx > 0 ? stages[idx - 1].count : baseCount
        const stepConversion = prevCount > 0 ? ((stage.count / prevCount) * 100).toFixed(1) : "0"

        const StageIcon = stage.icon

        return (
          <div key={stage.id} className="relative group">
            <div className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg ${stage.bgColor} ${stage.color}`}>
                  <StageIcon className="h-3.5 w-3.5" />
                </div>
                <div>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{stage.name}</span>
                  <span className="text-[10px] text-slate-400 ml-1.5 hidden sm:inline">({stage.description})</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <span className="font-extrabold text-slate-900 dark:text-slate-100 text-sm">
                  {stage.count.toLocaleString()}
                </span>
                <span className="text-[11px] font-semibold text-slate-500 w-12 text-right">
                  {percentOfTotal}%
                </span>
                {idx > 0 && (
                  <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-100/50 hidden md:inline">
                    {stepConversion}% from prev
                  </span>
                )}
              </div>
            </div>

            {/* Funnel Progress Bar */}
            <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={`h-full ${stage.barColor} rounded-full transition-all duration-700 ease-out`}
                style={{ width: `${Math.max(Number(percentOfTotal), stage.count > 0 ? 3 : 0)}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
