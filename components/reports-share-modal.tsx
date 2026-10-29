"use client"

import React, { useRef, useState, useMemo } from "react"
import { PerformanceTableModal } from "@/components/admin/performance-table-modal"
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogDescription 
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { 
  Share2, Copy, Check, Download, Trophy, PhoneCall, 
  CheckCircle2, Users, TrendingUp, Clock, Flame, 
  Sparkles, Loader2, Calendar, ShieldCheck, Table
} from "lucide-react"
import { toast } from "sonner"
import { sharePerformanceTable, PerformanceTableRow } from "@/lib/share-performance-table"

export interface TopCallerStats {
  id: string
  name: string
  calls: number
  connected: number
  connectRate: number
  totalDurationSeconds?: number
  avgDurationSeconds?: number
}

export interface ReportsShareModalProps {
  startDate: string
  endDate: string
  isToday: boolean
  isSingleDay: boolean
  callType?: string
  totalCalls: number
  connectedCalls: number
  connectRate: number
  totalLeads: number

  qualifiedLeads: number
  wonLeads: number
  conversionRate: number
  totalDurationSeconds: number
  topPerformerName: string
  topPerformerCalls: number
  topPerformerConnected: number
  topPerformerConnectRate: string
  topCallers: TopCallerStats[]
}

function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return "0m"
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function formatDateFormatted(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  } catch {
    return dateStr
  }
}

