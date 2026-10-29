"use client"

import { Button } from "@/components/ui/button"
import { FileSpreadsheet, Users, Phone, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useState } from "react"

interface ExportButtonsProps {
  startDate: string
  endDate: string
  telecallerId?: string
  callType?: string
}

export function ExportButtons({ startDate, endDate, telecallerId, callType = "agent" }: ExportButtonsProps) {
  const [isExporting, setIsExporting] = useState<string | null>(null)
  const supabase = createClient()

  const exportToCSV = (data: any[], filename: string, headers: { key: string; label: string }[]) => {
    const csvHeader = headers.map(h => `"${h.label.replace(/"/g, '""')}"`).join(",")
    
    const csvRows = data.map((row) =>
      headers
        .map((header) => {
          const val = row[header.key]
          if (val === null || val === undefined) return '""'
          const str = String(val).replace(/"/g, '""')
          return `"${str}"`
        })
        .join(",")
    )

    const csvContent = [csvHeader, ...csvRows].join("\n")
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${filename}_${startDate}_to_${endDate}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const getTenantContext = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { tenantId: null, role: null }
    const { data: profile } = await supabase.from('users').select('tenant_id, role').eq('id', user.id).single()
    return { tenantId: profile?.tenant_id || null, role: profile?.role || null }
  }

  const exportLeads = async () => {
    setIsExporting("leads")
    try {
      const { tenantId, role } = await getTenantContext()

      let query = supabase
        .from("leads")
        .select(`
          name,
          email,
          phone,
          company,
          source,
          status,
          loan_amount,
          disbursed_amount,
          created_at,
          last_contacted,
          assigned_user:users!leads_assigned_to_fkey(full_name)
        `)
        .gte("created_at", `${startDate}T00:00:00`)
        .lte("created_at", `${endDate}T23:59:59`)
        .limit(20000)

      if (tenantId && role !== 'super_admin') {
        query = query.eq("tenant_id", tenantId)
      }

      if (telecallerId) {
        const ids = telecallerId.split(',').filter(Boolean)
        if (ids.length > 0) query = query.in("assigned_to", ids)
      }

      const { data, error } = await query
      if (error) throw error

      if (data) {
        const exportData = data.map((lead: any) => ({
          name: lead.name || "N/A",
          phone: lead.phone || "",
          email: lead.email || "",
          company: lead.company || "",
          source: lead.source || "Direct",
          status: (lead.status || "NEW").replace(/_/g, " ").toUpperCase(),
          loan_amount: lead.loan_amount || "",
          disbursed_amount: lead.disbursed_amount || "",
          assigned_to: lead.assigned_user?.full_name || "Unassigned",
          created_at: lead.created_at ? new Date(lead.created_at).toLocaleString() : "",
          last_contacted: lead.last_contacted ? new Date(lead.last_contacted).toLocaleString() : "",
        }))

        exportToCSV(exportData, "leads_report", [
          { key: "name", label: "Lead Name" },
          { key: "phone", label: "Phone" },
          { key: "email", label: "Email" },
          { key: "company", label: "Company" },
          { key: "source", label: "Source" },
          { key: "status", label: "Status" },
          { key: "loan_amount", label: "Loan Amount (₹)" },
          { key: "disbursed_amount", label: "Disbursed Amount (₹)" },
          { key: "assigned_to", label: "Assigned Telecaller" },
          { key: "created_at", label: "Created Date" },
          { key: "last_contacted", label: "Last Contacted" },
        ])
      }
    } catch (error) {
      console.error("Error exporting leads:", error)
      alert("Failed to export leads. Please try a shorter date range.")
    } finally {
      setIsExporting(null)
    }
  }

  const exportCalls = async () => {
    setIsExporting("calls")
    try {
      const { tenantId, role } = await getTenantContext()

      let query = supabase
        .from("call_logs")
        .select(`
          call_type,
          call_status,
          disposition,
          duration_seconds,
          notes,
          created_at,
          recording_url,
          users!call_logs_user_id_fkey(full_name),
          leads!call_logs_lead_id_fkey(name, phone, status)
        `)
        .gte("created_at", `${startDate}T00:00:00`)
        .lte("created_at", `${endDate}T23:59:59`)
        .order("created_at", { ascending: false })
        .limit(20000)

      if (tenantId && role !== 'super_admin') {
        query = query.eq("tenant_id", tenantId)
      }

      // Call Type filter
      if (callType === "outbound") {
      query = query.eq('call_type', 'outbound')
    } else if (callType === "c2c") {
      query = query.eq('call_type', 'outbound_c2c')
    } else if (callType === "ivr") {
      query = query.eq('call_type', 'ivr')
    } else if (callType === "inbound") {
      query = query.eq('call_type', 'inbound')
    } else {
      query = query.in('call_type', ['outbound', 'outbound_c2c'])
    }

      if (telecallerId) {
        const ids = telecallerId.split(',').filter(Boolean)
        if (ids.length > 0) query = query.in("user_id", ids)
      }

      const { data, error } = await query
      if (error) throw error

      if (data) {
        const exportData = data.map((call: any) => {
          const status = (call.call_status || "").toLowerCase()
          const disp = (call.disposition || "").toUpperCase()
          const notes = (call.notes || "").toLowerCase()
          const leadSt = (call.leads?.status || "").toLowerCase()
          const dur = Number(call.duration_seconds) || 0
          
          let isConn = false
          if (
            status !== "notanswered" && 
            status !== "no_answer" && 
            status !== "failed" &&
            disp !== "NOANSWER" && 
            disp !== "CANCEL" && 
            disp !== "BUSY" && 
            disp !== "CONGESTION" &&
            leadSt !== "nr" &&
            !notes.includes("nr (") &&
            notes !== "status updated to nr"
          ) {
            isConn = status === "connected" || status === "answered" || disp === "ANSWERED"
          }

          return {
            telecaller: call.users?.full_name || "Unknown Agent",
            lead_name: call.leads?.name || "Direct Dial",
            lead_phone: call.leads?.phone || "",
            call_type: call.call_type || "outbound",
            outcome: isConn ? "Connected" : "Not Connected",
            status_raw: call.call_status || "",
            disposition: call.disposition || "",
            duration_formatted: `${Math.floor(dur / 60)}m ${dur % 60}s`,
            duration_seconds: dur,
            call_timestamp: call.created_at ? new Date(call.created_at).toLocaleString() : "",
            recording_url: call.recording_url || "",
            notes: call.notes || "",
          }
        })

        exportToCSV(exportData, "calls_report", [
          { key: "telecaller", label: "Agent Name" },
          { key: "lead_name", label: "Lead Name" },
          { key: "lead_phone", label: "Lead Phone" },
          { key: "call_type", label: "Call Type" },
          { key: "outcome", label: "Call Outcome" },
          { key: "status_raw", label: "Call Status" },
          { key: "disposition", label: "Disposition" },
          { key: "duration_formatted", label: "Duration" },
          { key: "duration_seconds", label: "Duration (Seconds)" },
          { key: "call_timestamp", label: "Date & Time" },
          { key: "recording_url", label: "Recording URL" },
          { key: "notes", label: "Notes" },
        ])
      }
    } catch (error) {
      console.error("Error exporting calls:", error)
      alert("Failed to export calls. Please try a shorter date range.")
    } finally {
      setIsExporting(null)
    }
  }

  const exportPerformance = async () => {
    setIsExporting("performance")
    try {
      const { tenantId, role } = await getTenantContext()

      // 1. Fetch telecallers
      let telecallersQuery = supabase
        .from("users")
        .select("id, full_name")
        .eq("is_active", true)

      if (tenantId && role !== 'super_admin') {
        telecallersQuery = telecallersQuery.eq("tenant_id", tenantId)
      }

      if (telecallerId) {
        const ids = telecallerId.split(',').filter(Boolean)
        if (ids.length > 0) telecallersQuery = telecallersQuery.in("id", ids)
      } else {
        telecallersQuery = telecallersQuery.eq("role", "telecaller")
      }

      // 2. Fetch leads in period
      let leadsQuery = supabase
        .from("leads")
        .select("assigned_to, status")
        .gte("created_at", `${startDate}T00:00:00`)
        .lte("created_at", `${endDate}T23:59:59`)
        .limit(20000)

      if (tenantId && role !== 'super_admin') {
        leadsQuery = leadsQuery.eq("tenant_id", tenantId)
      }

      // 3. Fetch call logs in period
      let callsQuery = supabase
        .from("call_logs")
        .select("user_id, call_status, disposition, duration_seconds, call_type, notes, leads:leads(status)")
        .gte("created_at", `${startDate}T00:00:00`)
        .lte("created_at", `${endDate}T23:59:59`)
        .limit(20000)

      if (tenantId && role !== 'super_admin') {
        callsQuery = callsQuery.eq("tenant_id", tenantId)
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

      // Execute all 3 queries in parallel!
      const [
        { data: telecallers, error: err1 },
        { data: leads, error: err2 },
        { data: calls, error: err3 }
      ] = await Promise.all([telecallersQuery, leadsQuery, callsQuery])

      if (err1 || err2 || err3) throw (err1 || err2 || err3)

      if (!telecallers) return

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

      const qualifiedStatuses = new Set([
        "interested", "documents_sent", "docs pending", "login done", 
        "transferred to kyc", "underwriting", "approved", "disbursed", "closed_won", "booked"
      ])

      // Group leads by telecaller
      const leadsByUser: Record<string, any[]> = {}
      leads?.forEach((l: any) => {
        if (!leadsByUser[l.assigned_to]) leadsByUser[l.assigned_to] = []
        leadsByUser[l.assigned_to].push(l)
      })

      // Group calls by telecaller
      const callsByUser: Record<string, any[]> = {}
      calls?.forEach((c: any) => {
        if (!callsByUser[c.user_id]) callsByUser[c.user_id] = []
        callsByUser[c.user_id].push(c)
      })

      const performanceRows = telecallers.map((t: any) => {
        const uCalls = callsByUser[t.id] || []
        const uLeads = leadsByUser[t.id] || []

        const totalCalls = uCalls.length
        const connectedCalls = uCalls.filter(isCallConnected).length
        const totalDuration = uCalls.reduce((sum, c) => sum + (Number(c.duration_seconds) || 0), 0)
        const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0
        const connectRate = totalCalls > 0 ? ((connectedCalls / totalCalls) * 100).toFixed(1) + "%" : "0%"

        const qualifiedCount = uLeads.filter(l => qualifiedStatuses.has((l.status || "").toLowerCase().trim())).length
        const convRate = uLeads.length > 0 ? ((qualifiedCount / uLeads.length) * 100).toFixed(1) + "%" : "0%"

        return {
          telecaller: t.full_name,
          total_leads: uLeads.length,
          total_calls: totalCalls,
          connected_calls: connectedCalls,
          connect_rate: connectRate,
          total_duration: `${Math.floor(totalDuration / 60)}m ${totalDuration % 60}s`,
          avg_duration: `${Math.floor(avgDuration / 60)}m ${avgDuration % 60}s`,
          qualified_leads: qualifiedCount,
          conversion_rate: convRate,
        }
      })

      // Sort by total calls descending
      performanceRows.sort((a, b) => b.total_calls - a.total_calls)

      exportToCSV(performanceRows, "workforce_performance_report", [
        { key: "telecaller", label: "Agent Name" },
        { key: "total_leads", label: "Assigned Leads" },
        { key: "total_calls", label: "Total Calls" },
        { key: "connected_calls", label: "Connected Calls" },
        { key: "connect_rate", label: "Connect Rate" },
        { key: "total_duration", label: "Total Talk Time" },
        { key: "avg_duration", label: "Average Call Duration" },
        { key: "qualified_leads", label: "Qualified Leads" },
        { key: "conversion_rate", label: "Conversion Rate" },
      ])
    } catch (error) {
      console.error("Error exporting performance:", error)
      alert("Failed to export performance data.")
    } finally {
      setIsExporting(null)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        variant="outline"
        size="sm"
        onClick={exportLeads}
        disabled={isExporting !== null}
        className="h-9 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5"
      >
        {isExporting === "leads" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileSpreadsheet className="h-3.5 w-3.5 text-blue-600" />
        )}
        <span>{isExporting === "leads" ? "Exporting..." : "Export Leads"}</span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={exportCalls}
        disabled={isExporting !== null}
        className="h-9 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5"
      >
        {isExporting === "calls" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Phone className="h-3.5 w-3.5 text-emerald-600" />
        )}
        <span>{isExporting === "calls" ? "Exporting..." : "Export Calls"}</span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={exportPerformance}
        disabled={isExporting !== null}
        className="h-9 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5"
      >
        {isExporting === "performance" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Users className="h-3.5 w-3.5 text-purple-600" />
        )}
        <span>{isExporting === "performance" ? "Exporting..." : "Export Performance"}</span>
      </Button>
    </div>
  )
}
