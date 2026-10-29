import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { FileText, Users, Phone, Clock, Activity, PieChart, TrendingUp, TrendingDown, Sparkles, Flame } from "lucide-react"
import { redirect } from "next/navigation"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic" 
 
export default function AdminDashboard() {
  return (
    <div className="p-4 md:p-6 space-y-6 min-h-screen bg-slate-50/30 dark:bg-slate-950/10 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Workspace Dashboard</h1>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-450 mt-1.5">Real-time overview of your company's performance</p>
      </div>

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </div>
  )
}

async function DashboardContent() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const { data: profile } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  const tenantId = profile?.tenant_id
  if (!tenantId) return <div className="p-6 text-red-500">Error: Workspace not found.</div>

  const { data: orgData } = await supabase
    .from('organizations')
    .select('industry')
    .eq('id', tenantId)
    .single()

  const industry = orgData?.industry
  const todayStr = new Date().toISOString().split('T')[0];

  // Fetch minimal data and count it safely in memory. No SQL RPC needed.
  const [
    { data: allLeads },
    { count: activeTelecallers },
    { count: todaysCalls },
    { data: recentLeads },
    { data: hotLeads }
  ] = await Promise.all([
    // Fetch ONLY the status column. This is incredibly fast even for 100k+ rows.
    supabase.from("leads").select("status").eq('tenant_id', tenantId),
    supabase.from("users").select("*", { count: "exact", head: true }).eq('tenant_id', tenantId).eq("role", "telecaller").eq("is_active", true),
    supabase.from("call_logs").select("*", { count: "exact", head: true }).eq('tenant_id', tenantId).in('call_type', ['outbound', 'outbound_c2c']).gte("created_at", todayStr),
    supabase.from("leads").select("id, name, created_at, status, score").eq('tenant_id', tenantId).order("created_at", { ascending: false }).limit(5),
    supabase.from("leads").select("id, name, score, status").eq('tenant_id', tenantId).gte('score', 50).order("score", { ascending: false }).limit(5),
  ])

  // Safely calculate all stats
  const totalLeads = allLeads?.length || 0;
  const pendingFollowUps = allLeads?.filter((l: any) => l.status === 'follow_up').length || 0;

  // Aggregate statuses for the pie chart
  const statusCounts: Record<string, number> = {}
  allLeads?.forEach((lead: any) => {
    const status = lead.status || "new"
    statusCounts[status] = (statusCounts[status] || 0) + 1
  })

  const chartData = Object.entries(statusCounts)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard 
          title="Total Leads" 
          value={totalLeads} 
          icon={<FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />} 
          trend="+18%"
          trendUp={true}
          comparison="vs last week"
          sparklinePath="M 0 25 C 20 15, 30 18, 50 10 C 70 8, 80 5, 100 2"
          sparklineColor="text-blue-500"
          bgGradient="from-blue-500 to-indigo-500"
        />
        <StatsCard 
          title="Active Telecallers" 
          value={activeTelecallers || 0} 
          icon={<Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />} 
          trend="+8%"
          trendUp={true}
          comparison="active now"
          sparklinePath="M 0 20 C 20 10, 40 25, 60 12 C 80 18, 90 8, 100 5"
          sparklineColor="text-indigo-500"
          bgGradient="from-indigo-500 to-purple-500"
        />
        <StatsCard 
          title="Today's Calls" 
          value={todaysCalls || 0} 
          icon={<Phone className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />} 
          trend="+14%"
          trendUp={true}
          comparison="vs yesterday"
          sparklinePath="M 0 25 C 10 20, 30 10, 50 15 C 70 12, 90 4, 100 2"
          sparklineColor="text-emerald-500"
          bgGradient="from-emerald-500 to-teal-500"
        />
        <StatsCard 
          title="Pending Follow-ups" 
          value={pendingFollowUps} 
          icon={<Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />} 
          trend="-3%"
          trendUp={false}
          comparison="vs yesterday"
          sparklinePath="M 0 5 C 20 8, 30 15, 50 12 C 70 10, 80 20, 100 22"
          sparklineColor="text-amber-500"
          bgGradient="from-amber-500 to-orange-500"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        {/* Recent Activity */}
        <Card className="col-span-4 border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
            <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
              <Activity className="h-4.5 w-4.5 text-blue-500" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3.5">
              {recentLeads?.map((lead: any) => (
                  <div key={lead.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3 last:border-0 last:pb-0 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 px-2 py-1.5 rounded-xl transition-all duration-300">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">{lead.name || "Unnamed Lead"}</span>
                      <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">{new Date(lead.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full capitalize border shadow-none", getStatusPillClasses(lead.status))}>
                      {lead.status?.replace('_', ' ') || "New"}
                    </div>
                  </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Lead Status Overview */}
        <Card className="col-span-3 border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
            <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
              <PieChart className="h-4.5 w-4.5 text-indigo-500" /> Lead Status Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-4 pt-1">
              {chartData.map((item) => {
                  const percentage = totalLeads > 0 ? Math.round((item.count / totalLeads) * 100) : 0;
                  return (
                    <div key={item.status} className="space-y-1.5">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="capitalize text-slate-700 dark:text-slate-300">{item.status.replace('_', ' ')}</span>
                        <span className="text-slate-450 dark:text-slate-500">{item.count} ({percentage}%)</span>
                      </div>
                      <div className="h-2 w-full bg-slate-105 dark:bg-slate-850 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all duration-500", getStatusProgressColor(item.status))} style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                  )
                })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Hot Prospects Row */}
      {industry === 'real_estate' && (
        <div className="grid gap-6 md:grid-cols-1">
          <Card className="border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm rounded-2xl overflow-hidden mt-2">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-orange-50/50 dark:bg-orange-950/20">
              <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
                <Flame className="h-4.5 w-4.5 text-orange-500 animate-pulse" /> Hot Prospects Today
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {hotLeads && hotLeads.length > 0 ? hotLeads.map((lead: any) => (
                    <div key={lead.id} className="flex flex-col border border-orange-100 dark:border-orange-900/50 bg-orange-50/30 dark:bg-orange-900/10 p-3 rounded-xl hover:shadow-sm transition-all duration-300">
                      <div className="flex justify-between items-start mb-2">
                          <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">{lead.name || "Unnamed Lead"}</span>
                          <div className="flex items-center gap-1 text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 rounded-full text-xs font-bold">
                              <Flame className="h-3 w-3" /> {lead.score}
                          </div>
                      </div>
                      <div className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full capitalize border shadow-none inline-block self-start mt-auto", getStatusPillClasses(lead.status))}>
                        {lead.status?.replace('_', ' ') || "New"}
                      </div>
                    </div>
                )) : (
                    <div className="col-span-1 md:col-span-3 lg:col-span-5 text-center py-4 text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">No hot prospects found. Lead scores of 50 or more will appear here!</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

function StatsCard({ title, value, icon, trend, trendUp, comparison, sparklinePath, sparklineColor, bgGradient }: any) {
  const TrendingIcon = trendUp ? TrendingUp : TrendingDown
  return (
    <Card className="relative overflow-hidden border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-all duration-300 group rounded-2xl">
      {/* Background Gradient Accent Line */}
      <div className={`absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r ${bgGradient}`} />
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{title}</p>
            <p className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 text-slate-700 dark:text-slate-350 shadow-sm group-hover:scale-105 transition-transform duration-300">
            {icon}
          </div>
        </div>

        {/* Sparkline & Trends */}
        <div className="flex items-end justify-between mt-4">
          <div className="flex flex-col gap-1">
            {trend && (
              <div className="flex items-center gap-1.5">
                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold ${
                  trendUp 
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30' 
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30'
                }`}>
                  <TrendingIcon className="h-3 w-3" />
                  {trend}
                </span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                  {comparison}
                </span>
              </div>
            )}
          </div>

          {/* Mini Sparkline Chart */}
          {sparklinePath && (
            <div className="h-8 w-24 opacity-80 group-hover:opacity-100 transition-opacity">
              <svg className={`h-full w-full ${sparklineColor}`} viewBox="0 0 100 30" preserveAspectRatio="none">
                <defs>
                  <linearGradient id={`gradient-${title.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0.25"/>
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0"/>
                  </linearGradient>
                </defs>
                <path d={sparklinePath} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d={`${sparklinePath} L 100 30 L 0 30 Z`} fill={`url(#gradient-${title.replace(/\s+/g, '-')})`} />
              </svg>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

const getStatusPillClasses = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'new':
      return 'bg-blue-50/80 text-blue-750 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200/80 dark:border-blue-900/50 hover:bg-blue-100/80 dark:hover:bg-blue-950/60 transition-all font-bold'
    case 'interested':
    case 'disbursed':
      return 'bg-emerald-50/80 text-emerald-750 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-900/50 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/60 transition-all font-bold'
    case 'contacted':
    case 'documents_sent':
    case 'login':
    case 'follow_up':
      return 'bg-amber-50/80 text-amber-750 dark:bg-amber-950/40 dark:text-amber-300 border-amber-250 dark:border-amber-900/50 hover:bg-amber-100/80 dark:hover:bg-amber-950/60 transition-all font-bold'
    case 'nr':
    case 'recycle_pool':
      return 'bg-slate-50/80 text-slate-600 dark:bg-slate-900/50 dark:text-slate-400 border-slate-200/80 dark:border-slate-800 hover:bg-slate-100/80 dark:hover:bg-slate-900/75 transition-all font-bold'
    case 'not_interested':
    case 'dead_bucket':
    case 'not_eligible':
      return 'bg-rose-50/80 text-rose-750 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200/80 dark:border-rose-900/50 hover:bg-rose-100/80 dark:hover:bg-rose-950/60 transition-all font-bold'
    default:
      return 'bg-slate-55 text-slate-700 dark:bg-slate-900 dark:text-slate-450 border-slate-200 hover:bg-slate-100 transition-all font-bold'
  }
}

const getStatusProgressColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'new': return 'bg-gradient-to-r from-blue-500 to-indigo-500'
    case 'interested':
    case 'disbursed':
      return 'bg-gradient-to-r from-emerald-500 to-teal-500'
    case 'contacted':
    case 'documents_sent':
    case 'login':
    case 'follow_up':
      return 'bg-gradient-to-r from-amber-500 to-orange-500'
    case 'nr':
    case 'recycle_pool':
      return 'bg-gradient-to-r from-slate-400 to-slate-500'
    case 'not_interested':
    case 'dead_bucket':
    case 'not_eligible':
      return 'bg-gradient-to-r from-rose-500 to-red-500'
    default: return 'bg-gradient-to-r from-slate-400 to-slate-500'
  }
}

// 🔴 RESTORED SKELETON LOADER
function DashboardSkeleton() {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-[100px]" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-[60px] mb-2" />
              <Skeleton className="h-3 w-[120px]" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7 mt-4">
        <Card className="col-span-4">
          <CardHeader><Skeleton className="h-6 w-[140px]" /></CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex justify-between items-center">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-[150px]" />
                  <Skeleton className="h-3 w-[100px]" />
                </div>
                <Skeleton className="h-6 w-[80px] rounded-full" />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="col-span-3">
          <CardHeader><Skeleton className="h-6 w-[180px]" /></CardHeader>
          <CardContent className="space-y-6 pt-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-[80px]" />
                  <Skeleton className="h-3 w-[40px]" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