export function ReportsShareModal({
  startDate,
  endDate,
  isToday,
  isSingleDay,
  callType = "agent",
  totalCalls,
  connectedCalls,
  connectRate,
  totalLeads,
  qualifiedLeads,
  wonLeads,
  conversionRate,
  totalDurationSeconds,
  topPerformerName,
  topPerformerCalls,
  topPerformerConnected,
  topPerformerConnectRate,
  topCallers,
}: ReportsShareModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isSharingTable, setIsSharingTable] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const dateLabel = isToday
    ? `Today's Shift • ${formatDateFormatted(startDate)}`
    : isSingleDay
    ? formatDateFormatted(startDate)
    : `${formatDateFormatted(startDate)} – ${formatDateFormatted(endDate)}`

  const handleCopyImage = async () => {
    if (!cardRef.current) return
    setIsCopying(true)
    try {
      const { toBlob } = await import("html-to-image")
      const blob = await toBlob(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#090d16",
        skipFonts: true,
      })

      if (!blob) throw new Error("Could not create image blob")

      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob })
        ])
        setCopied(true)
        toast.success("Report image copied! You can now paste (Ctrl+V) directly into WhatsApp.")
        setTimeout(() => setCopied(false), 3000)
      } else {
        // Fallback for browsers without ClipboardItem image support
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `performance-report-${startDate}.png`
        a.click()
        URL.revokeObjectURL(url)
        toast.success("Direct clipboard image paste not supported in this browser. Image downloaded!")
      }
    } catch (err: any) {
      console.error("Error copying report image:", err)
      toast.error("Failed to copy image to clipboard. Downloading image instead...")
      handleDownloadImage()
    } finally {
      setIsCopying(false)
    }
  }

  const handleDownloadImage = async () => {
    if (!cardRef.current) return
    setIsDownloading(true)
    try {
      const { toPng } = await import("html-to-image")
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#090d16",
        skipFonts: true,
      })

      const a = document.createElement("a")
      a.href = dataUrl
      a.download = `performance-report-${startDate}.png`
      a.click()
      toast.success("Report image downloaded successfully!")
    } catch (err: any) {
      console.error("Download error:", err)
      toast.error("Failed to generate image download.")
    } finally {
      setIsDownloading(false)
    }
  }

  const handleWhatsAppTextShare = () => {
    let topCallersText = ""
    if (topCallers && topCallers.length > 0) {
      const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]
      topCallersText = `\n\n🏆 *TOP CALLERS RANKING:*\n` + topCallers.slice(0, 5).map((c, i) => {
        const medal = medals[i] || `${i + 1}.`
        return `${medal} *${c.name}*: ${c.calls} calls (${c.connectRate}% connect)`
      }).join("\n")
    }

    const message = `📊 *BANKS CART • PERFORMANCE REPORT*
📅 *Period:* ${dateLabel}

👑 *CALL CHAMPION (TOP PERFORMER):*
⭐ *${topPerformerName}* — *${topPerformerCalls} Calls* (${topPerformerConnectRate}% Connect Rate)

📈 *SHIFT METRICS:*
• 📞 *Total Calls:* ${totalCalls.toLocaleString()}
• ⚡ *Connected Calls:* ${connectedCalls.toLocaleString()} (${connectRate.toFixed(1)}%)
• ⏱️ *Talk Time:* ${formatDuration(totalDurationSeconds)}
• 👥 *Total Leads:* ${totalLeads.toLocaleString()}
• 🎯 *Qualified Leads:* ${qualifiedLeads.toLocaleString()} (${conversionRate.toFixed(1)}%)${topCallersText}

_Generated via BanksCart CRM_`

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`
    window.open(url, "_blank")
  }

  const [showTableModal, setShowTableModal] = useState(false)

  const heatmapRows: PerformanceTableRow[] = useMemo(() => {
    return (topCallers || []).map((c) => ({
      name: c.name,
      totalCalls: c.calls,
      connectedCalls: c.connected,
      totalDurationSeconds: c.totalDurationSeconds || 0,
      avgDurationSeconds: c.avgDurationSeconds || (c.calls > 0 ? (c.totalDurationSeconds || 0) / c.calls : 0),
      connectRate: c.connectRate,
    }))
  }, [topCallers])

  const handleShareHeatmapTable = () => {
    if (!topCallers || topCallers.length === 0) {
      toast.error("No caller performance data available to share.")
      return
    }
    setShowTableModal(true)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-10 px-4 gap-2 font-bold text-sm bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 dark:hover:bg-emerald-900/60 shadow-xs transition-all cursor-pointer"
        >
          {/* WhatsApp green icon */}
          <svg className="h-4 w-4 fill-emerald-600 dark:fill-emerald-400" viewBox="0 0 24 24">
            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
          </svg>
          Share Report
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-4 sm:p-6 bg-slate-900 text-slate-100 border-slate-800">
        <DialogHeader className="pb-2 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
                <Share2 className="h-5 w-5 text-emerald-400" />
                Share Report to WhatsApp
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400">
                Click <b className="text-emerald-400">Copy Image</b> to paste directly into WhatsApp (Ctrl+V), or download the PNG card.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 py-3">
          <Button
            onClick={handleCopyImage}
            disabled={isCopying}
            className={`font-bold flex-1 sm:flex-initial gap-2 text-white shadow-lg transition-all ${
              copied
                ? "bg-emerald-700 hover:bg-emerald-800"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {isCopying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? "Copied to Clipboard! 🎉" : "Copy Image for WhatsApp"}
          </Button>

          <Button
            onClick={handleDownloadImage}
            disabled={isDownloading}
            variant="outline"
            className="border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium gap-2 text-xs"
          >
            {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download PNG
          </Button>

          <Button
            onClick={handleWhatsAppTextShare}
            variant="outline"
            className="border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium gap-2 text-xs"
          >
            <svg className="h-3.5 w-3.5 fill-emerald-400" viewBox="0 0 24 24">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
            </svg>
            Open in WhatsApp
          </Button>

          <Button
            onClick={handleShareHeatmapTable}
            disabled={isSharingTable}
            variant="outline"
            className="border-emerald-600/50 bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 font-bold gap-2 text-xs shadow-xs"
          >
            {isSharingTable ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Table className="h-3.5 w-3.5 text-emerald-400" />
            )}
            {isSharingTable ? "Generating..." : "Share Table Screenshot"}
          </Button>
        </div>

        {/* Visual Card Preview / Render Node */}
        <div className="flex justify-center items-center py-2 bg-slate-950/70 p-2 sm:p-4 rounded-xl border border-slate-800/80">
          <div
            ref={cardRef}
            className="w-full max-w-[540px] rounded-2xl p-5 sm:p-6 text-white shadow-2xl relative overflow-hidden"
            style={{
              background: "linear-gradient(145deg, #0b1120 0%, #0f172a 40%, #090d16 100%)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            }}
          >
            {/* Top Glow Accent */}
            <div className="absolute -top-12 -left-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* 1. Header & Brand */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10 relative z-10">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-md">
                  <ShieldCheck className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold tracking-wider text-white uppercase flex items-center gap-1.5">
                    BanksCart CRM
                  </h3>
                  <p className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">
                    Performance Intelligence
                  </p>
                </div>
              </div>

              <div className="text-right">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  {isToday ? "Today's Shift" : "Summary"}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 font-medium">
                  {dateLabel}
                </p>
              </div>
            </div>

            {/* 2. Call Champion / Top Performer Golden Spotlight Card */}
            <div className="mt-4 p-4 rounded-xl relative overflow-hidden z-10"
              style={{
                background: "linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(217, 119, 6, 0.04) 100%)",
                border: "1px solid rgba(245, 158, 11, 0.35)",
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-amber-500/20 rounded-lg text-amber-400 border border-amber-500/30">
                    <Trophy className="h-4 w-4" />
                  </span>
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-300 flex items-center gap-1">
                    👑 Call Champion • High Calls
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  #1 Performer
                </span>
              </div>

              <div className="mt-2.5 flex items-baseline justify-between">
                <div>
                  <p className="text-lg font-black tracking-tight text-white">
                    {topPerformerName || "Team Performance"}
                  </p>
                  <p className="text-[11px] font-medium text-amber-200/80">
                    Highest outreach activity logged
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-2xl font-black text-amber-400 tracking-tight">
                    {topPerformerCalls.toLocaleString()}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80">
                    Calls ({topPerformerConnectRate}% Connect)
                  </p>
                </div>
              </div>
            </div>

            {/* 3. Core Shift Metrics Grid (4 Key Metric Blocks) */}
            <div className="mt-4 grid grid-cols-2 gap-3 relative z-10">
              {/* Total Calls */}
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] relative">
                <div className="flex items-center justify-between text-slate-400 mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider">Total Calls</span>
                  <PhoneCall className="h-4 w-4 text-emerald-400" />
                </div>
                <p className="text-2xl font-black text-white tracking-tight">
                  {totalCalls.toLocaleString()}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {callType === "agent" ? "Agent outbound calls" : `${callType.toUpperCase()} calls`}
                </p>
              </div>

              {/* Connected Calls */}
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] relative">
                <div className="flex items-center justify-between text-slate-400 mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider">Connected</span>
                  <CheckCircle2 className="h-4 w-4 text-cyan-400" />
                </div>
                <p className="text-2xl font-black text-cyan-400 tracking-tight">
                  {connectedCalls.toLocaleString()}
                </p>
                <p className="text-[10px] text-cyan-300/80 font-semibold mt-0.5">
                  {connectRate.toFixed(1)}% Connect Rate
                </p>
              </div>

              {/* Total Leads */}
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] relative">
                <div className="flex items-center justify-between text-slate-400 mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider">Total Leads</span>
                  <Users className="h-4 w-4 text-blue-400" />
                </div>
                <p className="text-2xl font-black text-white tracking-tight">
                  {totalLeads.toLocaleString()}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Pipeline Inflow
                </p>
              </div>

              {/* Qualified Leads */}
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] relative">
                <div className="flex items-center justify-between text-slate-400 mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider">Qualified Leads</span>
                  <TrendingUp className="h-4 w-4 text-purple-400" />
                </div>
                <p className="text-2xl font-black text-purple-400 tracking-tight">
                  {qualifiedLeads.toLocaleString()}
                </p>
                <p className="text-[10px] text-purple-300/80 font-semibold mt-0.5">
                  {conversionRate.toFixed(1)}% Conversion Rate
                </p>
              </div>
            </div>

            {/* 4. Talk Time Pill Bar */}
            <div className="mt-3 p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/20 flex items-center justify-between relative z-10">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-md bg-indigo-500/20 text-indigo-300">
                  <Clock className="h-3.5 w-3.5" />
                </div>
                <span className="text-[11px] font-bold text-indigo-200">
                  Team Talk Time Duration
                </span>
              </div>
              <span className="text-xs font-black text-white bg-indigo-900/60 px-2 py-0.5 rounded-md border border-indigo-500/30">
                {formatDuration(totalDurationSeconds)}
              </span>
            </div>

            {/* 5. Top Callers Ranking / Leaderboard */}
            {topCallers && topCallers.length > 0 && (
              <div className="mt-4 pt-3 border-t border-white/10 relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Flame className="h-3.5 w-3.5 text-orange-400" />
                    Top Callers Ranking
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400">
                    High Outreach
                  </span>
                </div>

                <div className="space-y-1.5">
                  {topCallers.slice(0, 4).map((caller, index) => {
                    const medals = ["🥇", "🥈", "🥉", "4️⃣"]
                    const isWinner = index === 0

                    return (
                      <div
                        key={caller.id || index}
                        className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          isWinner
                            ? "bg-amber-500/10 border border-amber-500/25 text-white"
                            : "bg-white/[0.02] border border-white/[0.05] text-slate-300"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{medals[index] || `#${index + 1}`}</span>
                          <span className={`font-bold ${isWinner ? "text-amber-300" : "text-white"}`}>
                            {caller.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="font-extrabold text-white">
                            {caller.calls} calls
                          </span>
                          <span className="text-slate-400 text-[10px]">
                            {caller.connectRate}% connect
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 6. Footer Branded Stamp */}
            <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between text-[9px] text-slate-500 relative z-10 font-medium">
              <span>BanksCart CRM • Executive Reports</span>
              <span>
                Generated {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        </div>
        <PerformanceTableModal
          isOpen={showTableModal}
          onOpenChange={setShowTableModal}
          rows={heatmapRows}
          dateLabel={dateLabel}
        />
      </DialogContent>
    </Dialog>
  )
}
