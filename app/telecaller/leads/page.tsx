import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { 
  Users, Filter, TrendingUp, Clock, LogIn, CheckCircle2, 
  Flame, Target, Trophy, Sparkles, PhoneCall, Zap, HelpCircle
} from "lucide-react"
import { TelecallerLeadsTable } from "@/components/telecaller-leads-table"
import { TelecallerLeadFilters } from "@/components/telecaller-lead-filters"
import { TelecallerCreateLeadDialog } from "@/components/telecaller-create-lead-dialog" 
import { redirect } from "next/navigation"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

interface SearchParams {
  status?: string
  priority?: string
  search?: string
  source?: string
  date_range?: string
  from?: string
  to?: string
  page?: string
  sort_by?: string
  sort_order?: string
}

export default async function TelecallerLeadsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const page = Number(searchParams.page) || 1
  const pageSize = 50
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const sortBy = searchParams.sort_by || 'created_at'
  const sortOrder = searchParams.sort_order === 'asc'

  // Fetch exact counts performantly via DB rather than fetching all rows
  const { data: countsData } = await supabase.rpc('get_telecaller_lead_counts', { p_user_id: user.id });
  
  const totalCount = countsData?.total || 0;
  const newCount = countsData?.new || 0;
  const contactedCount = countsData?.contacted || 0;
  const loginCount = countsData?.login || 0;
  const disbursedCount = countsData?.disbursed || 0;

  const contactRate = totalCount ? Math.round((contactedCount / totalCount) * 100) : 0;
  
  // Calculate a gamified streak call target progress
  // Target: say 30 calls or contacted leads, lets calculate progress
  const dailyTarget = 300;
  const dailyCallsDone = contactedCount; // Contacted leads as a proxy for productive calls
  const targetPercent = Math.min(Math.round((dailyCallsDone / dailyTarget) * 100), 100);
  const callsRemaining = Math.max(dailyTarget - dailyCallsDone, 0);

  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("assigned_to", user.id)
    .order("last_contacted", { ascending: true, nullsFirst: true })  // Never-contacted leads always first
    .order(sortBy, { ascending: sortOrder })
    .range(from, to)

  if (searchParams.status && searchParams.status !== "all") query = query.eq("status", searchParams.status)
  if (searchParams.priority && searchParams.priority !== "all") query = query.eq("priority", searchParams.priority)
  if (searchParams.search) {
    query = query.or(`name.ilike.%${searchParams.search}%,email.ilike.%${searchParams.search}%,phone.ilike.%${searchParams.search}%,company.ilike.%${searchParams.search}%`)
  }

  // 📅 DATE FILTERING (Created Date)
  if (searchParams.date_range && searchParams.date_range !== "all") {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    if (searchParams.date_range === "today") {
      query = query.gte("created_at", today.toISOString())
    } else if (searchParams.date_range === "yesterday") {
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      query = query.gte("created_at", yesterday.toISOString()).lt("created_at", today.toISOString())
    } else if (searchParams.date_range === "this_week") {
      const startOfWeek = new Date(today)
      startOfWeek.setDate(startOfWeek.getDate() - 7)
      query = query.gte("created_at", startOfWeek.toISOString())
    } else if (searchParams.date_range === "this_month") {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      query = query.gte("created_at", startOfMonth.toISOString())
    } else if (searchParams.date_range === "custom" && searchParams.from) {
      const fromDate = new Date(searchParams.from)
      fromDate.setHours(0, 0, 0, 0)
      const toDate = searchParams.to ? new Date(searchParams.to) : new Date(fromDate)
      toDate.setHours(23, 59, 59, 999)
      query = query.gte("created_at", fromDate.toISOString()).lte("created_at", toDate.toISOString())
    }
  }

  const { data: leads, count } = await query

  return (
    <div className="p-3 sm:p-6 space-y-6 bg-slate-50/50 dark:bg-slate-950 min-h-screen transition-colors duration-300 pb-24 sm:pb-6">
      
      {/* 🚀 MOTIVATIONAL PRODUCTIVITY HEADER */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 dark:from-slate-950 dark:via-indigo-950/60 dark:to-slate-950 p-4 sm:p-6 rounded-2xl border border-indigo-500/20 dark:border-indigo-500/10 shadow-lg text-white">
        {/* Glow effect */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500/5 rounded-full blur-2xl -ml-16 -mb-16 pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent flex items-center gap-2">
                My Leads <span className="animate-bounce">🔥</span>
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 bg-amber-500/20 text-amber-300 text-xs px-2.5 py-0.5 rounded-full border border-amber-500/30 font-medium">
                <Flame className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                8-Call Streak
              </span>
            </div>
            
            <p className="text-slate-300 text-sm sm:text-base font-medium">
              {callsRemaining > 0 ? (
                <span>⚡ You are <strong className="text-emerald-400 font-bold">{callsRemaining} calls</strong> away from today’s sprint target. Keep dialing!</span>
              ) : (
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <Trophy className="h-4 w-4 fill-emerald-500/20 text-emerald-400" /> Daily call target crushed! Superb job!
                </span>
              )}
            </p>
            
            {/* AI Recommendation Mini Pill */}
            <div className="flex items-center gap-1.5 text-xs text-indigo-200 bg-indigo-500/10 border border-indigo-400/20 rounded-lg px-2.5 py-1 mt-2 w-fit">
              <Sparkles className="h-3 w-3 text-indigo-400 animate-pulse" />
              <span><span className="font-semibold text-white">AI Intel:</span> Best time to dial is between <span className="text-amber-300 font-semibold">2:00 PM - 4:30 PM</span> today for high answer rates.</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4 w-full md:w-auto">
            {/* Goal Pacing */}
            <div className="flex-1 md:flex-initial bg-white/5 border border-white/10 rounded-xl p-3 text-center sm:text-left min-w-[140px]">
              <div className="text-xs text-slate-400 font-medium flex items-center justify-center sm:justify-start gap-1">
                <Target className="h-3.5 w-3.5 text-emerald-400" /> Daily Target
              </div>
              <div className="text-xl font-bold mt-1 text-white flex items-baseline justify-center sm:justify-start gap-1">
                <span>{targetPercent}%</span>
                <span className="text-xs font-normal text-slate-400">({dailyCallsDone}/{dailyTarget})</span>
              </div>
              <Progress value={targetPercent} className="h-1.5 mt-2 bg-white/10" />
            </div>

            <div className="flex-none">
              <TelecallerCreateLeadDialog currentUserId={user.id} />
            </div>
          </div>
        </div>
      </div>

      {/* 📊 KPI CARDS REDESIGN (Responsive mobile grid, fintech layouts) */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        
        {/* TOTAL ASSIGNED */}
        <Card className="relative overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-md cursor-pointer group">
          <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-blue-500 to-indigo-500" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1">
            <CardTitle className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Pool</CardTitle>
            <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-500 dark:text-blue-400 group-hover:scale-110 transition-transform">
              <Users className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-1">
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">{totalCount}</div>
            <div className="flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 mt-1.5">
              <span>+18% from yesterday</span>
            </div>
            <Progress value={100} className="h-1 mt-2.5 bg-blue-100 dark:bg-blue-950" />
          </CardContent>
        </Card>

        {/* NEW PENDING */}
        <Card className="relative overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-md cursor-pointer group">
          <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-amber-500 to-orange-500" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1">
            <CardTitle className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">New Leads</CardTitle>
            <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 group-hover:scale-110 transition-transform">
              <Clock className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-1">
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">{newCount}</div>
            <div className="flex items-center gap-1 text-[11px] font-medium text-orange-600 dark:text-orange-400 mt-1.5">
              <span>Requires Action ⚡</span>
            </div>
            <Progress value={totalCount ? Math.round((newCount / totalCount) * 100) : 0} className="h-1 mt-2.5 bg-amber-100 dark:bg-amber-950" />
          </CardContent>
        </Card>

        {/* CONTACTED */}
        <Card className="relative overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-md cursor-pointer group">
          <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-purple-500 to-pink-500" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1">
            <CardTitle className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Contacted</CardTitle>
            <div className="p-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-1">
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">{contactedCount}</div>
            <div className="flex items-center gap-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 mt-1.5">
              <span>{contactRate}% contact coverage</span>
            </div>
            <Progress value={contactRate} className="h-1 mt-2.5 bg-purple-100 dark:bg-purple-950" />
          </CardContent>
        </Card>

        {/* LOGINS */}
        <Card className="relative overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-md cursor-pointer group">
          <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-orange-500 to-red-500" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1">
            <CardTitle className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Logins</CardTitle>
            <div className="p-1.5 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 group-hover:scale-110 transition-transform">
              <LogIn className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-1">
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">{loginCount}</div>
            <div className="flex items-center gap-1 text-[11px] font-medium text-orange-600 dark:text-orange-400 mt-1.5">
              <span>Files in Credit review</span>
            </div>
            <Progress value={totalCount ? Math.round((loginCount / totalCount) * 100) : 0} className="h-1 mt-2.5 bg-orange-100 dark:bg-orange-950" />
          </CardContent>
        </Card>

        {/* DISBURSED */}
        <Card className="relative overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-md cursor-pointer group col-span-2 lg:col-span-1">
          <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-emerald-500 to-teal-500" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1">
            <CardTitle className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">Disbursed</CardTitle>
            <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-1">
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">{disbursedCount}</div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 mt-1.5">
              <span>Top Performer pace 🏆</span>
            </div>
            <Progress value={totalCount ? Math.round((disbursedCount / totalCount) * 100) : 0} className="h-1 mt-2.5 bg-emerald-100 dark:bg-emerald-950" />
          </CardContent>
        </Card>
      </div>

      {/* 🔍 FILTER & LEADS TABLE SECTION */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden rounded-xl">
        <CardHeader className="p-3 sm:p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100">
              <Filter className="h-4 w-4 text-indigo-500" /> 
              <span>Active Leads Management</span>
            </CardTitle>
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm w-fit self-start sm:self-auto">
              Displaying {leads?.length || 0} of {count} leads
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-5 space-y-4">
          <TelecallerLeadFilters initialSearchParams={searchParams} />
          
          <div className="pt-2">
            <TelecallerLeadsTable 
              leads={leads || []} 
              totalCount={count || 0}
              currentPage={page}
              pageSize={pageSize}
              sortBy={sortBy}
              sortOrder={searchParams.sort_order || 'desc'}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

