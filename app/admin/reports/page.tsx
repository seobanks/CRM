import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { 
  BarChart3, Calendar, TrendingUp, Users, TrendingDown, 
  ArrowUpRight, ArrowDownRight, Trophy, AlertCircle, CheckCircle2, 
  Sparkles, PhoneCall, Phone, IndianRupee, Layers, CheckSquare
} from "lucide-react"
import { ReportsFilters } from "@/components/reports-filters"
import { PerformanceChart } from "@/components/performance-chart"
import { LeadConversionChart } from "@/components/lead-conversion-chart"
import { LeadConversionFunnel } from "@/components/lead-conversion-funnel"
import { TelecallerPerformance } from "@/components/telecaller-performance"
import { ExportButtons } from "@/components/export-buttons"
import { ReportsShareModal } from "@/components/reports-share-modal"
import { RevenueForecastChart } from "@/components/revenue-forecast-chart"
import { LeadSourceROIChart } from "@/components/lead-source-roi-chart"
import Link from "next/link"
import { Suspense } from "react"
import { Badge } from "@/components/ui/badge"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

interface SearchParams {
  start_date?: string
  end_date?: string
  telecaller?: string
  call_type?: string
}

function formatLocalDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const supabase = await createClient()

  // 1. Auth & Tenant Profile
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const { data: userProfile } = await supabase
    .from('users')
    .select('id, full_name, role, tenant_id')
    .eq('id', user.id)
    .single()

  const tenantId = userProfile?.tenant_id
  const role = userProfile?.role

  // 2. Date Range Logic
  const today = new Date()
  const todayStr = formatLocalDate(today)

  const defaultEnd = today
  const defaultStart = new Date(today)
  defaultStart.setDate(defaultEnd.getDate() - 29)

  const startDate = searchParams.start_date || formatLocalDate(defaultStart)
  const endDate = searchParams.end_date || formatLocalDate(defaultEnd)
  const callType = searchParams.call_type || "agent"

  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffDays = Math.max(1, Math.ceil(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1)
  
  const isToday = startDate === todayStr && endDate === todayStr
  const isSingleDay = startDate === endDate

  // Comparison period
  let prevStartDate = ""
  let prevEndDate = ""

  if (isToday) {
    const yest = new Date(today)
    yest.setDate(yest.getDate() - 1)
    prevStartDate = formatLocalDate(yest)
    prevEndDate = formatLocalDate(yest)
  } else {
    const prevEnd = new Date(start)
    prevEnd.setDate(prevEnd.getDate() - 1)
    const prevStart = new Date(prevEnd)
    prevStart.setDate(prevStart.getDate() - diffDays + 1)
    prevStartDate = formatLocalDate(prevStart)
    prevEndDate = formatLocalDate(prevEnd)
  }

  // 3. Telecaller Filtering
  let filterId = searchParams.telecaller
  if (role === 'telecaller') filterId = user.id

  let telecallersQuery = supabase
    .from("users")
    .select("id, full_name")
    .eq("role", "telecaller")
    .eq("is_active", true)

  if (tenantId && role !== 'super_admin') {
    telecallersQuery = telecallersQuery.eq("tenant_id", tenantId)
  }

  const { data: telecallers } = await telecallersQuery

  // 4. Helper: Fetch Period Data with accurate multi-tenant scoping
  const fetchPeriodData = async (s: string, e: string) => {
    let leadsQuery = supabase
      .from('leads')
      .select('id, status, created_at, loan_amount, disbursed_amount')
      .gte('created_at', `${s}T00:00:00`)
      .lte('created_at', `${e}T23:59:59`)
      .limit(20000)

    let callsQuery = supabase
      .from('call_logs')
      .select('user_id, call_status, disposition, duration_seconds, created_at, call_type, notes, leads:leads(status)')
      .gte('created_at', `${s}T00:00:00`)
      .lte('created_at', `${e}T23:59:59`)
      .limit(20000)

    if (tenantId && role !== 'super_admin') {
      leadsQuery = leadsQuery.eq('tenant_id', tenantId)
      callsQuery = callsQuery.eq('tenant_id', tenantId)
    }

    // Call Type filter
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

    if (filterId) {
      const ids = filterId.split(',').filter(Boolean)
      if (ids.length > 0) {
        leadsQuery = leadsQuery.in('assigned_to', ids)
        callsQuery = callsQuery.in('user_id', ids)
      }
    }

    const [{ data: leads }, { data: calls }] = await Promise.all([leadsQuery, callsQuery])

    const allLeads = leads || []
    const allCalls = calls || []

    const qualifiedStatuses = new Set([
      "interested", "documents_sent", "docs pending", "login done", 
      "transferred to kyc", "underwriting", "approved", "disbursed", "closed_won", "booked"
    ])

    const wonStatuses = new Set(["approved", "disbursed", "closed_won", "booked"])

    const totalLeads = allLeads.length
    const newLeads = allLeads.filter(l => (l.status || "").toLowerCase() === 'new').length
    const qualifiedLeads = allLeads.filter(l => qualifiedStatuses.has((l.status || "").toLowerCase().trim())).length
    const wonLeads = allLeads.filter(l => wonStatuses.has((l.status || "").toLowerCase().trim())).length

    let totalLoanAmount = 0
    let totalDisbursedAmount = 0
    allLeads.forEach(l => {
      if (l.loan_amount) totalLoanAmount += Number(l.loan_amount) || 0
      if (l.disbursed_amount) totalDisbursedAmount += Number(l.disbursed_amount) || 0
    })

    const isConnected = (call: any) => {
      const st = (call.call_status || "").toLowerCase()
      const disp = (call.disposition || "").toUpperCase()
      const notes = (call.notes || "").toLowerCase()
      const leadSt = (call.leads?.status || "").toLowerCase()

      if (
        st === "notanswered" || 
        st === "no_answer" || 
        st === "failed" ||
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
      return st === "connected" || st === "answered" || disp === "ANSWERED"
    }

    const totalCalls = allCalls.length
    const connectedCalls = allCalls.filter(isConnected).length
    const totalDuration = allCalls.reduce((sum, c) => sum + (Number(c.duration_seconds) || 0), 0)

    return {
      leads: totalLeads,
      new: newLeads,
      qualified: qualifiedLeads,
      won: wonLeads,
      calls: totalCalls,
      connected: connectedCalls,
      duration: totalDuration,
      loanAmount: totalLoanAmount,
      disbursedAmount: totalDisbursedAmount,
      callsList: allCalls,
    }
  }

  // 5. Parallel Execution for current & previous period
  const [current, previous] = await Promise.all([
    fetchPeriodData(startDate, endDate),
    fetchPeriodData(prevStartDate, prevEndDate),
  ])

  // 6. Calculate Top Performer
  const winnerMap: Record<string, { calls: number; connected: number; duration: number }> = {}
  telecallers?.forEach((t: any) => {
    winnerMap[t.id] = { calls: 0, connected: 0, duration: 0 }
  })
  current.callsList.forEach((c: any) => {
    if (!c.user_id) return
    if (!winnerMap[c.user_id]) winnerMap[c.user_id] = { calls: 0, connected: 0, duration: 0 }
    winnerMap[c.user_id].calls += 1
    winnerMap[c.user_id].duration += Number(c.duration_seconds) || 0

    const st = (c.call_status || "").toLowerCase()
    const disp = (c.disposition || "").toUpperCase()
    const notes = (c.notes || "").toLowerCase()
    const leadSt = (c.leads?.status || "").toLowerCase()
    if (
      st !== "notanswered" && 
      st !== "no_answer" && 
      st !== "failed" &&
      disp !== "NOANSWER" && 
      disp !== "CANCEL" && 
      disp !== "BUSY" && 
      disp !== "CONGESTION" &&
      leadSt !== "nr" &&
      !notes.includes("nr (") &&
      notes !== "status updated to nr" &&
      (st === "connected" || st === "answered" || disp === "ANSWERED")
    ) {
      winnerMap[c.user_id].connected += 1
    }
  })

  let topPerformerId = ""
  let topPerformerCalls = 0
  let topPerformerConnected = 0

  Object.entries(winnerMap).forEach(([id, stats]) => {
    if (stats.calls > topPerformerCalls) {
      topPerformerCalls = stats.calls
      topPerformerConnected = stats.connected
      topPerformerId = id
    }
  })

  const topPerformerName = telecallers?.find((t: any) => t.id === topPerformerId)?.full_name || "N/A"
  const topPerformerConnectRate = topPerformerCalls > 0 ? ((topPerformerConnected / topPerformerCalls) * 100).toFixed(0) : "0"

  const topCallersList = Object.entries(winnerMap)
    .map(([userId, stats]) => {
      const agent = telecallers?.find((t: any) => t.id === userId)
      const connectRate = stats.calls > 0 ? Math.round((stats.connected / stats.calls) * 100) : 0
      return {
        id: userId,
        name: agent?.full_name || "Unknown Agent",
        calls: stats.calls,
        connected: stats.connected,
        connectRate,
        totalDurationSeconds: stats.duration,
        avgDurationSeconds: stats.calls > 0 ? Math.round(stats.duration / stats.calls) : 0,
      }
    })
    .sort((a, b) => b.calls - a.calls)

  // 7. Trends and Rates
  const calculateTrend = (curr: number, prev: number) => {
    if (prev === 0) return curr > 0 ? 100 : 0
    return Math.round(((curr - prev) / prev) * 100)
  }

  const currentConnectRate = current.calls > 0 ? (current.connected / current.calls) * 100 : 0
  const prevConnectRate = previous.calls > 0 ? (previous.connected / previous.calls) * 100 : 0
  
  // Real Conversion Rate (% of leads reaching Qualified Interest / Won)
  const currentConvRate = current.leads > 0 ? (current.qualified / current.leads) * 100 : 0
  const prevConvRate = previous.leads > 0 ? (previous.qualified / previous.leads) * 100 : 0

  const leadTrend = calculateTrend(current.leads, previous.leads)
  const callsTrend = calculateTrend(current.calls, previous.calls)

  // 8. Context-Aware AI Performance Summary
  let summaryTitle = "Workforce & Pipeline Status"
  let summaryText = "Performance is stable across leads and telecaller activity."
  let summaryColor = "bg-blue-50/70 text-blue-800 dark:bg-blue-950/20 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/60"
  let SummaryIcon = Sparkles

  if (isToday) {
    summaryTitle = "Live Shift Performance"
    summaryText = `Today's shift is actively underway. The team has completed ${current.calls.toLocaleString()} ${callType === "agent" ? "agent calls" : "calls"} with a ${currentConnectRate.toFixed(1)}% connect rate (${current.connected.toLocaleString()} answered). ${current.new.toLocaleString()} new leads received today.`
    summaryColor = "bg-emerald-50/70 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60"
    SummaryIcon = CheckCircle2
  } else if (leadTrend >= 10 && currentConnectRate >= 35) {
    summaryTitle = "Strong Operations & Pipeline Growth"
    summaryText = `Lead inflow grew by +${leadTrend}% with ${current.qualified.toLocaleString()} qualified leads generated. Telecaller connect rate remains healthy at ${currentConnectRate.toFixed(1)}%.`
    summaryColor = "bg-emerald-50/70 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60"
    SummaryIcon = TrendingUp
  } else if (leadTrend < -15) {
    summaryTitle = "Lead Inflow Notice"
    summaryText = `Lead volume for this period is down ${leadTrend}% compared to the prior period, while outreach logged ${current.calls.toLocaleString()} ${callType === "agent" ? "agent calls" : "calls"}. Review lead generation campaigns.`
    summaryColor = "bg-amber-50/70 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60"
    SummaryIcon = AlertCircle
  } else {
    summaryTitle = "Consistent Workforce Execution"
    summaryText = `Team logged ${current.calls.toLocaleString()} ${callType === "agent" ? "agent calls" : "calls"} with a ${currentConnectRate.toFixed(1)}% connect rate. ${current.qualified.toLocaleString()} leads actively qualified in pipeline.`
    summaryColor = "bg-blue-50/70 text-blue-800 dark:bg-blue-950/20 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/60"
    SummaryIcon = Sparkles
  }

  const formatCurrency = (val: number) => {
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)} Cr`
    if (val >= 100000) return `₹${(val / 100000).toFixed(1)} L`
    return `₹${val.toLocaleString()}`
  }

  // 9. KPI Cards Data
  const stats = [
    {
      title: "Total Leads",
      value: current.leads.toLocaleString(),
      trend: leadTrend,
      comparison: isToday ? "vs yesterday" : "vs previous period",
      icon: Users,
      gradient: "from-blue-600 to-indigo-600",
      iconBg: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    },
    {
      title: callType === "agent" ? "Agent Calls Logged" : callType === "all" ? "Total Telephony Calls" : `${callType.toUpperCase()} Calls Logged`,
      value: current.calls.toLocaleString(),
      trend: callsTrend,
      comparison: isToday ? "vs yesterday" : "vs previous period",
      icon: PhoneCall,
      gradient: "from-emerald-600 to-teal-600",
      iconBg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    },
    {
      title: "Call Connect Rate",
      value: `${currentConnectRate.toFixed(1)}%`,
      subtitle: `${current.connected.toLocaleString()} answered calls`,
      trend: Math.round(currentConnectRate - prevConnectRate),
      isPercentage: true,
      comparison: "vs previous period",
      icon: CheckCircle2,
      gradient: "from-cyan-600 to-blue-600",
      iconBg: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
    },
    {
      title: "Qualified Pipeline",
      value: `${currentConvRate.toFixed(1)}%`,
      subtitle: `${current.qualified.toLocaleString()} qualified · ${current.won.toLocaleString()} won`,
      trend: Math.round(currentConvRate - prevConvRate),
      isPercentage: true,
      comparison: "vs previous period",
      icon: TrendingUp,
      gradient: "from-purple-600 to-pink-600",
      iconBg: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    },
    {
      title: "Top Performer",
      isSpecial: true,
      value: topPerformerName,
      subtitle: `${topPerformerCalls.toLocaleString()} Calls (${topPerformerConnectRate}% Connect)`,
      icon: Trophy,
      gradient: "from-amber-500 to-yellow-500",
      iconBg: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    },
  ]

  return (
    <div className="p-4 md:p-6 space-y-6 bg-slate-50/30 dark:bg-slate-950/10 min-h-screen animate-in fade-in duration-300">
      
      {/* 1. Header Area */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Executive Reports
            </h1>
            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200/60 text-xs font-bold">
              Real-time Analytics
            </Badge>
          </div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-slate-400" />
            <span>
              Reporting Period: <span className="font-semibold text-slate-700 dark:text-slate-200">{new Date(startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span> – <span className="font-semibold text-slate-700 dark:text-slate-200">{new Date(endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              {isToday && <span className="ml-2 text-xs text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200">Today</span>}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ReportsShareModal
            startDate={startDate}
            endDate={endDate}
            isToday={isToday}
            isSingleDay={isSingleDay}
            callType={callType}
            totalCalls={current.calls}
            connectedCalls={current.connected}
            connectRate={currentConnectRate}
            totalLeads={current.leads}
            qualifiedLeads={current.qualified}
            wonLeads={current.won}
            conversionRate={currentConvRate}
            totalDurationSeconds={current.duration}
            topPerformerName={topPerformerName}
            topPerformerCalls={topPerformerCalls}
            topPerformerConnected={topPerformerConnected}
            topPerformerConnectRate={topPerformerConnectRate}
            topCallers={topCallersList}
          />
          <ExportButtons startDate={startDate} endDate={endDate} telecallerId={filterId} callType={callType} />
        </div>
      </div>

      {/* 2. Filters (Admin & Manager Only) */}
      {role !== 'telecaller' && (
        <Card className="border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs rounded-2xl overflow-hidden">
          <CardContent className="p-4">
            <ReportsFilters 
              telecallers={telecallers || []} 
              defaultStartDate={startDate} 
              defaultEndDate={endDate} 
              defaultCallType={callType}
            />
          </CardContent>
        </Card>
      )}

      {/* 3. Smart Insight Banner */}
      <div className={`p-4 rounded-2xl border flex items-center gap-3.5 shadow-xs transition-all duration-300 ${summaryColor}`}>
        <div className="flex-shrink-0 p-2.5 rounded-xl bg-white dark:bg-slate-800 shadow-xs">
          <SummaryIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-blue-700 dark:text-blue-300 flex items-center gap-1">
            {summaryTitle}
          </span>
          <span className="text-sm font-semibold tracking-tight">
            {summaryText}
          </span>
        </div>
      </div>

      {/* 4. KPI Cards Grid (5 High-Impact Executive Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {stats.map((stat, index) => {
          if (stat.isSpecial) {
            return (
              <Card key={index} className="relative overflow-hidden border border-amber-200/80 dark:border-amber-950 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-white dark:to-slate-900 shadow-xs hover:shadow-md transition-all duration-300 group rounded-2xl">
                <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-amber-500 to-yellow-500" />
                <CardContent className="p-5 relative overflow-hidden">
                  <div className="absolute -right-2 -bottom-2 opacity-5 dark:opacity-10 group-hover:scale-110 transition-transform duration-500">
                    <Trophy className="h-28 w-28 text-amber-500" />
                  </div>
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Trophy className="h-3.5 w-3.5 text-amber-500" /> Top Performer
                      </p>
                      <p className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mt-1.5 truncate max-w-[150px]">
                        {stat.value}
                      </p>
                      <div className="pt-1.5">
                        <Badge className="bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200/50 font-bold shadow-none text-[11px] rounded-lg py-0.5 px-2">
                          {stat.subtitle}
                        </Badge>
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 shadow-xs">
                      <Trophy className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          }

          const isPositive = (stat.trend ?? 0) >= 0
          const trendValue = Math.abs(stat.trend ?? 0)

          return (
            <Card key={index} className="relative overflow-hidden border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-md transition-all duration-300 group rounded-2xl">
              <div className={`absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r ${stat.gradient}`} />
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      {stat.title}
                    </p>
                    <p className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
                      {stat.value}
                    </p>
                    {stat.subtitle && (
                      <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 truncate">
                        {stat.subtitle}
                      </p>
                    )}
                  </div>
                  <div className={`p-2.5 rounded-xl ${stat.iconBg} shadow-xs group-hover:scale-105 transition-transform duration-300`}>
                    <stat.icon className="h-5 w-5" />
                  </div>
                </div>

                <div className="flex items-center gap-1.5 mt-3 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-bold ${
                    isPositive 
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-100' 
                      : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-100'
                  }`}>
                    {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {isPositive ? '+' : '-'}{trendValue}%
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium truncate">
                    {stat.comparison}
                  </span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 5. Primary Charts Section: Activity Trend & Real Lead Conversion Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
            <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
              <BarChart3 className="h-4.5 w-4.5 text-blue-500" />
              {isSingleDay ? "Hourly Activity Curve (Shift Operations)" : "Daily Activity Trend"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <Suspense fallback={<div className="h-64 bg-slate-50 dark:bg-slate-900/50 animate-pulse rounded-xl flex items-center justify-center text-slate-400 text-sm">Loading Chart...</div>}>
              <PerformanceChart startDate={startDate} endDate={endDate} telecallerId={filterId} callType={callType} />
            </Suspense>
          </CardContent>
        </Card>

        <Card className="border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
            <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
              <TrendingUp className="h-4.5 w-4.5 text-purple-500" />
              Lead Conversion Funnel (Pipeline Progression)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <Suspense fallback={<div className="h-64 bg-slate-50 dark:bg-slate-900/50 animate-pulse rounded-xl flex items-center justify-center text-slate-400 text-sm">Loading Funnel...</div>}>
              <LeadConversionFunnel startDate={startDate} endDate={endDate} telecallerId={filterId} />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      {/* 6. Secondary Charts: Status Distribution & Lead Source Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
            <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
              <Layers className="h-4.5 w-4.5 text-cyan-500" />
              Lead Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <Suspense fallback={<div className="h-64 bg-slate-50 dark:bg-slate-900/50 animate-pulse rounded-xl flex items-center justify-center text-slate-400 text-sm">Loading Statuses...</div>}>
              <LeadConversionChart startDate={startDate} endDate={endDate} telecallerId={filterId} />
            </Suspense>
          </CardContent>
        </Card>

        <Card className="border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
            <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
              <Users className="h-4.5 w-4.5 text-orange-500" />
              Lead Acquisition Channels & Quality
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <Suspense fallback={<div className="h-64 bg-slate-50 dark:bg-slate-900/50 animate-pulse rounded-xl flex items-center justify-center text-slate-400 text-sm">Loading Sources...</div>}>
              <LeadSourceROIChart startDate={startDate} endDate={endDate} />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      {/* 7. Financial Pipeline & Disbursement Trajectory */}
      <Card className="border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
          <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
            <IndianRupee className="h-4.5 w-4.5 text-emerald-500" />
            6-Month Disbursement & Loan Pipeline Velocity
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <Suspense fallback={<div className="h-64 bg-slate-50 dark:bg-slate-900/50 animate-pulse rounded-xl flex items-center justify-center text-slate-400 text-sm">Loading Financial Data...</div>}>
            <RevenueForecastChart startDate={startDate} endDate={endDate} />
          </Suspense>
        </CardContent>
      </Card>

      {/* 8. Detailed Telecaller Performance Table */}
      <Card className="border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
          <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
            <Users className="h-4.5 w-4.5 text-indigo-500" />
            Agent & Workforce Performance Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 px-2 sm:px-6">
          <Suspense fallback={<div className="h-32 bg-slate-50 dark:bg-slate-900/50 animate-pulse rounded-xl" />}>
            <TelecallerPerformance startDate={startDate} endDate={endDate} telecallerId={filterId} callType={callType} />
          </Suspense>
        </CardContent>
      </Card>

      {/* 9. Quick Navigation Links to Specialized Reports */}
      <div className="flex justify-center items-center gap-3 pb-8 pt-2 flex-wrap">
        <Link 
          href="/admin/reports/attendance" 
          className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center gap-1 font-bold tracking-tight bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 shadow-xs rounded-full py-2 px-5 hover:shadow-md transition-all duration-300"
        >
          View Attendance Report <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
        <Link 
          href="/admin/disbursement-report" 
          className="text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 flex items-center gap-1 font-bold tracking-tight bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 shadow-xs rounded-full py-2 px-5 hover:shadow-md transition-all duration-300"
        >
          View Disbursement Report <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
        <Link 
          href="/admin/c2c-reports" 
          className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 flex items-center gap-1 font-bold tracking-tight bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 shadow-xs rounded-full py-2 px-5 hover:shadow-md transition-all duration-300"
        >
          View Click-to-Call Logs <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}
