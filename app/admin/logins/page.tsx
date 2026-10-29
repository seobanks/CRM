"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { 
  Card, CardContent, CardHeader, CardTitle, CardDescription 
} from "@/components/ui/card"
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table"
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from "@/components/ui/dialog"
import { 
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter 
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { 
  Loader2, FileCheck, Download, Search, Trophy, Medal,
  ArrowRightLeft, Edit, Plus, X, Trash2, 
  Clock, CheckCircle2, XCircle, ChevronLeft, ChevronRight,
  Building2, Wallet, CalendarDays, Fingerprint, RefreshCw,
  Copy, ExternalLink, MessageSquare, Phone, Filter, Check,
  AlertTriangle, Users, TrendingUp, Sparkles, CheckCheck, Share2
} from "lucide-react"
import { LoginsReportModal } from "@/components/admin/logins-report-modal"
import { toast } from "sonner"
import { 
  format, startOfMonth, endOfMonth, subMonths, isSameDay, 
  isWithinInterval, subDays, startOfWeek, endOfWeek 
} from "date-fns" 
import { EmptyState } from "@/components/empty-state" 
import Link from "next/link"
import { 
  createLoginAction, 
  updateLoginAction, 
  updateLoginStatusAction, 
  deleteLoginAction, 
  checkLoginDuplicateAction 
} from "./actions"

// --- TYPES ---
type BankAttempt = {
  bank: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Disbursed';
  reason?: string;
  date: string;
}

interface TeamUser {
  id: string;
  full_name: string;
  email?: string;
  role?: string;
}

// --- CONFIGURATION ---
const POPULAR_LENDERS = [
  "ICICI Bank",
  "IDFC First",
  "InCred",
  "HDFC Bank",
  "Finnable",
  "Axis Bank",
  "Piramal",
  "Fibe",
  "Kotak Mahindra",
  "IndusInd Bank",
  "Bajaj Finserv",
  "Tata Capital"
]

const TARGET_BANKS = ["icici", "hdfc", "axis", "kotak", "sbi", "indusind", "idfc"];
const TARGET_NBFCS = ["incred", "finnable", "fibe", "paysense", "kreditbee", "bajaj", "tata", "piramal", "poonawala", "poonawalla", "l&t", "l and t"];

export default function AdminLoginsPage() {
    const supabase = createClient()
    const [loading, setLoading] = useState(true)
    const [logins, setLogins] = useState<any[]>([])
    const [transfers, setTransfers] = useState<any[]>([])
    const [attendanceData, setAttendanceData] = useState<any[]>([])
    const [teamUsers, setTeamUsers] = useState<TeamUser[]>([])
    const [currentUser, setCurrentUser] = useState<any>(null)
    const [tenantId, setTenantId] = useState<string | null>(null)
    
    // Filters & Pagination
    const [dateFilter, setDateFilter] = useState("this_month") 
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedBank, setSelectedBank] = useState("all")
    const [statusFilter, setStatusFilter] = useState("all")
    const [telecallerFilter, setTelecallerFilter] = useState("all")
    const [currentPage, setCurrentPage] = useState(1)
    const itemsPerPage = 12

    // Modals & Sheets
    const [editingLogin, setEditingLogin] = useState<any>(null)
    const [isNewLoginOpen, setIsNewLoginOpen] = useState(false)
    const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null)
    const [isUpdatingStatusId, setIsUpdatingStatusId] = useState<string | null>(null)

    // 1. DATA FETCHING (TENANT SCOPED)
    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            let userProfile = currentUser
            if (!userProfile && user) {
                const { data: prof } = await supabase.from('users').select('id, full_name, role, tenant_id').eq('id', user.id).single()
                userProfile = prof
                setCurrentUser(prof)
                setTenantId(prof?.tenant_id || null)
            }

            const activeTenantId = userProfile?.tenant_id

            // Fetch team members
            let uQuery = supabase.from('users').select('id, full_name, email, role').eq('is_active', true).order('full_name')
            if (activeTenantId && userProfile?.role !== 'super_admin') {
                uQuery = uQuery.eq('tenant_id', activeTenantId)
            }
            const { data: usersData } = await uQuery
            if (usersData) setTeamUsers(usersData as TeamUser[])

            // To support switching between This Month and Last Month seamlessly in Reports,
            // we fetch data starting from 2 months ago up to end of this month.
            const queryStartDate = startOfMonth(subMonths(new Date(), 2))
            const queryEndDate = endOfMonth(new Date())

            // Fetch Logins
            let loginsQuery = supabase
                .from('logins') 
                .select(`
                    id, name, phone, bank_name, created_at, updated_at, notes, status, bank_attempts,
                    assigned_to, tenant_id,
                    users:assigned_to ( full_name, email )
                `)
                .gte('created_at', queryStartDate.toISOString())
                .lte('created_at', queryEndDate.toISOString())
                .order('created_at', { ascending: false })

            if (activeTenantId && userProfile?.role !== 'super_admin') {
                loginsQuery = loginsQuery.eq('tenant_id', activeTenantId)
            }

            // Fetch Transfers (Leads with status 'Transferred to KYC' today)
            const todayStart = new Date(new Date().setHours(0,0,0,0)).toISOString()
            let transfersQuery = supabase
                .from('leads')
                .select(`id, name, phone, updated_at, assigned_to, users:assigned_to ( full_name )`)
                .eq('status', 'Transferred to KYC')
                .gte('updated_at', todayStart) 
                .order('updated_at', { ascending: false })

            if (activeTenantId && userProfile?.role !== 'super_admin') {
                transfersQuery = transfersQuery.eq('tenant_id', activeTenantId)
            }

            // Fetch Attendance Data for the target period
            let attendanceQuery = supabase
                .from('attendance')
                .select('user_id, date, users:user_id ( full_name )')
                .gte('date', queryStartDate.toISOString().split('T')[0])
                .lte('date', queryEndDate.toISOString().split('T')[0])
                .not('check_in', 'is', null)

            if (activeTenantId && userProfile?.role !== 'super_admin') {
                attendanceQuery = attendanceQuery.eq('tenant_id', activeTenantId)
            }

            const [loginsRes, transfersRes, attendanceRes] = await Promise.all([loginsQuery, transfersQuery, attendanceQuery])
            
            if (loginsRes.data) setLogins(loginsRes.data)
            if (transfersRes.data) setTransfers(transfersRes.data)
            if (attendanceRes.data) setAttendanceData(attendanceRes.data)

        } catch (e: any) {
            console.error("Error fetching logins:", e)
            toast.error("Failed to load logins data: " + e.message)
        } finally {
            setLoading(false)
        }
    }, [supabase, currentUser])

    useEffect(() => { 
        fetchData() 
    }, [fetchData])

    // 2. FILTERING LOGIC
    const filteredLogins = useMemo(() => {
        const today = new Date()
        const yesterday = subDays(today, 1)
        const weekStart = startOfWeek(today, { weekStartsOn: 1 })
        const weekEnd = endOfWeek(today, { weekStartsOn: 1 })
        const monthStart = startOfMonth(today)
        const monthEnd = endOfMonth(today)
        const lastMonth = subMonths(today, 1)
        const lastMonthStart = startOfMonth(lastMonth)
        const lastMonthEnd = endOfMonth(lastMonth)

        return logins.filter(l => {
            const createdAt = new Date(l.created_at)

            // Date filtering
            if (dateFilter === 'today') {
                if (!isSameDay(createdAt, today)) return false
            } else if (dateFilter === 'yesterday') {
                if (!isSameDay(createdAt, yesterday)) return false
            } else if (dateFilter === 'this_week') {
                if (!isWithinInterval(createdAt, { start: weekStart, end: weekEnd })) return false
            } else if (dateFilter === 'this_month') {
                if (!isWithinInterval(createdAt, { start: monthStart, end: monthEnd })) return false
            } else if (dateFilter === 'last_month') {
                if (!isWithinInterval(createdAt, { start: lastMonthStart, end: lastMonthEnd })) return false
            }

            // Search query filter (customer name, phone, telecaller, bank)
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim()
                const matchesSearch = 
                    (l.name && l.name.toLowerCase().includes(q)) || 
                    (l.phone && l.phone.includes(q)) ||
                    (l.users?.full_name && l.users.full_name.toLowerCase().includes(q)) ||
                    (l.bank_name && l.bank_name.toLowerCase().includes(q))
                if (!matchesSearch) return false
            }
            
            // Bank filter
            if (selectedBank !== 'all') {
                const bankQ = selectedBank.toLowerCase()
                const matchesBank = 
                    (Array.isArray(l.bank_attempts) && l.bank_attempts.some((a: any) => a.bank?.toLowerCase().includes(bankQ))) ||
                    (l.bank_name && l.bank_name.toLowerCase().includes(bankQ))
                if (!matchesBank) return false
            }
            
            // Status filter
            if (statusFilter !== 'all') {
                const s = l.status?.toLowerCase()
                const targetS = statusFilter.toLowerCase()
                const matchesStatus = s === targetS || (targetS === 'approved' && s === 'disbursed')
                if (!matchesStatus) return false
            }

            // Telecaller filter
            if (telecallerFilter !== 'all') {
                if (telecallerFilter === 'unassigned') {
                    if (l.assigned_to) return false
                } else {
                    if (l.assigned_to !== telecallerFilter) return false
                }
            }

            return true
        })
    }, [logins, searchQuery, selectedBank, statusFilter, telecallerFilter, dateFilter])

    // KPI Summary for filtered view
    const kpiSummary = useMemo(() => {
        const total = filteredLogins.length
        let approved = 0
        let inProcess = 0
        let rejected = 0

        filteredLogins.forEach(l => {
            const s = (l.status || '').toLowerCase()
            if (s === 'approved' || s === 'disbursed') approved++
            else if (s === 'rejected') rejected++
            else inProcess++
        })

        const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0
        const rejectionRate = total > 0 ? Math.round((rejected / total) * 100) : 0

        return { total, approved, inProcess, rejected, approvalRate, rejectionRate }
    }, [filteredLogins])

    // Pagination
    const paginatedLogins = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage
        return filteredLogins.slice(start, start + itemsPerPage)
    }, [filteredLogins, currentPage, itemsPerPage])

    const totalPages = Math.ceil(filteredLogins.length / itemsPerPage)

    // Handlers
    const handleQuickStatusChange = async (loginId: string, newStatus: string) => {
        setIsUpdatingStatusId(loginId)
        // Optimistic update
        setLogins(prev => prev.map(l => l.id === loginId ? { ...l, status: newStatus } : l))

        const res = await updateLoginStatusAction(loginId, newStatus)
        if (res.success) {
            toast.success(`Status updated to ${newStatus}`)
        } else {
            toast.error("Status update failed: " + res.error)
            fetchData()
        }
        setIsUpdatingStatusId(null)
    }

    const handleDelete = async () => {
        if (!deleteConfirmation) return
        const targetId = deleteConfirmation
        setDeleteConfirmation(null)

        // Optimistic removal
        setLogins(prev => prev.filter(l => l.id !== targetId))
        const res = await deleteLoginAction(targetId)
        if (res.success) {
            toast.success("Login record permanently deleted")
        } else {
            toast.error("Failed to delete record: " + res.error)
            fetchData()
        }
    }

    const handleExport = () => {
        if (filteredLogins.length === 0) return toast.error("No data to export")
        const csvRows = [
            ["Telecaller", "Customer Name", "Phone", "Primary Bank", "Overall Status", "Bank Attempts Details", "Notes", "Created Date"],
            ...filteredLogins.map(l => [
                `"${l.users?.full_name || 'Unassigned'}"`,
                `"${l.name || ''}"`,
                `"${l.phone || ''}"`,
                `"${l.bank_name || ''}"`,
                `"${l.status || ''}"`,
                `"${Array.isArray(l.bank_attempts) ? l.bank_attempts.map((a: any) => `${a.bank}: ${a.status}${a.reason ? ` (${a.reason})` : ''}`).join('; ') : l.bank_name || ''}"`,
                `"${(l.notes || '').replace(/"/g, '""')}"`,
                `"${format(new Date(l.created_at), "yyyy-MM-dd HH:mm:ss")}"`
            ])
        ]
        const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n")
        const encodedUri = encodeURI(csvContent)
        const link = document.createElement("a")
        link.setAttribute("href", encodedUri)
        link.setAttribute("download", `Logins_Export_${format(new Date(), 'yyyy-MM-dd_HHmm')}.csv`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        toast.success(`Exported ${filteredLogins.length} login records`)
    }

    const resetFilters = () => {
        setSearchQuery("")
        setSelectedBank("all")
        setStatusFilter("all")
        setTelecallerFilter("all")
        setDateFilter("this_month")
        setCurrentPage(1)
        toast.info("Filters reset to default")
    }

    const hasActiveFilters = searchQuery !== "" || selectedBank !== "all" || statusFilter !== "all" || telecallerFilter !== "all" || dateFilter !== "this_month"

    return (
        <div className="p-4 md:p-8 space-y-6 bg-slate-50/60 dark:bg-slate-950/60 min-h-screen pb-20 font-sans">
            
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
                <div className="flex items-center gap-3.5">
                    <div className="p-3 bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-xl text-white shadow-md shadow-indigo-500/20">
                        <FileCheck className="h-6 w-6" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2.5">
                            <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                                Login Management
                            </h1>
                            <Badge className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 text-[10px] font-bold">
                                {logins.length} Total Files
                            </Badge>
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
                            Track client applications submitted to banks & NBFCs, manage multi-bank attempts, and monitor agent performance.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2.5 w-full md:w-auto flex-wrap">
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={fetchData} 
                        disabled={loading}
                        className="rounded-xl border-slate-200 dark:border-slate-800 h-9 text-xs font-bold gap-1.5"
                        title="Refresh data"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                        <span>Sync</span>
                    </Button>

                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={handleExport}
                        className="rounded-xl border-slate-200 dark:border-slate-800 h-9 text-xs font-bold gap-1.5 text-slate-700 dark:text-slate-300"
                        title="Download CSV"
                    >
                        <Download className="h-3.5 w-3.5 text-slate-500" />
                        <span>Export CSV</span>
                    </Button>

                    <Button 
                        size="sm" 
                        onClick={() => setIsNewLoginOpen(true)}
                        className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-9 px-4 gap-1.5 shadow-sm"
                    >
                        <Plus className="h-4 w-4" />
                        <span>New Login</span>
                    </Button>
                </div>
            </div>

            {/* Navigation Tabs */}
            <Tabs defaultValue="manage" className="w-full">
                <TabsList className="bg-slate-100/90 dark:bg-slate-900/60 p-1 rounded-xl border border-slate-200/60 dark:border-slate-800/60 max-w-[480px] mb-6">
                    <TabsTrigger value="manage" className="rounded-lg text-xs font-bold py-2 px-4 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400 data-[state=active]:shadow-xs">
                        Manage Logins
                    </TabsTrigger>
                    <TabsTrigger value="daily_reports" className="rounded-lg text-xs font-bold py-2 px-4 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400 data-[state=active]:shadow-xs">
                        Daily Reports
                    </TabsTrigger>
                    <TabsTrigger value="monthly_reports" className="rounded-lg text-xs font-bold py-2 px-4 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400 data-[state=active]:shadow-xs">
                        Monthly Reports
                    </TabsTrigger>
                </TabsList>

                {/* ========================================================== */}
                {/* --- TAB 1: MANAGE LOGINS --- */}
                {/* ========================================================== */}
                <TabsContent value="manage" className="space-y-6">
                    
                    {/* Top KPI Metrics Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                        <Card className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-3xs p-4 space-y-1">
                            <span className="text-[10px] uppercase tracking-wider font-extrabold text-slate-400 dark:text-slate-500">Filtered Logins</span>
                            <div className="flex items-baseline justify-between">
                                <span className="text-2xl font-black text-slate-900 dark:text-white">{kpiSummary.total}</span>
                                <Badge variant="outline" className="text-[9px] font-bold text-slate-500 border-slate-200">{dateFilter.replace(/_/g, ' ')}</Badge>
                            </div>
                            <p className="text-[11px] text-slate-500 font-medium">Matching active criteria</p>
                        </Card>

                        <Card className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-3xs p-4 space-y-1">
                            <span className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-600 dark:text-emerald-400">Approved Files</span>
                            <div className="flex items-baseline justify-between">
                                <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{kpiSummary.approved}</span>
                                <span className="text-xs font-extrabold text-emerald-600">{kpiSummary.approvalRate}% Rate</span>
                            </div>
                            <p className="text-[11px] text-slate-500 font-medium">Bank approval & disbursed</p>
                        </Card>

                        <Card className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-3xs p-4 space-y-1">
                            <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-600 dark:text-amber-400">In Process (Login Done)</span>
                            <div className="flex items-baseline justify-between">
                                <span className="text-2xl font-black text-amber-600 dark:text-amber-400">{kpiSummary.inProcess}</span>
                                <span className="text-xs font-bold text-slate-400">Under Review</span>
                            </div>
                            <p className="text-[11px] text-slate-500 font-medium">Awaiting lender sanction</p>
                        </Card>

                        <Card className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-3xs p-4 space-y-1">
                            <span className="text-[10px] uppercase tracking-wider font-extrabold text-rose-600 dark:text-rose-400">Rejected Files</span>
                            <div className="flex items-baseline justify-between">
                                <span className="text-2xl font-black text-rose-600 dark:text-rose-400">{kpiSummary.rejected}</span>
                                <span className="text-xs font-extrabold text-rose-600">{kpiSummary.rejectionRate}%</span>
                            </div>
                            <p className="text-[11px] text-slate-500 font-medium">Declined by lenders</p>
                        </Card>
                    </div>

                    {/* Filter & Search Toolbar */}
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
                        <div className="flex flex-col lg:flex-row gap-3 justify-between items-stretch lg:items-center">
                            
                            {/* Date Filter Buttons */}
                            <div className="flex flex-wrap items-center gap-1.5">
                                {[
                                    { id: 'today', label: 'Today' },
                                    { id: 'yesterday', label: 'Yesterday' },
                                    { id: 'this_week', label: 'This Week' },
                                    { id: 'this_month', label: 'This Month' },
                                    { id: 'last_month', label: 'Last Month' },
                                    { id: 'all', label: 'All Time' },
                                ].map(btn => (
                                    <button
                                        key={btn.id}
                                        onClick={() => { setDateFilter(btn.id); setCurrentPage(1); }}
                                        className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all ${
                                            dateFilter === btn.id
                                                ? 'bg-indigo-600 text-white shadow-xs'
                                                : 'bg-slate-100 dark:bg-slate-800/70 text-slate-650 dark:text-slate-400 hover:bg-slate-200/70'
                                        }`}
                                    >
                                        {btn.label}
                                    </button>
                                ))}
                            </div>

                            {/* Search Input */}
                            <div className="relative w-full lg:w-72">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                                <Input 
                                    placeholder="Search customer, phone, bank, agent..." 
                                    className="pl-9 h-9 text-xs rounded-xl border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-medium focus-visible:ring-indigo-500" 
                                    value={searchQuery} 
                                    onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }} 
                                />
                                {searchQuery && (
                                    <button 
                                        onClick={() => setSearchQuery("")} 
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Dropdown Filters (Status, Bank, Telecaller) */}
                        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                            {/* Status Filter */}
                            <div className="w-36">
                                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
                                    <SelectTrigger className="h-8 text-xs rounded-lg font-bold border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent className="dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                                        <SelectItem value="all" className="text-xs font-bold">All Statuses</SelectItem>
                                        <SelectItem value="Login Done" className="text-xs">Login Done (In Process)</SelectItem>
                                        <SelectItem value="Approved" className="text-xs">Approved / Disbursed</SelectItem>
                                        <SelectItem value="Rejected" className="text-xs">Rejected</SelectItem>
                                        <SelectItem value="Pending" className="text-xs">Pending</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Lender / Bank Filter */}
                            <div className="w-44">
                                <Select value={selectedBank} onValueChange={(v) => { setSelectedBank(v); setCurrentPage(1); }}>
                                    <SelectTrigger className="h-8 text-xs rounded-lg font-bold border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                                        <SelectValue placeholder="Bank / Lender" />
                                    </SelectTrigger>
                                    <SelectContent className="dark:bg-slate-900 border-slate-200 dark:border-slate-800 max-h-56">
                                        <SelectItem value="all" className="text-xs font-bold">All Lenders</SelectItem>
                                        <SelectItem value="icici" className="text-xs">ICICI Bank</SelectItem>
                                        <SelectItem value="idfc" className="text-xs">IDFC First Bank</SelectItem>
                                        <SelectItem value="incred" className="text-xs">InCred Finance</SelectItem>
                                        <SelectItem value="hdfc" className="text-xs">HDFC Bank</SelectItem>
                                        <SelectItem value="finnable" className="text-xs">Finnable</SelectItem>
                                        <SelectItem value="axis" className="text-xs">Axis Bank</SelectItem>
                                        <SelectItem value="piramal" className="text-xs">Piramal Capital</SelectItem>
                                        <SelectItem value="fibe" className="text-xs">Fibe</SelectItem>
                                        <SelectItem value="kotak" className="text-xs">Kotak Mahindra</SelectItem>
                                        <SelectItem value="indusind" className="text-xs">IndusInd Bank</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Telecaller Filter */}
                            <div className="w-44">
                                <Select value={telecallerFilter} onValueChange={(v) => { setTelecallerFilter(v); setCurrentPage(1); }}>
                                    <SelectTrigger className="h-8 text-xs rounded-lg font-bold border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                                        <SelectValue placeholder="Telecaller" />
                                    </SelectTrigger>
                                    <SelectContent className="dark:bg-slate-900 border-slate-200 dark:border-slate-800 max-h-56">
                                        <SelectItem value="all" className="text-xs font-bold">All Telecallers</SelectItem>
                                        <SelectItem value="unassigned" className="text-xs text-rose-500 font-semibold">Unassigned</SelectItem>
                                        {teamUsers.map(u => (
                                            <SelectItem key={u.id} value={u.id} className="text-xs">{u.full_name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Clear Filters Button */}
                            {hasActiveFilters && (
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={resetFilters}
                                    className="h-8 px-2.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 font-bold gap-1 rounded-lg"
                                >
                                    <X className="h-3.5 w-3.5" />
                                    <span>Reset Filters</span>
                                </Button>
                            )}

                            <span className="text-[11px] font-semibold text-slate-400 ml-auto">
                                Showing {filteredLogins.length} record{filteredLogins.length === 1 ? '' : 's'}
                            </span>
                        </div>
                    </div>

                    {/* Main Layout: Table + Live Handover Sidebar */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                        
                        {/* Table Column */}
                        <div className="lg:col-span-9 space-y-4">
                            <Card className="shadow-xs border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl overflow-hidden">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader className="bg-slate-50/80 dark:bg-slate-800/40">
                                            <TableRow className="border-b border-slate-200/80 dark:border-slate-850">
                                                <TableHead className="font-extrabold text-slate-700 dark:text-slate-300 text-xs">Customer</TableHead>
                                                <TableHead className="font-extrabold text-slate-700 dark:text-slate-300 text-xs">Primary Bank & Attempts</TableHead>
                                                <TableHead className="font-extrabold text-slate-700 dark:text-slate-300 text-xs">Status</TableHead>
                                                <TableHead className="hidden md:table-cell font-extrabold text-slate-700 dark:text-slate-300 text-xs">Agent</TableHead>
                                                <TableHead className="font-extrabold text-slate-700 dark:text-slate-300 text-xs">Date</TableHead>
                                                <TableHead className="w-[80px] text-right font-extrabold text-slate-700 dark:text-slate-300 text-xs pr-4">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {loading ? (
                                                <TableRow>
                                                    <TableCell colSpan={6} className="h-48 text-center">
                                                        <Loader2 className="h-8 w-8 animate-spin mx-auto text-indigo-600" />
                                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-2">Loading customer logins...</p>
                                                    </TableCell>
                                                </TableRow>
                                            ) : paginatedLogins.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={6} className="h-48 text-center">
                                                        <EmptyState icon={Search} title="No Records Match Your Filters" description="Try selecting a different date range or resetting your search keywords." />
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                paginatedLogins.map((item) => (
                                                    <TableRow key={item.id} className="group hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors border-b border-slate-100 dark:border-slate-850">
                                                        {/* Customer Name, Phone & Quick Links */}
                                                        <TableCell className="py-3">
                                                            <div className="flex flex-col">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="font-bold text-slate-900 dark:text-slate-100 text-xs">{item.name}</span>
                                                                </div>
                                                                <div className="flex items-center gap-2 mt-0.5">
                                                                    <span className="text-[11px] text-slate-500 font-mono font-medium">{item.phone}</span>
                                                                    <button 
                                                                        onClick={() => {
                                                                            navigator.clipboard.writeText(item.phone)
                                                                            toast.success("Phone number copied!")
                                                                        }}
                                                                        className="text-slate-400 hover:text-slate-700" 
                                                                        title="Copy phone"
                                                                    >
                                                                        <Copy className="h-2.5 w-2.5" />
                                                                    </button>

                                                                    {/* Quick Links to CRM & WhatsApp */}
                                                                    <Link href={`/admin/leads?search=${item.phone}`} title="Find in CRM Leads">
                                                                        <ExternalLink className="h-2.5 w-2.5 text-indigo-500 hover:text-indigo-700" />
                                                                    </Link>
                                                                    <Link href={`/admin/whatsapp?search=${item.phone}`} title="Open in WhatsApp Hub">
                                                                        <MessageSquare className="h-2.5 w-2.5 text-emerald-500 hover:text-emerald-700" />
                                                                    </Link>
                                                                </div>
                                                            </div>
                                                        </TableCell>

                                                        {/* Bank Attempts */}
                                                        <TableCell className="py-3">
                                                            <div className="flex flex-col gap-1">
                                                                <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                                                                    {item.bank_name || 'No Bank Specified'}
                                                                </span>
                                                                {Array.isArray(item.bank_attempts) && item.bank_attempts.length > 0 && (
                                                                    <div className="flex flex-wrap gap-1">
                                                                        {item.bank_attempts.map((att: BankAttempt, idx: number) => (
                                                                            <Badge key={idx} variant="outline" className={`py-0 px-1.5 text-[9px] rounded-md font-bold ${getStatusColor(att.status)}`}>
                                                                                {att.bank}: {att.status}
                                                                            </Badge>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </TableCell>

                                                        {/* Interactive Status Selector */}
                                                        <TableCell className="py-3">
                                                            <div className="w-28">
                                                                <Select 
                                                                    value={item.status || 'Login Done'} 
                                                                    onValueChange={(val) => handleQuickStatusChange(item.id, val)}
                                                                    disabled={isUpdatingStatusId === item.id}
                                                                >
                                                                    <SelectTrigger className={`h-7 px-2 text-[10px] font-extrabold rounded-lg border-0 shadow-2xs ${getStatusBadgeStyle(item.status)}`}>
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent className="dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                                                                        <SelectItem value="Login Done" className="text-xs font-bold text-amber-700">Login Done</SelectItem>
                                                                        <SelectItem value="Approved" className="text-xs font-bold text-emerald-700">Approved</SelectItem>
                                                                        <SelectItem value="Disbursed" className="text-xs font-bold text-emerald-800">Disbursed</SelectItem>
                                                                        <SelectItem value="Rejected" className="text-xs font-bold text-rose-700">Rejected</SelectItem>
                                                                        <SelectItem value="Pending" className="text-xs font-bold text-slate-600">Pending</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        </TableCell>

                                                        {/* Telecaller / Agent */}
                                                        <TableCell className="hidden md:table-cell py-3">
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="h-6 w-6 rounded-full bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 font-extrabold text-[10px] flex items-center justify-center shrink-0">
                                                                    {(item.users?.full_name || 'U')[0].toUpperCase()}
                                                                </div>
                                                                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-[120px]">
                                                                    {item.users?.full_name || 'Unassigned'}
                                                                </span>
                                                            </div>
                                                        </TableCell>

                                                        {/* Created Date */}
                                                        <TableCell className="py-3">
                                                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{format(new Date(item.created_at), "MMM dd, yyyy")}</div>
                                                            <div className="text-[10px] text-slate-400 font-mono">{format(new Date(item.created_at), "hh:mm a")}</div>
                                                        </TableCell>

                                                        {/* Actions */}
                                                        <TableCell className="py-3 text-right pr-4">
                                                            <div className="flex items-center justify-end gap-1">
                                                                <Button 
                                                                    size="icon" 
                                                                    variant="ghost" 
                                                                    className="h-7 w-7 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800 rounded-lg" 
                                                                    onClick={() => setEditingLogin(item)}
                                                                    title="Edit login details & bank attempts"
                                                                >
                                                                    <Edit className="h-3.5 w-3.5" />
                                                                </Button>
                                                                <Button 
                                                                    size="icon" 
                                                                    variant="ghost" 
                                                                    className="h-7 w-7 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 rounded-lg" 
                                                                    onClick={() => setDeleteConfirmation(item.id)}
                                                                    title="Delete record"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                                
                                {/* Pagination Controls */}
                                <div className="p-3.5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex items-center justify-between">
                                    <span className="text-xs text-slate-500 font-medium">
                                        Showing {filteredLogins.length === 0 ? 0 : ((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredLogins.length)} of {filteredLogins.length}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                        <Button 
                                            variant="outline" 
                                            size="icon" 
                                            className="h-7 w-7 rounded-lg border-slate-200 dark:border-slate-800" 
                                            onClick={() => setCurrentPage(p => Math.max(1, p-1))} 
                                            disabled={currentPage === 1}
                                        >
                                            <ChevronLeft className="h-3.5 w-3.5"/>
                                        </Button>
                                        <span className="text-xs font-bold text-slate-600 px-2">Page {currentPage} of {totalPages || 1}</span>
                                        <Button 
                                            variant="outline" 
                                            size="icon" 
                                            className="h-7 w-7 rounded-lg border-slate-200 dark:border-slate-800" 
                                            onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} 
                                            disabled={currentPage === totalPages || totalPages === 0}
                                        >
                                            <ChevronRight className="h-3.5 w-3.5"/>
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        </div>

                        {/* Sidebar: Live Handover & Quick Tips */}
                        <div className="lg:col-span-3 space-y-5">
                            
                            {/* Live Handover Card */}
                            <Card className="shadow-xs border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl overflow-hidden">
                                <CardHeader className="bg-gradient-to-r from-indigo-50/60 to-purple-50/30 dark:from-slate-800/40 dark:to-slate-800/20 pb-3 border-b border-slate-100 dark:border-slate-800">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="relative">
                                                <span className="h-2 w-2 rounded-full bg-emerald-500 absolute -top-0.5 -right-0.5 animate-ping" />
                                                <span className="h-2 w-2 rounded-full bg-emerald-500 absolute -top-0.5 -right-0.5" />
                                                <ArrowRightLeft className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                                            </div>
                                            <CardTitle className="text-xs font-extrabold text-slate-850 dark:text-slate-100">Live KYC Handovers</CardTitle>
                                        </div>
                                        <Badge className="bg-indigo-600 text-white text-[10px] font-extrabold py-0.5 px-2 rounded-full">{transfers.length}</Badge>
                                    </div>
                                    <CardDescription className="text-[11px] text-slate-500">Transferred to KYC today</CardDescription>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
                                        {transfers.length === 0 ? (
                                            <div className="p-6 text-center text-xs text-slate-400 italic font-medium">No files handed over today yet.</div>
                                        ) : (
                                            transfers.map((t) => (
                                                <Link 
                                                    key={t.id} 
                                                    href={`/admin/leads/${t.id}`}
                                                    className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/25 transition-all block group"
                                                >
                                                    <div className="flex justify-between items-center gap-2">
                                                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 transition-colors truncate">{t.name}</span>
                                                        <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap">{format(new Date(t.updated_at), "hh:mm a")}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                                                        <span>Agent: <strong className="font-semibold text-slate-700 dark:text-slate-300">{t.users?.full_name?.split(' ')[0] || 'Unknown'}</strong></span>
                                                        <span className="text-indigo-600 text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">View Lead →</span>
                                                    </div>
                                                </Link>
                                            ))
                                        )}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Top Lenders Quick Reference */}
                            <Card className="shadow-xs border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl p-4 space-y-2.5">
                                <span className="text-[10px] uppercase tracking-wider font-extrabold text-slate-400">Supported Lenders</span>
                                <div className="flex flex-wrap gap-1.5">
                                    {POPULAR_LENDERS.slice(0, 8).map(bank => (
                                        <button 
                                            key={bank}
                                            onClick={() => { setSelectedBank(bank); setCurrentPage(1); }}
                                            className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                                        >
                                            {bank}
                                        </button>
                                    ))}
                                </div>
                            </Card>

                        </div>
                    </div>
                </TabsContent>

                {/* ========================================================== */}
                {/* --- TAB 2: DAILY REPORTS --- */}
                {/* ========================================================== */}
                <TabsContent value="daily_reports">
                    <DailyReportsView logins={logins} />
                </TabsContent>

                {/* ========================================================== */}
                {/* --- TAB 3: MONTHLY REPORTS --- */}
                {/* ========================================================== */}
                <TabsContent value="monthly_reports">
                    <MonthlyReportsView logins={logins} attendanceData={attendanceData} />
                </TabsContent>
            </Tabs>

            {/* ========================================================== */}
            {/* --- MODAL: CREATE NEW LOGIN --- */}
            {/* ========================================================== */}
            <NewLoginDialog 
                open={isNewLoginOpen} 
                onClose={() => setIsNewLoginOpen(false)} 
                teamUsers={teamUsers}
                onCreated={() => {
                    fetchData()
                    setIsNewLoginOpen(false)
                }}
            />

            {/* ========================================================== */}
            {/* --- SHEET: EDIT LOGIN & BANK ATTEMPTS --- */}
            {/* ========================================================== */}
            <EditLoginSheet 
                login={editingLogin} 
                open={!!editingLogin} 
                onClose={() => setEditingLogin(null)}
                teamUsers={teamUsers}
                onSave={(updated) => {
                    setLogins(prev => prev.map(l => l.id === updated.id ? updated : l))
                    setEditingLogin(null)
                }} 
                onDelete={(id) => setDeleteConfirmation(id)}
            />

            {/* ========================================================== */}
            {/* --- DIALOG: DELETE CONFIRMATION --- */}
            {/* ========================================================== */}
            <Dialog open={!!deleteConfirmation} onOpenChange={() => setDeleteConfirmation(null)}>
                <DialogContent className="rounded-2xl dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                    <DialogHeader>
                        <DialogTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 text-rose-600">
                            <AlertTriangle className="h-5 w-5" /> Delete Login Record?
                        </DialogTitle>
                        <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            This action cannot be undone. This customer application record and all linked bank attempts will be permanently deleted from the database.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-4 gap-2 sm:gap-0">
                        <Button variant="outline" size="sm" onClick={() => setDeleteConfirmation(null)} className="rounded-xl text-xs">Cancel</Button>
                        <Button variant="destructive" size="sm" onClick={handleDelete} className="rounded-xl text-xs bg-rose-600 hover:bg-rose-700">Delete Permanently</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    )
}

// ======================================================================
// --- COMPONENT: NEW LOGIN DIALOG ---
// ======================================================================
function NewLoginDialog({ 
    open, 
    onClose, 
    teamUsers, 
    onCreated 
}: { 
    open: boolean; 
    onClose: () => void; 
    teamUsers: TeamUser[]; 
    onCreated: () => void; 
}) {
    const [name, setName] = useState("")
    const [phone, setPhone] = useState("")
    const [bankName, setBankName] = useState("")
    const [status, setStatus] = useState("Login Done")
    const [assignedTo, setAssignedTo] = useState<string>("unassigned")
    const [notes, setNotes] = useState("")
    const [loading, setLoading] = useState(false)
    const [dupWarning, setDupWarning] = useState<string | null>(null)

    // Check duplicate phone on blur or typing 10 digits
    useEffect(() => {
        const clean = phone.replace(/\D/g, '')
        if (clean.length === 10) {
            checkLoginDuplicateAction(clean).then(res => {
                if (res.exists && res.login) {
                    setDupWarning(`⚠️ Note: Already logged for ${res.login.name} (${res.login.bank_name}) by ${res.login.agent_name}`)
                } else {
                    setDupWarning(null)
                }
            })
        } else {
            setDupWarning(null)
        }
    }, [phone])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) return toast.error("Please enter customer name")
        if (phone.replace(/\D/g, '').length !== 10) return toast.error("Please enter a valid 10-digit phone number")
        if (!bankName.trim()) return toast.error("Please specify a bank or NBFC")

        setLoading(true)
        const res = await createLoginAction({
            name,
            phone,
            bank_name: bankName,
            status,
            assigned_to: assignedTo === 'unassigned' ? null : assignedTo,
            notes
        })

        if (res.success) {
            toast.success("Login entry created successfully!")
            setName("")
            setPhone("")
            setBankName("")
            setNotes("")
            setStatus("Login Done")
            onCreated()
        } else {
            toast.error("Failed to create login: " + res.error)
        }
        setLoading(false)
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-md bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                <DialogHeader>
                    <DialogTitle className="text-base font-extrabold flex items-center gap-2">
                        <Plus className="h-4.5 w-4.5 text-indigo-600" /> New Customer Login
                    </DialogTitle>
                    <DialogDescription className="text-xs text-slate-500">
                        Record a new loan file submitted to a partner bank or NBFC.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Customer Full Name *</Label>
                        <Input 
                            value={name} 
                            onChange={e => setName(e.target.value)} 
                            placeholder="e.g. Rahul Sharma" 
                            className="h-9 text-xs rounded-xl"
                            required
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Customer Phone Number *</Label>
                        <Input 
                            value={phone} 
                            onChange={e => setPhone(e.target.value)} 
                            placeholder="10-digit mobile number" 
                            className="h-9 text-xs rounded-xl font-mono"
                            maxLength={10}
                            required
                        />
                        {dupWarning && (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/40 p-2 rounded-lg border border-amber-200 dark:border-amber-900/50">
                                {dupWarning}
                            </p>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Lender / Bank Name *</Label>
                        <Input 
                            value={bankName} 
                            onChange={e => setBankName(e.target.value)} 
                            placeholder="e.g. ICICI Bank, InCred, IDFC First" 
                            className="h-9 text-xs rounded-xl"
                            required
                        />
                        {/* Quick Selection Pills */}
                        <div className="flex flex-wrap gap-1 pt-1">
                            {["ICICI Bank", "IDFC First", "InCred", "HDFC Bank", "Finnable", "Axis Bank", "Piramal"].map(b => (
                                <button
                                    key={b}
                                    type="button"
                                    onClick={() => setBankName(b)}
                                    className="text-[10px] font-bold bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2 py-0.5 rounded-md transition-colors"
                                >
                                    {b}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Initial Status</Label>
                            <Select value={status} onValueChange={setStatus}>
                                <SelectTrigger className="h-9 text-xs rounded-xl">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                                    <SelectItem value="Login Done" className="text-xs">Login Done</SelectItem>
                                    <SelectItem value="Approved" className="text-xs">Approved</SelectItem>
                                    <SelectItem value="Pending" className="text-xs">Pending</SelectItem>
                                    <SelectItem value="Rejected" className="text-xs">Rejected</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Assigned Agent</Label>
                            <Select value={assignedTo} onValueChange={setAssignedTo}>
                                <SelectTrigger className="h-9 text-xs rounded-xl">
                                    <SelectValue placeholder="Unassigned" />
                                </SelectTrigger>
                                <SelectContent className="dark:bg-slate-900 border-slate-200 dark:border-slate-800 max-h-48">
                                    <SelectItem value="unassigned" className="text-xs text-rose-500">Unassigned</SelectItem>
                                    {teamUsers.map(u => (
                                        <SelectItem key={u.id} value={u.id} className="text-xs">{u.full_name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Notes & Comments</Label>
                        <Input 
                            value={notes} 
                            onChange={e => setNotes(e.target.value)} 
                            placeholder="e.g. Salary slips verified, pending bank login ID" 
                            className="h-9 text-xs rounded-xl"
                        />
                    </div>

                    <DialogFooter className="pt-2">
                        <Button type="button" variant="outline" size="sm" onClick={onClose} className="rounded-xl">Cancel</Button>
                        <Button type="submit" disabled={loading} size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold">
                            {loading ? <Loader2 className="animate-spin h-4 w-4" /> : "Save Login"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

// ======================================================================
// --- COMPONENT: EDIT LOGIN SHEET ---
// ======================================================================
function EditLoginSheet({ 
    login, 
    open, 
    onClose, 
    teamUsers,
    onSave, 
    onDelete 
}: { 
    login: any; 
    open: boolean; 
    onClose: () => void; 
    teamUsers: TeamUser[];
    onSave: (l: any) => void; 
    onDelete: (id: string) => void; 
}) {
    const [name, setName] = useState("")
    const [phone, setPhone] = useState("")
    const [bankName, setBankName] = useState("")
    const [assignedTo, setAssignedTo] = useState<string>("unassigned")
    const [notes, setNotes] = useState("")
    const [attempts, setAttempts] = useState<BankAttempt[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (login) {
            setName(login.name || "")
            setPhone(login.phone || "")
            setBankName(login.bank_name || "")
            setAssignedTo(login.assigned_to || "unassigned")
            setNotes(login.notes || "")

            const existing = Array.isArray(login.bank_attempts) ? login.bank_attempts : []
            if (existing.length === 0 && login.bank_name) {
                existing.push({ 
                    bank: login.bank_name, 
                    status: login.status === 'Logged In' ? 'Pending' : (login.status || 'Pending'), 
                    date: login.updated_at || new Date().toISOString() 
                })
            }
            setAttempts(existing)
        }
    }, [login])

    const handleAdd = () => setAttempts([...attempts, { bank: '', status: 'Pending', date: new Date().toISOString() }])
    
    const handleChange = (idx: number, field: keyof BankAttempt, val: string) => {
        const next = [...attempts]
        next[idx] = { ...next[idx], [field]: val }
        setAttempts(next)
    }
    
    const handleRemove = (idx: number) => setAttempts(attempts.filter((_, i) => i !== idx))

    const save = async () => {
        if (!login) return
        setLoading(true)
        const hasSuccess = attempts.some(a => ['Approved', 'Disbursed'].includes(a.status))
        const overallStatus = hasSuccess ? 'Approved' : (login.status || 'Login Done')
        const finalBank = attempts[attempts.length-1]?.bank || bankName

        const res = await updateLoginAction(login.id, {
            name,
            phone,
            bank_name: finalBank,
            status: overallStatus,
            assigned_to: assignedTo,
            notes,
            bank_attempts: attempts
        })

        if (res.success) {
            toast.success("Login updated successfully")
            onSave({
                ...login,
                name,
                phone,
                bank_name: finalBank,
                status: overallStatus,
                assigned_to: assignedTo === 'unassigned' ? null : assignedTo,
                notes,
                bank_attempts: attempts
            })
            onClose()
        } else {
            toast.error("Failed to save: " + res.error)
        }
        setLoading(false)
    }

    return (
        <Sheet open={open} onOpenChange={onClose}>
            <SheetContent className="w-[420px] sm:w-[560px] overflow-y-auto border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl p-6">
                <SheetHeader className="mb-5 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <SheetTitle className="text-base font-extrabold text-slate-900 dark:text-white">
                        Edit Customer Application
                    </SheetTitle>
                    <SheetDescription className="text-xs text-slate-500">
                        Update customer records, assign telecallers, and track bank attempts.
                    </SheetDescription>
                </SheetHeader>
                
                <div className="space-y-5">
                    {/* Customer Info Fields */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">Customer Name</Label>
                            <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-xs rounded-lg" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">Phone</Label>
                            <Input value={phone} onChange={e => setPhone(e.target.value)} className="h-8 text-xs rounded-lg font-mono" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">Assigned Telecaller</Label>
                            <Select value={assignedTo} onValueChange={setAssignedTo}>
                                <SelectTrigger className="h-8 text-xs rounded-lg">
                                    <SelectValue placeholder="Unassigned" />
                                </SelectTrigger>
                                <SelectContent className="dark:bg-slate-900 border-slate-200 dark:border-slate-800 max-h-48">
                                    <SelectItem value="unassigned" className="text-xs text-rose-500">Unassigned</SelectItem>
                                    {teamUsers.map(u => (
                                        <SelectItem key={u.id} value={u.id} className="text-xs">{u.full_name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1">
                            <Label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">Notes</Label>
                            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add note..." className="h-8 text-xs rounded-lg" />
                        </div>
                    </div>

                    {/* Bank Applications Manager */}
                    <div className="space-y-3 pt-2">
                        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
                            <div>
                                <Label className="text-xs uppercase tracking-wider font-extrabold text-slate-700 dark:text-slate-300">Bank Submissions & Attempts</Label>
                                <p className="text-[10px] text-slate-400">Add all lenders where this customer file has been applied.</p>
                            </div>
                            <Button size="sm" onClick={handleAdd} className="h-7 gap-1 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white">
                                <Plus className="h-3 w-3"/> Add Attempt
                            </Button>
                        </div>
                        
                        {attempts.length === 0 && (
                            <div className="text-center py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50">
                                <p className="text-xs text-slate-400 font-medium">No lender attempts logged.</p>
                            </div>
                        )}

                        <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                            {attempts.map((att, idx) => (
                                <div key={idx} className="bg-slate-50/60 dark:bg-slate-950/40 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 relative group">
                                    <button 
                                        type="button"
                                        onClick={() => handleRemove(idx)}
                                        className="absolute top-2.5 right-2.5 text-slate-400 hover:text-rose-600"
                                    >
                                        <X className="h-3.5 w-3.5"/>
                                    </button>
                                    
                                    <div className="grid grid-cols-2 gap-3 pr-6">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Lender Name</Label>
                                            <Input 
                                                value={att.bank} 
                                                onChange={e => handleChange(idx, 'bank', e.target.value)} 
                                                placeholder="e.g. HDFC Bank" 
                                                className="h-8 text-xs rounded-lg"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Outcome Status</Label>
                                            <Select value={att.status} onValueChange={v => handleChange(idx, 'status', v as any)}>
                                                <SelectTrigger className="h-8 text-xs rounded-lg">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                                                    <SelectItem value="Pending" className="text-xs">Pending</SelectItem>
                                                    <SelectItem value="Approved" className="text-xs">Approved</SelectItem>
                                                    <SelectItem value="Disbursed" className="text-xs">Disbursed</SelectItem>
                                                    <SelectItem value="Rejected" className="text-xs">Rejected</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    {att.status === 'Rejected' && (
                                        <div className="mt-2.5 pt-2 border-t border-slate-200/60 border-dashed">
                                            <Input 
                                                placeholder="Rejection reason (Low CIBIL, Overdue, Document mismatch...)" 
                                                value={att.reason || ''} 
                                                onChange={e => handleChange(idx, 'reason', e.target.value)} 
                                                className="h-7 text-xs bg-rose-50/50 border-rose-200 text-rose-800 rounded-lg"
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <SheetFooter className="mt-6 flex-col sm:flex-row gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                    <Button 
                        variant="destructive" 
                        className="w-full sm:w-auto text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl text-xs font-bold mr-auto" 
                        onClick={() => onDelete(login.id)}
                    >
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete File
                    </Button>
                    <div className="flex gap-2 w-full sm:w-auto">
                        <Button variant="outline" onClick={onClose} className="rounded-xl text-xs">Cancel</Button>
                        <Button onClick={save} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold">
                            {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : "Save Changes"}
                        </Button>
                    </div>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}

// ======================================================================
// --- COMPONENT: DAILY REPORTS VIEW ---
// ======================================================================
function DailyReportsView({ logins }: { logins: any[] }) {
    const today = new Date()
    const [isShareOpen, setIsShareOpen] = useState(false)
    const startOfCurrentMonth = startOfMonth(today)

    const detailedStats = useMemo(() => {
        const stats: Record<string, { name: string, mtd: number, today: number, todayBank: number, todayNbfc: number, approvedCount: number }> = {}

        logins.forEach(l => {
            const createdAt = new Date(l.created_at)
            
            if (createdAt >= startOfCurrentMonth) {
                const name = l.users?.full_name || 'Unassigned'
                if (!stats[name]) stats[name] = { name, mtd: 0, today: 0, todayBank: 0, todayNbfc: 0, approvedCount: 0 }

                stats[name].mtd += 1

                const isApproved = l.status === 'Approved' || l.status === 'Disbursed'
                if (isApproved) stats[name].approvedCount += 1

                if (isSameDay(createdAt, today)) {
                    stats[name].today += 1

                    let bankName = l.bank_name || ''
                    if (!bankName && Array.isArray(l.bank_attempts) && l.bank_attempts.length > 0) {
                        bankName = l.bank_attempts[0].bank
                    }
                    bankName = bankName.toLowerCase().trim()

                    const isTargetBank = TARGET_BANKS.some(tb => bankName.includes(tb))

                    if (isTargetBank) stats[name].todayBank += 1
                    else stats[name].todayNbfc += 1 
                }
            }
        })

        return Object.values(stats).sort((a, b) => {
            if (b.today !== a.today) return b.today - a.today
            return b.mtd - a.mtd
        })
    }, [logins, startOfCurrentMonth, today])

    const mtdTotal = detailedStats.reduce((acc, curr) => acc + curr.mtd, 0)
    const todayTotal = detailedStats.reduce((acc, curr) => acc + curr.today, 0)
    const activeTodayCount = detailedStats.filter(s => s.today > 0).length

    const getRankBadge = (rank: number) => {
        if (rank === 0) {
            return (
                <span className="flex items-center gap-1 text-[10px] font-extrabold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
                    <Trophy className="h-3 w-3 text-amber-500 fill-amber-500" /> Gold
                </span>
            )
        }
        if (rank === 1) {
            return (
                <span className="flex items-center gap-1 text-[10px] font-extrabold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full border border-slate-300">
                    <Medal className="h-3 w-3 text-slate-400 fill-slate-300" /> Silver
                </span>
            )
        }
        if (rank === 2) {
            return (
                <span className="flex items-center gap-1 text-[10px] font-extrabold bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full border border-orange-200">
                    <Medal className="h-3 w-3 text-orange-500 fill-orange-400" /> Bronze
                </span>
            )
        }
        return <span className="text-slate-400 font-bold text-xs font-mono">#{rank + 1}</span>
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-200">
            {/* Top Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-gradient-to-br from-indigo-600 to-indigo-800 text-white shadow-md border-0 rounded-2xl p-5 relative overflow-hidden">
                    <FileCheck className="h-28 w-28 absolute right-0 bottom-0 opacity-10 transform translate-x-3 translate-y-3" />
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-200">Today&apos;s New Logins</span>
                    <div className="text-3xl font-black mt-1">{todayTotal}</div>
                    <p className="text-[11px] text-indigo-200 mt-1">{activeTodayCount} active telecaller{activeTodayCount === 1 ? '' : 's'} logged files today</p>
                </Card>

                <Card className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs rounded-2xl p-5">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">MTD Total Logins</span>
                    <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">{mtdTotal}</div>
                    <p className="text-[11px] text-slate-500 mt-1">Since {format(startOfCurrentMonth, 'MMM 01, yyyy')}</p>
                </Card>

                <Card className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs rounded-2xl p-5">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-600">Active Contributors</span>
                    <div className="text-3xl font-black text-emerald-600 mt-1">{detailedStats.length}</div>
                    <p className="text-[11px] text-slate-500 mt-1">Total agents with logins this month</p>
                </Card>
            </div>

            {/* Daily Leaderboard */}
            <Card className="shadow-xs border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl overflow-hidden">
                <CardHeader className="bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-200/80 dark:border-slate-800 pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <Trophy className="h-4.5 w-4.5 text-amber-500" />
                            <CardTitle className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Daily Telecaller Leaderboard</CardTitle>
                        </div>
                        <CardDescription className="text-xs text-slate-500 mt-0.5">Live breakdown of today&apos;s customer logins by Banks and NBFCs.</CardDescription>
                    </div>
                    <Button 
                        size="sm"
                        onClick={() => setIsShareOpen(true)}
                        className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs h-8 px-3.5 gap-1.5 shadow-sm self-start sm:self-auto"
                        title="Share daily screenshot to WhatsApp"
                    >
                        <Share2 className="h-3.5 w-3.5" />
                        <span>Share Screenshot</span>
                    </Button>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-slate-50/40 dark:bg-slate-800/20">
                                <TableRow className="border-b border-slate-200/80 dark:border-slate-850">
                                    <TableHead className="w-[80px] text-center text-xs font-bold text-slate-650">Rank</TableHead>
                                    <TableHead className="text-xs font-bold text-slate-650">Telecaller Name</TableHead>
                                    <TableHead className="text-center w-[120px] bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-950 dark:text-indigo-300 font-extrabold text-xs">Today&apos;s Total</TableHead>
                                    <TableHead className="text-center w-[120px] text-xs font-bold text-blue-600"><Building2 className="h-3 w-3 inline mr-1"/> Banks</TableHead>
                                    <TableHead className="text-center w-[120px] text-xs font-bold text-orange-600"><Wallet className="h-3 w-3 inline mr-1"/> NBFCs</TableHead>
                                    <TableHead className="text-center w-[120px] bg-slate-100/50 dark:bg-slate-800/40 font-extrabold text-xs">MTD Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {detailedStats.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-10 text-slate-400 text-xs italic">No logins submitted this month yet.</TableCell>
                                    </TableRow>
                                ) : (
                                    detailedStats.map((stat, index) => (
                                        <TableRow key={stat.name} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/25 transition-colors border-b border-slate-100 dark:border-slate-850">
                                            <TableCell className="py-2.5 text-center">{getRankBadge(index)}</TableCell>
                                            <TableCell className="py-2.5 font-bold text-slate-800 dark:text-slate-200 text-xs">{stat.name}</TableCell>
                                            <TableCell className="py-2.5 text-center bg-indigo-50/30 font-black text-indigo-700 text-sm">
                                                {stat.today > 0 ? stat.today : <span className="text-slate-350 font-normal">-</span>}
                                            </TableCell>
                                            <TableCell className="py-2.5 text-center font-bold text-blue-600 text-xs">
                                                {stat.todayBank > 0 ? stat.todayBank : <span className="text-slate-350 font-normal">-</span>}
                                            </TableCell>
                                            <TableCell className="py-2.5 text-center font-bold text-orange-600 text-xs">
                                                {stat.todayNbfc > 0 ? stat.todayNbfc : <span className="text-slate-350 font-normal">-</span>}
                                            </TableCell>
                                            <TableCell className="py-2.5 text-center bg-slate-50/40 font-extrabold text-slate-800 text-xs">{stat.mtd}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <LoginsReportModal
                isOpen={isShareOpen}
                onOpenChange={setIsShareOpen}
                mode="daily"
                dailyRows={detailedStats}
                titleLabel={format(today, "dd MMM yyyy (EEEE)")}
            />
        </div>
    )
}

// ======================================================================
// --- COMPONENT: MONTHLY REPORTS VIEW (WITH ATTENDANCE SYNC) ---
// ======================================================================
function MonthlyReportsView({ 
    logins, 
    attendanceData 
}: { 
    logins: any[]; 
    attendanceData: any[]; 
}) {
    const [monthOffset, setMonthOffset] = useState(0)
    const [isShareOpen, setIsShareOpen] = useState(false)

    const targetDate = subMonths(new Date(), monthOffset)
    const startOfTargetMonth = startOfMonth(targetDate)
    const endOfTargetMonth = endOfMonth(targetDate)

    const detailedStats = useMemo(() => {
        const stats: Record<string, { name: string, total: number, bank: number, nbfc: number, workingDays: number }> = {}

        // 1. Calculate working days first from attendance
        attendanceData.forEach(record => {
            const date = new Date(record.date)
            if (isWithinInterval(date, { start: startOfTargetMonth, end: endOfTargetMonth })) {
                const name = record.users?.full_name || 'Unknown'
                if (!stats[name]) stats[name] = { name, total: 0, bank: 0, nbfc: 0, workingDays: 0 }
                stats[name].workingDays += 1
            }
        })

        // 2. Add Login stats
        logins.forEach(l => {
            const createdAt = new Date(l.created_at)
            
            if (isWithinInterval(createdAt, { start: startOfTargetMonth, end: endOfTargetMonth })) {
                const name = l.users?.full_name || 'Unassigned'
                if (!stats[name]) stats[name] = { name, total: 0, bank: 0, nbfc: 0, workingDays: 0 }

                stats[name].total += 1

                let bankName = l.bank_name || ''
                if (!bankName && Array.isArray(l.bank_attempts) && l.bank_attempts.length > 0) {
                    bankName = l.bank_attempts[0].bank
                }
                bankName = bankName.toLowerCase().trim()

                const isTargetBank = TARGET_BANKS.some(tb => bankName.includes(tb))
                if (isTargetBank) stats[name].bank += 1
                else stats[name].nbfc += 1 
            }
        })

        return Object.values(stats).sort((a, b) => b.total - a.total)
    }, [logins, attendanceData, startOfTargetMonth, endOfTargetMonth])

    const grandTotal = detailedStats.reduce((acc, curr) => acc + curr.total, 0)
    const totalWorkingDaysAll = detailedStats.reduce((acc, curr) => acc + curr.workingDays, 0)

    return (
        <div className="space-y-6 animate-in fade-in duration-200">
            {/* Month Selector Bar */}
            <div className="flex flex-col sm:flex-row justify-between gap-4 items-center bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => setMonthOffset(0)}
                        className={`text-xs px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                            monthOffset === 0 
                                ? 'bg-indigo-600 text-white shadow-xs' 
                                : 'bg-slate-100 text-slate-650 hover:bg-slate-200'
                        }`}
                    >
                        This Month ({format(new Date(), "MMM yyyy")})
                    </button>
                    <button
                        onClick={() => setMonthOffset(1)}
                        className={`text-xs px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                            monthOffset === 1 
                                ? 'bg-indigo-600 text-white shadow-xs' 
                                : 'bg-slate-100 text-slate-650 hover:bg-slate-200'
                        }`}
                    >
                        Last Month ({format(subMonths(new Date(), 1), "MMM yyyy")})
                    </button>
                    <button
                        onClick={() => setMonthOffset(2)}
                        className={`text-xs px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                            monthOffset === 2 
                                ? 'bg-indigo-600 text-white shadow-xs' 
                                : 'bg-slate-100 text-slate-650 hover:bg-slate-200'
                        }`}
                    >
                        2 Months Ago ({format(subMonths(new Date(), 2), "MMM yyyy")})
                    </button>
                </div>

                <div className="flex items-center gap-4 sm:gap-6 border-t sm:border-t-0 sm:border-l border-slate-150 pt-3 sm:pt-0 sm:pl-5 w-full sm:w-auto justify-between sm:justify-start">
                    <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-extrabold">Total Monthly Logins</p>
                        <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{grandTotal}</p>
                    </div>
                    <Button 
                        size="sm"
                        onClick={() => setIsShareOpen(true)}
                        className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs h-9 px-3.5 gap-1.5 shadow-sm"
                        title="Share monthly screenshot to WhatsApp"
                    >
                        <Share2 className="h-3.5 w-3.5" />
                        <span>Share Report</span>
                    </Button>
                </div>
            </div>

            {/* Monthly Leaderboard Table */}
            <Card className="shadow-xs border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl overflow-hidden">
                <CardHeader className="bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-200/80 dark:border-slate-800 pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <CalendarDays className="h-4.5 w-4.5 text-indigo-600" />
                            <CardTitle className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                                Monthly Telecaller Performance & Attendance Correlation
                            </CardTitle>
                        </div>
                        <CardDescription className="text-xs text-slate-500 mt-0.5">
                            Evaluates logged applications against verified attendance check-ins for {format(targetDate, "MMMM yyyy")}.
                        </CardDescription>
                    </div>
                    <Button 
                        size="sm"
                        onClick={() => setIsShareOpen(true)}
                        className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs h-8 px-3.5 gap-1.5 shadow-sm self-start sm:self-auto"
                        title="Share monthly screenshot to WhatsApp"
                    >
                        <Share2 className="h-3.5 w-3.5" />
                        <span>Share Screenshot</span>
                    </Button>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-slate-50/40 dark:bg-slate-800/20">
                                <TableRow className="border-b border-slate-200/80 dark:border-slate-850">
                                    <TableHead className="w-[70px] text-center text-xs font-bold text-slate-650">Rank</TableHead>
                                    <TableHead className="text-xs font-bold text-slate-650">Telecaller Name</TableHead>
                                    <TableHead className="text-center w-[130px] font-bold text-slate-650 text-xs">
                                        <Fingerprint className="h-3 w-3 inline mr-1 text-slate-400" /> Working Days
                                    </TableHead>
                                    <TableHead className="text-center w-[130px] bg-indigo-50/50 font-extrabold text-indigo-950 text-xs">Monthly Total</TableHead>
                                    <TableHead className="text-center w-[120px] text-xs font-bold text-blue-600"><Building2 className="h-3 w-3 inline mr-1"/> Banks</TableHead>
                                    <TableHead className="text-center w-[120px] text-xs font-bold text-orange-600"><Wallet className="h-3 w-3 inline mr-1"/> NBFCs</TableHead>
                                    <TableHead className="text-center w-[130px] font-bold text-slate-650 text-xs">Logins / Day Ratio</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {detailedStats.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center py-10 text-slate-400 text-xs italic">
                                            No login or attendance records for {format(targetDate, "MMMM yyyy")}.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    detailedStats.map((stat, index) => {
                                        const ratio = stat.workingDays > 0 ? (stat.total / stat.workingDays).toFixed(1) : '-'
                                        return (
                                            <TableRow key={stat.name} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/25 transition-colors border-b border-slate-100 dark:border-slate-850">
                                                <TableCell className="py-2.5 text-center font-bold text-xs text-slate-400">#{index + 1}</TableCell>
                                                <TableCell className="py-2.5 font-bold text-slate-800 dark:text-slate-200 text-xs">{stat.name}</TableCell>
                                                <TableCell className="py-2.5 text-center font-semibold text-slate-600 text-xs">
                                                    {stat.workingDays} <span className="text-[10px] text-slate-400">days</span>
                                                </TableCell>
                                                <TableCell className="py-2.5 text-center bg-indigo-50/20 font-black text-indigo-700 text-sm">
                                                    {stat.total > 0 ? stat.total : <span className="text-slate-350 font-normal">-</span>}
                                                </TableCell>
                                                <TableCell className="py-2.5 text-center font-bold text-blue-600 text-xs">{stat.bank || '-'}</TableCell>
                                                <TableCell className="py-2.5 text-center font-bold text-orange-600 text-xs">{stat.nbfc || '-'}</TableCell>
                                                <TableCell className="py-2.5 text-center font-extrabold text-slate-700 text-xs">{ratio}</TableCell>
                                            </TableRow>
                                        )
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <LoginsReportModal
                isOpen={isShareOpen}
                onOpenChange={setIsShareOpen}
                mode="monthly"
                monthlyRows={detailedStats}
                titleLabel={format(targetDate, "MMMM yyyy")}
            />
        </div>
    )
}

// Helpers
function getStatusColor(status: string) {
    switch(status) {
        case 'Approved': return "bg-emerald-50 text-emerald-700 border-emerald-200"
        case 'Disbursed': return "bg-emerald-100 text-emerald-800 border-emerald-300"
        case 'Rejected': return "bg-rose-50 text-rose-700 border-rose-200"
        default: return "bg-amber-50 text-amber-700 border-amber-200"
    }
}

function getStatusBadgeStyle(status: string) {
    switch(status) {
        case 'Approved': case 'Disbursed': 
            return "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
        case 'Rejected': 
            return "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
        case 'Pending':
            return "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
        default: 
            return "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
    }
}
