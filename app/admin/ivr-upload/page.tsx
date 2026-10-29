"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { 
  Upload, CheckCircle, AlertCircle, Loader2, History, UploadCloud, 
  Wallet, Plus, Minus, Coins, Download, Clock, Zap, Users, Filter, 
  Search, ArrowRight, ExternalLink, HelpCircle, Check, Info, Sparkles, 
  AlertTriangle, PhoneCall, RefreshCw, FileText
} from "lucide-react"
import { toast } from "sonner"
import Papa from "papaparse"
import { createClient } from "@/lib/supabase/client"
import { 
  submitIvrUploadRequest, 
  getIvrUploadHistory, 
  getWalletHistory,
  requestCreditRecharge 
} from "@/app/actions/ivr-upload-action"

export default function IvrUploadPage() {
  const [tenantId, setTenantId] = useState<string>("")
  const [userRole, setUserRole] = useState<string>("")
  const [dids, setDids] = useState<any[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [walletHistory, setWalletHistory] = useState<any[]>([])
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Navigation tab: 'upload' | 'history' | 'wallet'
  const [activeTab, setActiveTab] = useState<'upload' | 'history' | 'wallet'>('upload')

  // Form State
  const [campaignName, setCampaignName] = useState("")
  const [selectedDidId, setSelectedDidId] = useState("")
  const [preferredSchedule, setPreferredSchedule] = useState("Immediate (ASAP)")
  const [velocity, setVelocity] = useState("Standard Velocity")
  const [inputMethod, setInputMethod] = useState<"csv" | "paste">("csv")
  const [rawText, setRawText] = useState("")
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [notes, setNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [nowTime, setNowTime] = useState(Date.now())

  // Parsing & Quality Inspection State
  const [validPhones, setValidPhones] = useState<string[]>([])
  const [parseStats, setParseStats] = useState<{
    totalScanned: number;
    validCount: number;
    duplicatesCount: number;
    invalidCount: number;
    sampleNumbers: string[];
  } | null>(null)

  // History Filter State
  const [historySearch, setHistorySearch] = useState("")
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>("All")
  const [selectedCampaignDetail, setSelectedCampaignDetail] = useState<any | null>(null)

  // Recharge Modal State
  const [isRechargeOpen, setIsRechargeOpen] = useState(false)
  const [rechargeAmount, setRechargeAmount] = useState<number>(25000)
  const [rechargeNote, setRechargeNote] = useState("")
  const [isSubmittingRecharge, setIsSubmittingRecharge] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    fetchInitialData()
  }, [])

  // Local clock for dynamic 10-minute countdown (0 network calls)
  useEffect(() => {
    const timer = setInterval(() => setNowTime(Date.now()), 10000)
    return () => clearInterval(timer)
  }, [])

  // Auto-refresh history every 20s if there is an active (pending or running) request
  useEffect(() => {
    if (!tenantId) return
    const hasActive = history.some(h => {
      const eff = getEffectiveStatus(h)
      return eff === 'pending' || eff === 'running'
    })
    if (!hasActive) return

    const interval = setInterval(() => {
      fetchHistory(tenantId)
    }, 20000)

    return () => clearInterval(interval)
  }, [tenantId, history, nowTime])

  // Parse pasted numbers
  useEffect(() => {
    if (inputMethod === 'paste') {
      if (!rawText.trim()) {
        setValidPhones([])
        setParseStats(null)
        return
      }

      const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean)
      const valid: string[] = []
      let duplicates = 0
      let invalid = 0
      const seen = new Set<string>()

      for (const line of lines) {
        const cleaned = line.replace(/\D/g, '').slice(-10)
        if (cleaned.length === 10) {
          if (seen.has(cleaned)) {
            duplicates++
          } else {
            seen.add(cleaned)
            valid.push(cleaned)
          }
        } else {
          invalid++
        }
      }

      setValidPhones(valid)
      setParseStats({
        totalScanned: lines.length,
        validCount: valid.length,
        duplicatesCount: duplicates,
        invalidCount: invalid,
        sampleNumbers: valid.slice(0, 5)
      })
    }
  }, [rawText, inputMethod])

  const fetchInitialData = async () => {
    setLoadingInitial(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase.from('users').select('tenant_id, role').eq('id', user.id).single()
      if (profile) {
        setTenantId(profile.tenant_id)
        setUserRole(profile.role || '')

        const { data: didData } = await supabase.from('tenant_did_registry')
          .select('id, did_number, label')
          .eq('tenant_id', profile.tenant_id)
          .eq('is_active', true)
        setDids(didData || [])

        if (didData && didData.length > 0) {
          setSelectedDidId(didData[0].id)
        }

        await fetchHistory(profile.tenant_id)
        await fetchWallet(profile.tenant_id)
      }
    }
    setLoadingInitial(false)
  }

  const fetchHistory = async (tId: string) => {
    setLoadingHistory(true)
    try {
      const [uploadData, walletData] = await Promise.all([
        getIvrUploadHistory(tId),
        getWalletHistory(tId)
      ])
      setHistory(uploadData)
      setWalletHistory(walletData)
    } catch (e: any) {
      console.error("Failed to load history:", e)
    }
    setLoadingHistory(false)
  }

  const fetchWallet = async (tId: string) => {
    const { data } = await supabase.from('tenant_wallets')
      .select('credits_balance')
      .eq('tenant_id', tId)
      .maybeSingle()
    setWalletBalance(data?.credits_balance ?? 0)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvFile(file)
    
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (result: any) => {
        const rows = result.data || []
        let totalScanned = 0
        const valid: string[] = []
        let duplicates = 0
        let invalid = 0
        const seen = new Set<string>()

        for (const row of rows) {
          totalScanned++
          let foundPhone = false

          if (Array.isArray(row)) {
            for (const cell of row) {
              const cleaned = String(cell || '').replace(/\D/g, '').slice(-10)
              if (cleaned.length === 10) {
                foundPhone = true
                if (seen.has(cleaned)) {
                  duplicates++
                } else {
                  seen.add(cleaned)
                  valid.push(cleaned)
                }
                break
              }
            }
          } else if (typeof row === 'string') {
            const cleaned = String(row).replace(/\D/g, '').slice(-10)
            if (cleaned.length === 10) {
              foundPhone = true
              if (seen.has(cleaned)) {
                duplicates++
              } else {
                seen.add(cleaned)
                valid.push(cleaned)
              }
            }
          }

          if (!foundPhone) {
            invalid++
          }
        }

        setValidPhones(valid)
        setParseStats({
          totalScanned,
          validCount: valid.length,
          duplicatesCount: duplicates,
          invalidCount: invalid,
          sampleNumbers: valid.slice(0, 5)
        })
      }
    })
  }

  const downloadSampleCsv = () => {
    const csvContent = "phone_number\n9876543210\n9123456789\n9988776655\n8877665544\n7766554433";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "sample_ivr_contacts.csv";
    link.click();
  };

  const handleSubmit = async () => {
    if (!campaignName.trim()) return toast.error("Campaign Name is required")
    if (!selectedDidId) return toast.error("Please select a DID")
    if (validPhones.length === 0) return toast.error("No valid 10-digit phone numbers found")
    
    if (validPhones.length < 5000) {
      toast.error(`Minimum 5,000 numbers required (You currently have ${validPhones.length.toLocaleString()})`)
      return
    }

    setIsSubmitting(true)
    try {
      const did = dids.find(d => d.id === selectedDidId)
      const res = await submitIvrUploadRequest({
        campaignName,
        didNumber: did?.did_number || '',
        didLabel: did?.label || '',
        phoneNumbers: validPhones,
        notes,
        preferredSchedule,
        velocity
      })
      if (res.success) {
        toast.success("IVR Upload Request submitted successfully! Ops team notified.")
        setCampaignName("")
        setRawText("")
        setCsvFile(null)
        setValidPhones([])
        setParseStats(null)
        setNotes("")
        fetchHistory(tenantId)
        setActiveTab('history')
      } else {
        toast.error(res.error || "Failed to submit request")
      }
    } catch (e: any) {
      toast.error(e.message)
    }
    setIsSubmitting(false)
  }

  const handleRechargeSubmit = async () => {
    if (!rechargeAmount || rechargeAmount <= 0) {
      toast.error("Please select a valid credit amount")
      return
    }

    setIsSubmittingRecharge(true)
    try {
      const res = await requestCreditRecharge({
        credits: rechargeAmount,
        note: rechargeNote
      })

      if (res.success) {
        toast.success(`Recharge request for ${rechargeAmount.toLocaleString()} credits submitted! Our team will process it shortly.`)
        setIsRechargeOpen(false)
        setRechargeNote("")
      } else {
        toast.error(res.error || "Failed to submit recharge request")
      }
    } catch (e: any) {
      toast.error(e.message)
    }
    setIsSubmittingRecharge(false)
  }

  const getEffectiveStatus = (item: any) => {
    if (!item) return 'pending'
    if (item.status === 'completed' || item.status === 'failed') {
      return item.status
    }
    if (item.status === 'running') {
      const meta = item.meta
      if (meta?.last_lead_at) {
        const elapsed = nowTime - new Date(meta.last_lead_at).getTime()
        if (elapsed >= 10 * 60 * 1000) {
          return 'completed'
        }
      }
      return 'running'
    }
    return item.status || 'pending'
  }

  // Summary Metrics calculations
  const totalUploadedLifetime = useMemo(() => {
    return history.reduce((sum, h) => sum + (h.total_contacts || 0), 0)
  }, [history])

  const totalLeadsFetched = useMemo(() => {
    return history.reduce((sum, h) => sum + (h.meta?.leads_count || 0), 0)
  }, [history])

  const activeCampaignsCount = useMemo(() => {
    return history.filter(h => {
      const st = getEffectiveStatus(h)
      return st === 'pending' || st === 'running'
    }).length
  }, [history, nowTime])

  // Filtered History
  const filteredHistory = useMemo(() => {
    return history.filter(h => {
      const eff = getEffectiveStatus(h)
      if (historyStatusFilter !== "All" && eff.toLowerCase() !== historyStatusFilter.toLowerCase()) {
        return false
      }
      if (historySearch.trim()) {
        const term = historySearch.toLowerCase()
        const matchesName = (h.campaign_name || '').toLowerCase().includes(term)
        const matchesDid = (h.did_number || '').includes(term)
        return matchesName || matchesDid
      }
      return true
    })
  }, [history, historyStatusFilter, historySearch, nowTime])

  const statusColor: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800 border-amber-200',
    running: 'bg-blue-100 text-blue-800 border-blue-200',
    completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    failed: 'bg-rose-100 text-rose-800 border-rose-200',
  }

  if (loadingInitial) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-600 mx-auto" />
          <p className="text-sm font-semibold text-slate-600">Loading IVR Hub...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-8 space-y-8 bg-slate-50/50 min-h-screen">
      
      {/* Header & KPI Summary Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-tr from-indigo-600 to-purple-600 text-white rounded-2xl shadow-md shadow-indigo-600/20">
              <UploadCloud className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                IVR Campaign Hub
                {activeCampaignsCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                    <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                    {activeCampaignsCount} Active
                  </span>
                )}
              </h1>
              <p className="text-slate-500 text-xs sm:text-sm mt-0.5">
                Bulk contact ingestion, blast pacer automation, and real-time lead conversion analytics.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchHistory(tenantId)}
            disabled={loadingHistory}
            className="bg-white border-slate-200 rounded-xl text-xs font-bold text-slate-700 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingHistory ? 'animate-spin text-indigo-600' : 'text-slate-500'}`} />
            Refresh
          </Button>

          <Button
            onClick={() => setIsRechargeOpen(true)}
            size="sm"
            className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-500/20"
          >
            <Coins className="w-3.5 h-3.5 mr-1.5" />
            Top-up Credits
          </Button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Credits Balance */}
        <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">IVR Credits</span>
            <Coins className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
            {walletBalance !== null ? walletBalance.toLocaleString() : '---'}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-1.5 h-1.5 rounded-full ${(walletBalance ?? 0) < 5000 ? 'bg-rose-500' : 'bg-emerald-500'}`} />
            <p className={`text-[11px] font-semibold ${(walletBalance ?? 0) < 5000 ? 'text-rose-600' : 'text-slate-500'}`}>
              {(walletBalance ?? 0) < 5000 ? 'Low Balance • Top-up needed' : 'Healthy Balance'}
            </p>
          </div>
        </div>

        {/* Lifetime Uploads */}
        <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Lifetime Uploads</span>
            <Users className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-indigo-900 font-mono">
            {totalUploadedLifetime.toLocaleString()}
          </div>
          <p className="text-[11px] text-indigo-500/80 mt-1">Total contacts queued</p>
        </div>

        {/* Total Converted Leads */}
        <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Converted Leads</span>
            <PhoneCall className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-900 font-mono">
            {totalLeadsFetched.toLocaleString()}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <p className="text-[11px] text-emerald-600/80 font-medium">Interested caller leads</p>
            <span className="text-slate-300">•</span>
            <p className="text-[11px] text-amber-600 font-bold flex items-center gap-1">
              <Coins className="w-3 h-3 text-amber-500" />
              {(Number((totalLeadsFetched * 1.3).toFixed(1))).toLocaleString()} Credits (@ 1.3/call)
            </p>
          </div>
        </div>

        {/* Active Campaigns */}
        <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Active Tasks</span>
            <Clock className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-purple-900 font-mono">
            {activeCampaignsCount}
          </div>
          <p className="text-[11px] text-purple-600/80 mt-1">Pending or Running</p>
        </div>
      </div>

      {/* Modern Navigation Tabs */}
      <div className="flex overflow-x-auto p-1.5 bg-slate-200/60 rounded-2xl max-w-fit gap-1 shadow-inner scrollbar-none">
        <button
          onClick={() => setActiveTab('upload')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all whitespace-nowrap ${
            activeTab === 'upload'
              ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
          }`}
        >
          <UploadCloud className="w-4 h-4" />
          New Campaign Upload
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all whitespace-nowrap ${
            activeTab === 'history'
              ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
          }`}
        >
          <History className="w-4 h-4" />
          Campaign History & Live Tracker
          {activeCampaignsCount > 0 && (
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('wallet')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all whitespace-nowrap ${
            activeTab === 'wallet'
              ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
          }`}
        >
          <Coins className="w-4 h-4" />
          Wallet Ledger
        </button>
      </div>

      {/* --- TAB 1: NEW CAMPAIGN UPLOAD --- */}
      {activeTab === 'upload' && (
        <div className="space-y-6">
          {dids.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-2xl flex items-center gap-3 shadow-sm">
              <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
              <div>
                <p className="font-bold text-sm">No Active DID Assigned</p>
                <p className="text-xs text-amber-700 mt-0.5">Please contact Hanva admin to allocate a virtual calling number for your tenant.</p>
              </div>
            </div>
          )}

          <Card className="shadow-sm border border-slate-200 rounded-3xl bg-white overflow-hidden">
            <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
            <CardContent className="p-6 sm:p-8 space-y-6">

              {/* Campaign & DID Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    Campaign Name <span className="text-rose-500">*</span>
                  </Label>
                  <Input 
                    placeholder="e.g. ICICI Loan Blast October 2026" 
                    value={campaignName} 
                    onChange={e => setCampaignName(e.target.value)} 
                    className="bg-slate-50 border-slate-200 focus:bg-white focus:border-indigo-500 rounded-xl h-11 text-sm font-semibold" 
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    Caller DID Number <span className="text-rose-500">*</span>
                  </Label>
                  <Select value={selectedDidId} onValueChange={setSelectedDidId}>
                    <SelectTrigger className="bg-slate-50 border-slate-200 focus:bg-white focus:border-indigo-500 rounded-xl h-11 text-sm font-semibold">
                      <SelectValue placeholder="Choose DID Number..." />
                    </SelectTrigger>
                    <SelectContent>
                      {dids.map(d => (
                        <SelectItem key={d.id} value={d.id}>
                          <span className="font-mono font-bold">{d.did_number}</span> {d.label ? `• ${d.label}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Automation Preferences: Preferred Launch Window & Velocity */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-4 bg-slate-50/70 border border-slate-200 rounded-2xl">
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-600" /> Preferred Launch Window
                  </Label>
                  <Select value={preferredSchedule} onValueChange={setPreferredSchedule}>
                    <SelectTrigger className="bg-white border-slate-200 rounded-xl h-10 text-xs font-semibold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Immediate (ASAP)">⚡ Immediate (ASAP)</SelectItem>
                      <SelectItem value="Morning Peak (10:00 AM - 1:00 PM)">🌅 Morning Peak (10:00 AM - 1:00 PM)</SelectItem>
                      <SelectItem value="Afternoon Blast (2:00 PM - 5:00 PM)">☀️ Afternoon Blast (2:00 PM - 5:00 PM)</SelectItem>
                      <SelectItem value="Evening Drive (5:00 PM - 8:00 PM)">🌆 Evening Drive (5:00 PM - 8:00 PM)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-500" /> Blast Velocity
                  </Label>
                  <Select value={velocity} onValueChange={setVelocity}>
                    <SelectTrigger className="bg-white border-slate-200 rounded-xl h-10 text-xs font-semibold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Standard Velocity">🟢 Standard Pacing (Even telecaller distribution)</SelectItem>
                      <SelectItem value="High Concurrency">🚀 High Concurrency (Fastest broadcast)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Input Method Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    Contact List Source
                  </Label>
                  <button 
                    type="button" 
                    onClick={downloadSampleCsv} 
                    className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" /> Sample CSV Template
                  </button>
                </div>

                <div className="flex gap-2">
                  <Button 
                    type="button" 
                    variant={inputMethod === 'csv' ? 'default' : 'outline'} 
                    className={`rounded-xl text-xs font-bold h-9 ${inputMethod === 'csv' ? 'bg-indigo-600 text-white' : 'text-slate-700'}`} 
                    onClick={() => { setInputMethod('csv'); setValidPhones([]); setParseStats(null); }}
                  >
                    Upload CSV File
                  </Button>
                  <Button 
                    type="button" 
                    variant={inputMethod === 'paste' ? 'default' : 'outline'} 
                    className={`rounded-xl text-xs font-bold h-9 ${inputMethod === 'paste' ? 'bg-indigo-600 text-white' : 'text-slate-700'}`} 
                    onClick={() => { setInputMethod('paste'); setValidPhones([]); setParseStats(null); }}
                  >
                    Paste Raw Numbers
                  </Button>
                </div>

                {inputMethod === 'csv' && (
                  <label className="border-2 border-dashed border-slate-300 hover:border-indigo-400 rounded-2xl p-6 text-center bg-slate-50/50 hover:bg-indigo-50/20 transition-colors flex flex-col items-center justify-center cursor-pointer">
                    <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-sm mb-3">
                      <UploadCloud className="w-6 h-6 text-indigo-600" />
                    </div>
                    <p className="text-sm font-bold text-slate-800">
                      {csvFile ? csvFile.name : "Click to select or drag CSV file here"}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {csvFile ? `${(csvFile.size / 1024).toFixed(1)} KB • Ready to parse` : "Any CSV containing 10-digit mobile numbers in any column"}
                    </p>
                    <input 
                      type="file" 
                      accept=".csv" 
                      onChange={handleFileUpload} 
                      className="hidden" 
                    />
                  </label>
                )}

                {inputMethod === 'paste' && (
                  <Textarea
                    placeholder="Paste mobile numbers here, one per line (e.g. 9876543210)..."
                    className="min-h-[160px] bg-slate-50 rounded-2xl border-slate-200 font-mono text-xs focus:bg-white"
                    value={rawText}
                    onChange={e => setRawText(e.target.value)}
                  />
                )}
              </div>

              {/* Data Quality & Parse Statistics Inspector */}
              {parseStats && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600" /> Contact Quality Inspector
                    </span>
                    <span className="font-mono text-slate-500">
                      Total Scanned: {parseStats.totalScanned.toLocaleString()}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <div className="text-xs text-emerald-700 font-bold">Valid Unique</div>
                      <div className="text-lg font-black text-emerald-900 font-mono mt-0.5">
                        {parseStats.validCount.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                      <div className="text-xs text-amber-700 font-bold">Duplicates Pruned</div>
                      <div className="text-lg font-black text-amber-900 font-mono mt-0.5">
                        {parseStats.duplicatesCount.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-xl">
                      <div className="text-xs text-slate-600 font-bold">Invalid/Malformed</div>
                      <div className="text-lg font-black text-slate-700 font-mono mt-0.5">
                        {parseStats.invalidCount.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {parseStats.sampleNumbers.length > 0 && (
                    <div className="text-[11px] text-slate-500 pt-1">
                      <span className="font-semibold text-slate-700">Sample Parsed:</span>{' '}
                      <span className="font-mono">{parseStats.sampleNumbers.join(', ')}...</span>
                    </div>
                  )}

                  {/* 5,000 Minimum Threshold Meter */}
                  <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-slate-700 flex items-center gap-1">
                        {parseStats.validCount >= 5000 ? (
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        )}
                        Minimum 5,000 Threshold:
                      </span>
                      <span className={parseStats.validCount >= 5000 ? 'text-emerald-700' : 'text-amber-700'}>
                        {parseStats.validCount.toLocaleString()} / 5,000 numbers ({Math.min(100, Math.round(parseStats.validCount / 5000 * 100))}%)
                      </span>
                    </div>

                    <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-300 ${parseStats.validCount >= 5000 ? 'bg-emerald-600' : 'bg-amber-500'}`}
                        style={{ width: `${Math.min(100, (parseStats.validCount / 5000) * 100)}%` }}
                      />
                    </div>

                    {parseStats.validCount < 5000 ? (
                      <p className="text-[11px] text-amber-700 font-semibold">
                        ⚠️ Please add at least {(5000 - parseStats.validCount).toLocaleString()} more valid 10-digit numbers to broadcast.
                      </p>
                    ) : (
                      <p className="text-[11px] text-emerald-700 font-semibold">
                        ✓ Ready to broadcast. Will be cleanly chunked into {Math.ceil(parseStats.validCount / 5000)} Excel file(s) for the dialer.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Instructions / Notes */}
              <div className="space-y-2">
                <Label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Optional Notes / Special Instructions
                </Label>
                <Textarea 
                  placeholder="e.g. Please prioritize leads between 10am to 1pm, transfer IVR key 1 to sales..." 
                  value={notes} 
                  onChange={e => setNotes(e.target.value)} 
                  className="bg-slate-50 border-slate-200 rounded-2xl text-xs" 
                />
              </div>

              {/* Submit Action */}
              <Button 
                onClick={handleSubmit} 
                disabled={isSubmitting || dids.length === 0 || validPhones.length < 5000} 
                className="w-full bg-slate-900 hover:bg-slate-800 text-white h-13 py-3.5 rounded-2xl font-bold shadow-lg shadow-slate-900/10 active:scale-98 transition-all disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating Excel Chunks & Notifying Ops...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Submit IVR Upload Request ({validPhones.length > 0 ? `${validPhones.length.toLocaleString()} Contacts` : 'Requires 5k+'})
                  </>
                )}
              </Button>

            </CardContent>
          </Card>
        </div>
      )}

      {/* --- TAB 2: CAMPAIGN HISTORY & TRACKER --- */}
      {activeTab === 'history' && (
        <Card className="shadow-sm border border-slate-200 rounded-3xl bg-white overflow-hidden space-y-4">
          <CardHeader className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg text-slate-800 font-extrabold flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-600" /> 
                Recent Upload Requests
                {loadingHistory && <Loader2 className="w-4 h-4 animate-spin ml-2 text-slate-400" />}
              </CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">Real-time status, 10-minute idle tracker, and converted leads count.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search campaign or DID..."
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:border-indigo-500"
                />
              </div>

              <div className="flex p-0.5 bg-slate-100 rounded-xl">
                {['All', 'Running', 'Pending', 'Completed'].map(st => (
                  <button
                    key={st}
                    onClick={() => setHistoryStatusFilter(st)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      historyStatusFilter === st
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50 text-slate-600">
                  <TableRow>
                    <TableHead className="font-bold text-xs uppercase tracking-wide">Date</TableHead>
                    <TableHead className="font-bold text-xs uppercase tracking-wide">Campaign Name</TableHead>
                    <TableHead className="font-bold text-xs uppercase tracking-wide">DID Number</TableHead>
                    <TableHead className="text-center font-bold text-xs uppercase tracking-wide">Uploaded</TableHead>
                    <TableHead className="text-center font-bold text-xs uppercase tracking-wide">Fetched Leads</TableHead>
                    <TableHead className="text-center font-bold text-xs uppercase tracking-wide">Consumed Credits</TableHead>
                    <TableHead className="font-bold text-xs uppercase tracking-wide">Status</TableHead>
                    <TableHead className="text-right font-bold text-xs uppercase tracking-wide">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-100">
                  {filteredHistory.map(h => {
                    const effStatus = getEffectiveStatus(h)
                    const leadsCount = h.meta?.leads_count || 0
                    const consumedCredits = Number((leadsCount * 1.3).toFixed(1))
                    const minsLeft = h.meta?.last_lead_at 
                      ? Math.max(0, 10 - Math.floor((nowTime - new Date(h.meta.last_lead_at).getTime()) / 60000))
                      : 10

                    return (
                      <TableRow key={h.id} className="hover:bg-slate-50/70 transition-colors">
                        <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                          {new Date(h.created_at).toLocaleDateString('en-IN', { 
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                          })}
                        </TableCell>
                        <TableCell>
                          <div className="font-bold text-sm text-slate-900">{h.campaign_name}</div>
                          {h.meta?.user_note && (
                            <div className="text-[11px] text-slate-500 truncate max-w-xs" title={h.meta.user_note}>
                              {h.meta.user_note}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono font-bold text-slate-700">
                          {h.did_number}
                        </TableCell>
                        <TableCell className="text-center text-xs font-mono text-slate-800 font-bold">
                          {h.total_contacts?.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center">
                          {leadsCount > 0 ? (
                            <Link 
                              href="/telecaller/leads?search=IVR"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-mono bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm hover:bg-emerald-100 transition-colors"
                              title="Click to view imported leads"
                            >
                              <span className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${effStatus === 'running' ? 'animate-pulse' : ''}`} />
                              {leadsCount.toLocaleString()} {leadsCount === 1 ? 'lead' : 'leads'}
                            </Link>
                          ) : (
                            <span className="text-xs font-mono text-slate-400">0 leads</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <span 
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-mono bg-amber-50 text-amber-800 border border-amber-200/80 shadow-sm"
                            title={`${leadsCount} connected calls × 1.3 = ${consumedCredits} credits`}
                          >
                            <Coins className="w-3.5 h-3.5 text-amber-500" />
                            {consumedCredits.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] uppercase font-bold px-2 py-0.5 border inline-flex items-center gap-1.5 ${statusColor[effStatus] || 'bg-slate-100 text-slate-700'}`}>
                            {effStatus === 'running' && (
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
                              </span>
                            )}
                            {effStatus === 'running' ? `RUNNING (${minsLeft}m)` : effStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href="/admin/ivr-reports"
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors"
                          >
                            Reports <ExternalLink className="w-3 h-3" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {!loadingHistory && filteredHistory.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-sm text-slate-500">
                        No IVR upload requests found matching your filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- TAB 3: WALLET LEDGER --- */}
      {activeTab === 'wallet' && (
        <Card className="shadow-sm border border-slate-200 rounded-3xl bg-white overflow-hidden space-y-4">
          <CardHeader className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg text-slate-800 font-extrabold flex items-center gap-2">
                <Coins className="w-5 h-5 text-amber-500" /> Wallet Ledger & Credit Usage
                {loadingHistory && <Loader2 className="w-4 h-4 animate-spin ml-2 text-slate-400" />}
              </CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">Audit log of all IVR campaign deductions and credit recharges.</p>
            </div>

            <Button
              onClick={() => setIsRechargeOpen(true)}
              size="sm"
              className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-500/20"
            >
              <Coins className="w-3.5 h-3.5 mr-1.5" />
              Request Top-up
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50 text-slate-600">
                  <TableRow>
                    <TableHead className="font-bold text-xs uppercase tracking-wide">Date</TableHead>
                    <TableHead className="font-bold text-xs uppercase tracking-wide">Description</TableHead>
                    <TableHead className="text-center font-bold text-xs uppercase tracking-wide">Type</TableHead>
                    <TableHead className="text-right font-bold text-xs uppercase tracking-wide">Credits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-100 font-medium">
                  {walletHistory.map(h => (
                    <TableRow key={h.id} className="hover:bg-slate-50/70 transition-colors">
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                        {new Date(h.created_at).toLocaleDateString('en-IN', { 
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                        })}
                      </TableCell>
                      <TableCell className="text-xs text-slate-800 max-w-sm truncate" title={h.description || ''}>
                        {h.description || '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={`text-[10px] uppercase font-bold px-2 py-0.5 border ${
                          h.transaction_type === 'RECHARGE' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                          h.transaction_type === 'DEDUCTION' || h.transaction_type === 'C2C_CALL' ? 'bg-rose-100 text-rose-800 border-rose-200' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {h.transaction_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono font-bold">
                        <span className={h.credits > 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {h.credits > 0 ? '+' : ''}{h.credits?.toLocaleString()}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loadingHistory && walletHistory.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-12 text-sm text-slate-500">
                        No transactions found in wallet ledger.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Credit Top-up / Recharge Request Modal */}
      <Dialog open={isRechargeOpen} onOpenChange={setIsRechargeOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6 bg-white border border-slate-100 shadow-2xl">
          <DialogHeader className="space-y-2">
            <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mb-1">
              <Coins className="w-6 h-6" />
            </div>
            <DialogTitle className="text-xl font-extrabold text-slate-900">Request IVR Credit Top-up</DialogTitle>
            <p className="text-xs text-slate-500">
              Select desired credit tier. Operations team will process the recharge and send invoice confirmation.
            </p>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-bold text-slate-600 mb-2 block uppercase tracking-wide">
                Select Credit Package
              </Label>
              <div className="grid grid-cols-2 gap-2.5">
                {[10000, 25000, 50000, 100000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setRechargeAmount(amt)}
                    className={`p-3 rounded-2xl border text-left transition-all ${
                      rechargeAmount === amt
                        ? 'border-amber-500 bg-amber-50/50 text-amber-900 ring-2 ring-amber-500/20'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="font-black text-sm font-mono">{amt.toLocaleString()}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Credits Pack</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold text-slate-600 mb-1.5 block uppercase tracking-wide">
                Custom Amount (Credits)
              </Label>
              <Input
                type="number"
                min={1000}
                step={1000}
                value={rechargeAmount}
                onChange={e => setRechargeAmount(Number(e.target.value))}
                className="bg-slate-50 border-slate-200 rounded-xl font-mono text-sm font-bold"
              />
            </div>

            <div>
              <Label className="text-xs font-bold text-slate-600 mb-1.5 block uppercase tracking-wide">
                Optional Billing Note
              </Label>
              <Textarea
                placeholder="e.g. Urgent top-up for upcoming weekend blast..."
                value={rechargeNote}
                onChange={e => setRechargeNote(e.target.value)}
                className="bg-slate-50 border-slate-200 rounded-xl text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsRechargeOpen(false)}
              className="rounded-xl text-xs font-bold border-slate-200"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleRechargeSubmit}
              disabled={isSubmittingRecharge || rechargeAmount <= 0}
              className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-500/20"
            >
              {isSubmittingRecharge ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Coins className="w-4 h-4 mr-1.5" />}
              Submit Request ({rechargeAmount.toLocaleString()} credits)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
