"use client"

import { useEffect, useState, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { sharePerformanceTable, PerformanceTableRow } from "@/lib/share-performance-table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { 
  CheckCircle, Minus, Clock, Search, ArrowUpDown, 
  Download, Trophy, Share2, Loader2
} from "lucide-react"

interface PerformanceData {
  id: string
  name: string
  totalLeads: number
  totalCalls: number
  connectedCalls: number
  connectRate: number
  newLeads: number
  convertedLeads: number
  conversionRate: number
  isCheckedIn: boolean
  totalCallDuration: number
  avgCallDuration: number
  callStatusBreakdown: {
    connected: number
    notConnected: number
    noAnswer: number
    busy: number
  }
  lastCallTime: string | null
  avgTimeBetweenCalls: number
}

interface TelecallerPerformanceProps {
  startDate: string
  endDate: string
  telecallerId?: string
  callType?: string
}

type SortField = "calls" | "leads" | "connected" | "connectRate" | "convRate" | "duration" | "name"
type SortOrder = "asc" | "desc"

export function TelecallerPerformance({ startDate, endDate, telecallerId, callType = "agent" }: TelecallerPerformanceProps) {
  const [data, setData] = useState<PerformanceData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortField, setSortField] = useState<SortField>("calls")
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc")
  const [isSharing, setIsSharing] = useState(false)

  const supabase = createClient()

  const formatDuration = (seconds: number) => {
    if (!seconds || seconds === Infinity || isNaN(seconds)) return "00:00:00"
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const formatTime = (timestamp: string | null) => {
    if (!timestamp) return "-"
    return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

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

        let userQuery = supabase
          .from("users")
          .select("id, full_name")
          .eq("is_active", true)

        if (tenantId && role !== 'super_admin') {
          userQuery = userQuery.eq("tenant_id", tenantId)
        }

        if (telecallerId) {
          const ids = telecallerId.split(',').filter(Boolean)
          if (ids.length > 0) userQuery = userQuery.in('id', ids)
        } else {
          userQuery = userQuery.eq("role", "telecaller")
        }

        const today = new Date().toISOString().split('T')[0]
        let attendanceQuery = supabase.from("attendance").select("user_id, check_in").eq("date", today)
        if (tenantId && role !== 'super_admin') {
          attendanceQuery = attendanceQuery.eq("tenant_id", tenantId)
        }

        let leadsQuery = supabase
          .from("leads")
          .select("assigned_to, status")
          .gte("created_at", `${startDate}T00:00:00`)
          .lte("created_at", `${endDate}T23:59:59`)
          .limit(20000)

        if (tenantId && role !== 'super_admin') {
          leadsQuery = leadsQuery.eq("tenant_id", tenantId)
        }

        let callsQuery = supabase
          .from("call_logs")
          .select("user_id, call_status, duration_seconds, created_at, disposition, call_type, notes, leads:leads(status)")
          .gte("created_at", `${startDate}T00:00:00`)
          .lte("created_at", `${endDate}T23:59:59`)
          .order("created_at", { ascending: false })
          .limit(20000)

        if (tenantId && role !== 'super_admin') {
          callsQuery = callsQuery.eq("tenant_id", tenantId)
        }

        // Apply Call Channel Filter
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

        const [
          { data: telecallers },
          { data: attendance },
          { data: leads },
          { data: calls }
        ] = await Promise.all([userQuery, attendanceQuery, leadsQuery, callsQuery])

        if (!isMounted || !telecallers) return

        const attendanceMap = new Map(attendance?.map((a: any) => [a.user_id, !!a.check_in]))
        
        const leadsByUser: Record<string, any[]> = {}
        leads?.forEach((l: any) => {
          if (!leadsByUser[l.assigned_to]) leadsByUser[l.assigned_to] = []
          leadsByUser[l.assigned_to].push(l)
        })

        const callsByUser: Record<string, any[]> = {}
        calls?.forEach((c: any) => {
          if (!callsByUser[c.user_id]) callsByUser[c.user_id] = []
          callsByUser[c.user_id].push(c)
        })

        const qualifiedStatuses = new Set([
          "interested", "documents_sent", "docs pending", "login done", 
          "transferred to kyc", "underwriting", "approved", "disbursed", 
          "closed_won", "booked", "site_visit_scheduled", "site_visit_done"
        ])

        const isCallConnected = (call: any) => {
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

        const isCallBusy = (call: any) => {
          const status = (call.call_status || "").toLowerCase()
          const disp = (call.disposition || "").toUpperCase()
          return status === "busy" || disp === "BUSY"
        }

        const performanceData: PerformanceData[] = telecallers.map((telecaller: any) => {
          const userLeads = leadsByUser[telecaller.id] || []
          const userCalls = callsByUser[telecaller.id] || []

          const totalCalls = userCalls.length
          const totalCallDuration = userCalls.reduce((sum, call) => sum + (Number(call.duration_seconds) || 0), 0)
          const avgCallDuration = totalCalls > 0 ? totalCallDuration / totalCalls : 0

          let avgTimeBetweenCalls = 0
          if (userCalls.length > 1) {
            const sortedTimes = [...userCalls].sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            const totalGap = new Date(sortedTimes[sortedTimes.length-1].created_at).getTime() - new Date(sortedTimes[0].created_at).getTime()
            avgTimeBetweenCalls = (totalGap / 1000) / (userCalls.length - 1)
          }

          const connectedCount = userCalls.filter(isCallConnected).length
          const busyCount = userCalls.filter(isCallBusy).length
          const notConnectedCount = totalCalls - connectedCount
          const noAnswerCount = Math.max(notConnectedCount - busyCount, 0)

          const statusBreakdown = {
            connected: connectedCount,
            notConnected: notConnectedCount,
            noAnswer: noAnswerCount,
            busy: busyCount
          }

          const convertedCount = userLeads.filter(l => qualifiedStatuses.has((l.status || "").toLowerCase().trim())).length
          const convRate = userLeads.length > 0 ? (convertedCount / userLeads.length) * 100 : 0
          const connectRate = totalCalls > 0 ? (connectedCount / totalCalls) * 100 : 0

          return {
            id: telecaller.id,
            name: telecaller.full_name,
            totalLeads: userLeads.length,
            totalCalls,
            connectedCalls: connectedCount,
            connectRate,
            newLeads: userLeads.filter(l => (l.status || "").toLowerCase() === "new").length,
            convertedLeads: convertedCount,
            conversionRate: convRate,
            isCheckedIn: attendanceMap.get(telecaller.id) || false,
            totalCallDuration,
            avgCallDuration,
            callStatusBreakdown: statusBreakdown,
            lastCallTime: userCalls.length > 0 ? userCalls[0].created_at : null,
            avgTimeBetweenCalls
          }
        })

        performanceData.sort((a, b) => b.totalCalls - a.totalCalls)
        setData(performanceData)

      } catch (error) {
        console.error("Error fetching performance:", error)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    fetchData()

    return () => {
      isMounted = false
    }
  }, [startDate, endDate, telecallerId, callType, supabase])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortOrder("desc")
    }
  }

  const sortedData = useMemo(() => {
    let list = [...data]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(item => item.name.toLowerCase().includes(q))
    }

    list.sort((a, b) => {
      let valA: any = 0
      let valB: any = 0

      switch (sortField) {
        case "calls":
          valA = a.totalCalls
          valB = b.totalCalls
          break
        case "leads":
          valA = a.totalLeads
          valB = b.totalLeads
          break
        case "connected":
          valA = a.connectedCalls
          valB = b.connectedCalls
          break
        case "connectRate":
          valA = a.connectRate
          valB = b.connectRate
          break
        case "convRate":
          valA = a.conversionRate
          valB = b.conversionRate
          break
        case "duration":
          valA = a.totalCallDuration
          valB = b.totalCallDuration
          break
        case "name":
          return sortOrder === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      }

      return sortOrder === "asc" ? valA - valB : valB - valA
    })

    return list
  }, [data, searchQuery, sortField, sortOrder])

  const totals = useMemo(() => {
    const totalCalls = data.reduce((s, d) => s + d.totalCalls, 0)
    const totalConnected = data.reduce((s, d) => s + d.connectedCalls, 0)
    const totalLeads = data.reduce((s, d) => s + d.totalLeads, 0)
    const totalConverted = data.reduce((s, d) => s + d.convertedLeads, 0)
    const totalDuration = data.reduce((s, d) => s + d.totalCallDuration, 0)
    const avgConnectRate = totalCalls > 0 ? (totalConnected / totalCalls) * 100 : 0
    const avgConvRate = totalLeads > 0 ? (totalConverted / totalLeads) * 100 : 0

    return {
      totalCalls,
      totalConnected,
      totalLeads,
      totalConverted,
      totalDuration,
      avgConnectRate,
      avgConvRate,
    }
  }, [data])

  const exportTableCSV = () => {
    const headers = [
      "Agent Name", "Status", "Total Leads", "Total Calls", "Connected Calls", 
      "Connect Rate %", "Total Duration", "Avg Duration", "Qualified Leads", "Conversion Rate %"
    ]

    const rows = sortedData.map(d => [
      `"${d.name.replace(/"/g, '""')}"`,
      d.isCheckedIn ? "Online" : "Offline",
      d.totalLeads,
      d.totalCalls,
      d.connectedCalls,
      `${d.connectRate.toFixed(1)}%`,
      formatDuration(d.totalCallDuration),
      formatDuration(d.avgCallDuration),
      d.convertedLeads,
      `${d.conversionRate.toFixed(1)}%`
    ])

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n")
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.setAttribute("download", `agent_performance_${startDate}_to_${endDate}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleShareScreenshot = async () => {
    if (!sortedData || sortedData.length === 0) return
    setIsSharing(true)
    try {
      const rows: PerformanceTableRow[] = sortedData.map((d) => ({
        name: d.name,
        totalCalls: d.totalCalls,
        connectedCalls: d.connectedCalls,
        totalDurationSeconds: d.totalCallDuration,
        avgDurationSeconds: d.avgCallDuration,
      }))

      const dateLabel = startDate === endDate ? startDate : `${startDate} to ${endDate}`
      await sharePerformanceTable({
        rows,
        dateLabel,
        brandName: "Hanva CRM",
      })
    } finally {
      setIsSharing(false)
    }
  }

  const getPerformanceBadge = (rate: number, type: "connect" | "conversion") => {
    const thresholds = type === "connect" ? [50, 30] : [15, 8]
    if (rate >= thresholds[0]) {
      return (
        <Badge className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/50 font-bold text-[10px] py-0 px-2 rounded-full shadow-none">
          Excellent
        </Badge>
      )
    } else if (rate >= thresholds[1]) {
      return (
        <Badge className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200/50 font-bold text-[10px] py-0 px-2 rounded-full shadow-none">
          Good
        </Badge>
      )
    } else {
      return (
        <Badge className="bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200/50 font-bold text-[10px] py-0 px-2 rounded-full shadow-none">
          Needs Training
        </Badge>
      )
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-3">
        <div className="h-6 w-6 border-2 border-blue-600 border-t-transparent animate-spin rounded-full" />
        <span className="text-sm font-semibold text-slate-500 animate-pulse">Calculating workforce metrics...</span>
      </div>
    )
  }

  return (
    <div className="space-y-3.5">
      {/* Table Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
        <div className="relative w-full sm:w-64">
          <Search className="h-3.5 w-3.5 absolute left-3 top-3 text-slate-400" />
          <Input 
            placeholder="Search telecaller..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 pl-8 text-xs rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
          />
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[11px] font-semibold text-blue-700 bg-blue-50 dark:bg-blue-950/40 border-blue-200">
            {callType === "agent" ? "Filtered: Agent Calls (Outbound & C2C)" : `Channel: ${callType.toUpperCase()}`}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={exportTableCSV}
            className="h-9 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 flex items-center gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Export Table CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleShareScreenshot}
            disabled={isSharing}
            className="h-9 text-xs font-bold rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 dark:hover:bg-emerald-900/60 flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
          >
            {isSharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
            {isSharing ? "Generating..." : "Share Screenshot"}
          </Button>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto border border-slate-200/60 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 shadow-xs">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-slate-500 dark:text-slate-400 text-[11px] font-extrabold uppercase tracking-wider">
              <th className="py-3 px-4 font-bold text-left sticky left-0 bg-slate-50/70 dark:bg-slate-950/40 z-10">
                <button 
                  type="button" 
                  onClick={() => handleSort("name")}
                  className="flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  Telecaller
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-bold text-left">Status</th>
              <th className="py-3 px-4 font-bold text-center">
                <button 
                  type="button" 
                  onClick={() => handleSort("leads")}
                  className="flex items-center gap-1 hover:text-slate-800 mx-auto"
                >
                  Leads <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-bold text-center">
                <button 
                  type="button" 
                  onClick={() => handleSort("calls")}
                  className="flex items-center gap-1 hover:text-slate-800 mx-auto text-blue-600 dark:text-blue-400"
                >
                  Calls <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-bold text-center">
                <button 
                  type="button" 
                  onClick={() => handleSort("connected")}
                  className="flex items-center gap-1 hover:text-slate-800 mx-auto text-emerald-600 dark:text-emerald-400"
                >
                  Connected <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-bold text-left">
                <button 
                  type="button" 
                  onClick={() => handleSort("duration")}
                  className="flex items-center gap-1 hover:text-slate-800"
                >
                  Duration <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-bold text-center">Last Call</th>
              <th className="py-3 px-4 font-bold text-center">
                <button 
                  type="button" 
                  onClick={() => handleSort("connectRate")}
                  className="flex items-center gap-1 hover:text-slate-800 mx-auto"
                >
                  Connect Rate <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-bold text-center">
                <button 
                  type="button" 
                  onClick={() => handleSort("convRate")}
                  className="flex items-center gap-1 hover:text-slate-800 mx-auto"
                >
                  Conv. Rate <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-bold text-left">Call Status Breakdown</th>
            </tr>
          </thead>
          <tbody className="text-xs divide-y divide-slate-100 dark:divide-slate-800/80">
            {sortedData.map((telecaller, idx) => (
              <tr key={telecaller.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors group">
                <td className="py-3 px-4 font-medium sticky left-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50/50 dark:group-hover:bg-slate-900/40 z-10 transition-colors border-r border-slate-100 dark:border-slate-800/60">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-[11px] relative shadow-xs ring-2 ${
                      telecaller.isCheckedIn 
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/20" 
                        : "bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-200 dark:ring-slate-800"
                    }`}>
                      {telecaller.name.charAt(0).toUpperCase()}
                      {telecaller.isCheckedIn && (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white dark:border-slate-900" />
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-800 dark:text-slate-100 tracking-tight text-[13px] flex items-center gap-1">
                        {telecaller.name}
                        {idx === 0 && (
                          <span title="Top Caller in period">
                            <Trophy className="h-3 w-3 text-amber-500 inline" />
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </td>
                
                <td className="py-3 px-4">
                  <Badge className={
                    telecaller.isCheckedIn 
                      ? "bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-extrabold text-[10px]" 
                      : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200/50 dark:border-slate-700/50 font-bold text-[10px]"
                  }>
                    {telecaller.isCheckedIn ? "Online" : "Offline"}
                  </Badge>
                </td>

                <td className="py-3 px-4 text-center font-bold text-slate-700 dark:text-slate-300 text-[13px]">
                  {telecaller.totalLeads}
                </td>
                
                <td className="py-3 px-4 text-center font-extrabold text-blue-600 dark:text-blue-400 text-[13px]">
                  {telecaller.totalCalls}
                </td>

                <td className="py-3 px-4 text-center font-extrabold text-emerald-600 dark:text-emerald-400 text-[13px]">
                  {telecaller.connectedCalls}
                </td>
                
                <td className="py-3 px-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 text-[12px]">
                      {formatDuration(telecaller.totalCallDuration)}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold uppercase">
                      Avg: {formatDuration(telecaller.avgCallDuration)}
                    </span>
                  </div>
                </td>

                <td className="py-3 px-4 text-center font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  {formatTime(telecaller.lastCallTime)}
                </td>
                
                <td className="py-3 px-4">
                  <div className="flex flex-col items-center gap-1.5 min-w-[85px]">
                    <span className="font-extrabold text-slate-900 dark:text-slate-100 text-[13px]">
                      {telecaller.connectRate.toFixed(1)}%
                    </span>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 rounded-full transition-all" 
                        style={{ width: `${Math.min(telecaller.connectRate, 100)}%` }} 
                      />
                    </div>
                    {getPerformanceBadge(telecaller.connectRate, "connect")}
                  </div>
                </td>

                <td className="py-3 px-4">
                  <div className="flex flex-col items-center gap-1.5 min-w-[85px]">
                    <span className="font-extrabold text-slate-900 dark:text-slate-100 text-[13px]">
                      {telecaller.conversionRate.toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-slate-400">
                      ({telecaller.convertedLeads} qualified)
                    </span>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 rounded-full transition-all" 
                        style={{ width: `${Math.min(telecaller.conversionRate * 3, 100)}%` }} 
                      />
                    </div>
                    {getPerformanceBadge(telecaller.conversionRate, "conversion")}
                  </div>
                </td>

                <td className="py-3 px-4">
                  <div className="flex gap-1.5">
                    <div 
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-bold" 
                      title="Connected / Answered"
                    >
                      <CheckCircle className="w-3 h-3" /> 
                      <span>{telecaller.callStatusBreakdown.connected}</span>
                    </div>
                    <div 
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-bold" 
                      title="No Answer / Missed"
                    >
                      <Minus className="w-3 h-3" /> 
                      <span>{telecaller.callStatusBreakdown.noAnswer}</span>
                    </div>
                    <div 
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-bold" 
                      title="Busy / Rejected"
                    >
                      <Clock className="w-3 h-3" /> 
                      <span>{telecaller.callStatusBreakdown.busy}</span>
                    </div>
                  </div>
                </td>
              </tr>
            ))}

            {sortedData.length === 0 && (
              <tr>
                <td colSpan={10} className="py-12 text-center text-slate-400 font-semibold">
                  No telecaller activity found matching the criteria.
                </td>
              </tr>
            )}
          </tbody>

          {sortedData.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 font-bold text-xs">
              <tr>
                <td className="py-3 px-4 text-slate-800 dark:text-slate-200">
                  Team Totals ({sortedData.length} Agents)
                </td>
                <td className="py-3 px-4"></td>
                <td className="py-3 px-4 text-center text-slate-800 dark:text-slate-200">
                  {totals.totalLeads.toLocaleString()}
                </td>
                <td className="py-3 px-4 text-center text-blue-600 dark:text-blue-400 text-sm">
                  {totals.totalCalls.toLocaleString()}
                </td>
                <td className="py-3 px-4 text-center text-emerald-600 dark:text-emerald-400 text-sm">
                  {totals.totalConnected.toLocaleString()}
                </td>
                <td className="py-3 px-4 text-slate-800 dark:text-slate-200">
                  {formatDuration(totals.totalDuration)}
                </td>
                <td className="py-3 px-4"></td>
                <td className="py-3 px-4 text-center text-emerald-600 dark:text-emerald-400">
                  {totals.avgConnectRate.toFixed(1)}%
                </td>
                <td className="py-3 px-4 text-center text-blue-600 dark:text-blue-400">
                  {totals.avgConvRate.toFixed(1)}%
                </td>
                <td className="py-3 px-4"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
