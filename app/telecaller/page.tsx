"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

// UI Components
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// Icons
import { 
  Phone, Users, Clock, TrendingUp, 
  Rocket, RefreshCw, Plus, FileText, 
  AlertTriangle, Wallet, Flame, Trophy, Sparkles, 
  Signal, MessageCircle, Calendar, ListTodo, CheckCircle2,
  CheckSquare, ShieldAlert, Award, Star, Activity, Sparkle,
  Zap, Compass, UserCheck, MessageSquare, StickyNote, LayoutDashboard
} from "lucide-react"

// Custom Components
import { TodaysTasks } from "@/components/todays-tasks"
import { AttendanceWidget } from "@/components/attendance-widget"
import { NotificationProvider } from "@/components/notification-provider"
import { NotificationBell } from "@/components/notifications/notification-bell" 
import { PerformanceMetrics } from "@/components/performance-metrics"
import { DailyTargetProgress } from "@/components/daily-target-progress"
import { ErrorBoundary } from "@/components/error-boundary"
import { EmptyState } from "@/components/empty-state"
import { LiveLeaderboard } from "@/components/telecaller/LiveLeaderboard"
import { MyLeadStatusChart } from "@/components/my-lead-status-chart"
import { RecentLeads } from "@/components/recent-leads"

interface DashboardStats {
  title: string
  value: number | string
  icon: React.ComponentType<any>
  color: string
  bgColor: string
  borderColor?: string
  description?: string
  trend?: "up" | "down" | "neutral"
}

interface DashboardData {
  user: any
  isLoading: boolean
  error: string | null
  lastUpdated: Date | null
  stats: {
    myLeads: number
    todaysCalls: number
    pendingFollowUps: number
    completedToday: number
    conversionRate: number
    successRate: number
  }
  targets: {
    monthly: number
    achieved: number
    dailyCalls: number
  }
}

const INCENTIVE_RATE = 0.005 

interface RadialProgressProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
  colorClass?: string;
  trackColorClass?: string;
}

// Helper for beautiful radial gauges
function RadialProgress({ 
  percent, 
  size = 52, 
  strokeWidth = 4, 
  colorClass = "text-indigo-600", 
  trackColorClass = "text-slate-100 dark:text-slate-800" 
}: RadialProgressProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="w-full h-full transform -rotate-90">
        <circle className={trackColorClass} strokeWidth={strokeWidth} fill="transparent" r={radius} cx={size / 2} cy={size / 2} />
        <circle className={`${colorClass} transition-all duration-1000 ease-out`} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" fill="transparent" r={radius} cx={size / 2} cy={size / 2} />
      </svg>
      <span className="absolute text-[10px] font-black text-slate-800 dark:text-slate-200">{Math.round(percent)}%</span>
    </div>
  )
}

export default function TelecallerDashboard() {
  const router = useRouter()
  const supabase = createClient()
  const { useTenant } = require("@/context/tenant-provider")
  const org = useTenant()
  const isRealEstate = org?.industry === 'real_estate'
  
  // Interactive Dialer & Streak Mock States
  const [dialerStatus, setDialerStatus] = useState<'Connected' | 'Paused' | 'Failed'>('Connected')
  const [isFabOpen, setIsFabOpen] = useState(false)
  const [dialerSeconds, setDialerSeconds] = useState(1450)
  
  const [data, setData] = useState<DashboardData>({
    user: null,
    isLoading: true,
    error: null,
    lastUpdated: null,
    stats: { myLeads: 0, todaysCalls: 0, pendingFollowUps: 0, completedToday: 0, conversionRate: 0, successRate: 0 },
    targets: { monthly: 2000000, achieved: 0, dailyCalls: 350 }
  })

  // Increment Mock Dialer Session Timer
  useEffect(() => {
    const timer = setInterval(() => {
      if (dialerStatus === 'Connected') {
        setDialerSeconds(prev => prev + 1)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [dialerStatus])

  const formatTimer = (sec: number) => {
    const h = Math.floor(sec / 3600).toString().padStart(2, '0')
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0')
    const s = (sec % 60).toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  // --- DATA FETCHING ---
  const loadDashboardData = useCallback(async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        router.push("/auth/login")
        return
      }

      const now = new Date()
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

      const [
        myLeadsRes,
        todaysCallsRes,
        pendingFollowUpsRes,
        completedTodayRes,
        userProfileRes,
        disbursedRes
      ] = await Promise.all([
        supabase.from("leads").select("*", { count: "exact", head: true }).eq("assigned_to", user.id),
        supabase.from("call_logs").select("*", { count: "exact", head: true }).eq("user_id", user.id).in("call_type", ["outbound", "outbound_c2c"]).gte("created_at", startOfDay),
        supabase.from("follow_ups").select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "pending"),
        supabase.from("follow_ups").select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "completed").gte("completed_at", startOfDay),
        supabase.from("users").select("monthly_target").eq("id", user.id).maybeSingle(),
        supabase.from("leads").select("disbursed_amount").eq("assigned_to", user.id).ilike("status", "disbursed").gte("disbursed_at", startOfMonth)
      ])

      const monthlyTarget = userProfileRes.data?.monthly_target || 2000000
      const achievedAmount = disbursedRes.data?.reduce((sum: number, lead: any) => sum + Number(lead.disbursed_amount || 0), 0) || 0
      const todaysCalls = todaysCallsRes.count || 0
      const completedToday = completedTodayRes.count || 0
      const pendingFollowUps = pendingFollowUpsRes.count || 0

      const conversionRate = todaysCalls > 0 ? Math.round((completedToday / todaysCalls) * 100) : 0
      const successRate = (completedToday + pendingFollowUps) > 0 
        ? Math.round((completedToday / (completedToday + pendingFollowUps)) * 100) 
        : 0

      setData({
        user,
        isLoading: false,
        error: null,
        lastUpdated: new Date(),
        stats: { 
            myLeads: myLeadsRes.count || 0, 
            todaysCalls, 
            pendingFollowUps, 
            completedToday, 
            conversionRate, 
            successRate 
        },
        targets: { monthly: monthlyTarget, achieved: achievedAmount, dailyCalls: 350 }
      })

    } catch (err: any) {
      console.error("Dashboard Load Error:", err)
      setData(prev => ({ ...prev, isLoading: false, error: err.message || "Failed to load dashboard." }))
    }
  }, [router])

  useEffect(() => {
    loadDashboardData()
    const interval = setInterval(loadDashboardData, 15 * 60 * 1000) 
    return () => clearInterval(interval)
  }, [loadDashboardData])

  // --- CALCULATIONS ---
  const pacing = useMemo(() => {
      const now = new Date()
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      const currentDay = now.getDate()
      
      const expectedProgressPct = (currentDay / daysInMonth) * 100
      const actualProgressPct = (data.targets.achieved / data.targets.monthly) * 100
      const variance = actualProgressPct - expectedProgressPct

      return {
          expected: expectedProgressPct,
          actual: actualProgressPct,
          isAhead: variance >= 0,
          label: variance >= 0 ? `+${variance.toFixed(1)}% Ahead` : `${variance.toFixed(1)}% Behind`,
          color: variance >= 0 ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30" : "text-red-750 bg-red-50 dark:bg-red-950/30 dark:text-red-400 border-red-100 dark:border-red-900/30"
      }
  }, [data.targets])

  const estimatedIncentive = useMemo(() => {
      return Math.floor(data.targets.achieved * INCENTIVE_RATE)
  }, [data.targets.achieved])

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return "Good morning"
    if (hour < 18) return "Good afternoon"
    return "Good evening"
  }

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val)

  const callShortage = Math.max(0, data.targets.dailyCalls - data.stats.todaysCalls)
  const isTargetMet = callShortage === 0

  const statsConfig: DashboardStats[] = [
    {
      title: "Est. Incentive",
      value: formatCurrency(estimatedIncentive),
      icon: Wallet,
      color: "text-emerald-600 dark:text-emerald-400",
      bgColor: "bg-emerald-50/70 dark:bg-emerald-950/35",
      borderColor: "border-emerald-100 dark:border-emerald-900/35",
      description: "Based on 0.5% comm.",
      trend: "up"
    },
    {
      title: "Calls Today",
      value: data.stats.todaysCalls,
      icon: Phone,
      color: isTargetMet ? "text-green-600 dark:text-green-400" : "text-blue-600 dark:text-blue-400",
      bgColor: isTargetMet ? "bg-green-50/70 dark:bg-green-950/30" : "bg-blue-50/70 dark:bg-blue-950/30",
      borderColor: isTargetMet ? "border-green-100 dark:border-green-900/30" : "border-blue-100 dark:border-blue-900/30",
      description: isTargetMet ? "Target Met! 🎉" : `${callShortage} calls left`
    },
    {
      title: "Pending Tasks",
      value: data.stats.pendingFollowUps,
      icon: Clock,
      color: "text-orange-600 dark:text-orange-400",
      bgColor: "bg-orange-50/70 dark:bg-orange-950/30",
      borderColor: "border-orange-100 dark:border-orange-900/30",
      description: "Requires attention"
    },
    {
      title: "Total Leads",
      value: data.stats.myLeads,
      icon: Users,
      color: "text-slate-600 dark:text-slate-400",
      bgColor: "bg-slate-50/70 dark:bg-slate-800/40",
      borderColor: "border-slate-200 dark:border-slate-800",
      description: "Assigned pool"
    }
  ]

  if (data.isLoading) return <DashboardSkeleton />

  if (data.error) {
    return (
      <div className="h-screen flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        <EmptyState 
          icon={AlertTriangle} 
          title="Connection Error" 
          description={data.error}
          action={{ label: "Retry Connection", onClick: loadDashboardData }}
        />
      </div>
    )
  }

  return (
    <NotificationProvider userId={data.user?.id}>
      {/* Container fully mobile optimized and centering inside sidebars */}
      <div className="min-h-screen bg-slate-50/60 dark:bg-slate-950 p-3.5 sm:p-6 space-y-6 max-w-2xl mx-auto relative pb-28 font-sans">
        
        {/* --- STICKY HEADER & ACTIVE STATUS BAR --- */}
        <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-3.5 rounded-2xl border border-slate-200/50 dark:border-slate-800 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* User Avatar & Rank Badge */}
              <div className="relative shrink-0">
                <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-indigo-500 via-indigo-600 to-violet-600 flex items-center justify-center text-sm font-black text-white shadow-xs ring-2 ring-white dark:ring-slate-850">
                  {(data.user?.user_metadata?.full_name || 'TA')[0].toUpperCase()}
                </div>
                <div className="absolute -bottom-1 -right-1 bg-amber-400 text-slate-900 text-[8px] font-black rounded-full h-4.5 w-4.5 border-2 border-white dark:border-slate-900 flex items-center justify-center shadow-xs" title="Daily Leaderboard">
                  🏆
                </div>
              </div>
              
              <div>
                <h1 className="text-sm font-black text-slate-900 dark:text-white tracking-tight leading-none flex items-center gap-1.5">
                  {getGreeting()}, {data.user?.user_metadata?.full_name?.split(' ')[0]} 
                  <span className="text-xs">👋</span>
                </h1>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1 font-medium">
                  <span>Updated: {data.lastUpdated?.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wider">Syncing</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Dialer Status Pill */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge 
                      className={`cursor-pointer border py-1.5 px-3 rounded-full text-[10px] font-bold shadow-3xs transition-all flex items-center gap-1.5 ${
                        dialerStatus === 'Connected' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-450 border-emerald-250 dark:border-emerald-800' :
                        dialerStatus === 'Paused' ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-450 border-amber-250 dark:border-amber-900' :
                        'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-450 border-red-250 dark:border-red-900'
                      }`}
                      onClick={() => setDialerStatus(prev => prev === 'Connected' ? 'Paused' : prev === 'Paused' ? 'Failed' : 'Connected')}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${dialerStatus === 'Connected' ? 'bg-emerald-500 animate-pulse' : dialerStatus === 'Paused' ? 'bg-amber-500' : 'bg-red-500'}`} />
                      {dialerStatus === 'Connected' ? formatTimer(dialerSeconds) : dialerStatus}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="text-[10px] font-semibold bg-slate-900 text-white dark:bg-slate-800">Dialer status (Click to Toggle)</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <NotificationBell />
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-655 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg shrink-0" onClick={loadDashboardData}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* AI Productivity nudges header */}
          <div className="bg-slate-50/70 dark:bg-slate-950/50 p-2.5 rounded-xl border border-slate-150 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-500 animate-pulse shrink-0" />
              <p className="text-[10px] text-slate-600 dark:text-slate-400 font-semibold leading-snug">
                {isTargetMet ? "Today's target achieved! You are a superstar today! 🚀" : `AI Advice: You are ${callShortage} calls away from today's target streak. Pushing now!`}
              </p>
            </div>
            <div className="flex items-center gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-450 px-2 py-0.5 rounded-md text-[9px] font-black shrink-0 shadow-3xs">
              <Flame className="h-3 w-3 fill-amber-500" />
              🔥 5D Streak
            </div>
          </div>
        </header>

        {/* --- HERO MONTHLY GOAL CARD (DARK GRADIENT REDESIGN) --- */}
        <Card className="border-none shadow-lg bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950 text-white overflow-hidden relative group rounded-3xl">
          {/*Skewed sheen layer */}
          <div className="absolute right-0 top-0 h-full w-1/2 bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-12 -mr-16 transition-transform group-hover:-translate-x-1/2 duration-1000 pointer-events-none" />
          <div className="absolute left-10 bottom-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          
          <CardContent className="p-6 relative z-10 space-y-6">
            <div className="flex justify-between items-start">
              <div className="space-y-1.5">
                <h3 className="text-indigo-300 font-black flex items-center gap-1.5 text-[10px] uppercase tracking-widest leading-none">
                  <Rocket className="h-4 w-4 animate-bounce" /> Monthly Target Sprint
                </h3>
                <div className="flex items-baseline gap-1.5 mt-1.5">
                  <span className="text-3xl font-black tracking-tight leading-none">{formatCurrency(data.targets.achieved)}</span>
                  <span className="text-xs text-slate-400 font-medium">/ {formatCurrency(data.targets.monthly)}</span>
                </div>
              </div>
              <Badge className={`${pacing.color} border shadow-2xs font-extrabold px-3 py-1 text-[10px] rounded-full`}>
                {pacing.label}
              </Badge>
            </div>
            
            <div className="space-y-2">
              <div className="relative h-2.5 w-full bg-white/10 rounded-full overflow-hidden shadow-2xs">
                {/* Expected variance threshold */}
                <div className="absolute top-0 bottom-0 w-0.5 bg-white/40 z-20" style={{ left: `${pacing.expected}%` }} title="Expected target position today" />
                <div 
                  className={`h-full rounded-full transition-all duration-1000 ease-out shadow-xs ${pacing.isAhead ? "bg-gradient-to-r from-emerald-400 to-green-500" : "bg-gradient-to-r from-indigo-400 to-purple-400"}`}
                  style={{ width: `${Math.min(100, pacing.actual)}%` }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-slate-400 font-black uppercase tracking-wider">
                <span>0%</span>
                <span className="text-indigo-250 flex items-center gap-1">
                  <Sparkle className="h-3 w-3 text-amber-400 animate-pulse fill-amber-400" />
                  Performance Forecast: {Math.round(pacing.actual)}% pacing ratio
                </span>
                <span>100%</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3.5 pt-1.5 border-t border-white/5">
              <div className="text-center sm:text-left flex-1">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Estimated Incentive Payout</p>
                <p className="text-lg font-black text-emerald-400 tracking-tight mt-0.5">{formatCurrency(estimatedIncentive)}</p>
              </div>
              <Button onClick={() => router.push("/telecaller/logins")} className="bg-white hover:bg-slate-100 text-slate-950 font-bold text-xs shadow-md shadow-slate-950/20 w-full sm:w-auto h-9 px-4 rounded-xl shrink-0 transition-transform active:scale-95">
                <FileText className="h-3.5 w-3.5 mr-1.5 text-indigo-650" /> View Logins
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* --- KPI STATS GRID (FINTECH METRIC CARDS REDESIGN) --- */}
        <div className="grid grid-cols-2 gap-3.5">
          {statsConfig.map((stat, i) => (
            <Card key={i} className={`shadow-2xs border bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 rounded-2xl transition-all duration-200 hover:-translate-y-0.5 ${stat.borderColor}`}>
              <CardContent className="p-4 flex justify-between gap-2 h-full items-start">
                <div className="space-y-2.5 flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-widest leading-none truncate">{stat.title}</p>
                  <div className="space-y-1">
                    <span className="text-lg font-black text-slate-850 dark:text-white leading-none block tracking-tight truncate">{stat.value}</span>
                    {stat.description && (
                      <div className="flex items-center gap-1 text-[9px] font-semibold text-slate-400 dark:text-slate-500 truncate">
                        {stat.trend === "up" && <TrendingUp className="h-3 w-3 text-emerald-500 shrink-0" />}
                        <span className="truncate">{stat.description}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className={`p-2 rounded-xl shrink-0 ${stat.bgColor}`}>
                  <stat.icon className={`h-4.5 w-4.5 ${stat.color}`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* --- Daily Milestone Target Progress --- */}
        <DailyTargetProgress 
          userId={data.user?.id || ""} 
          targets={{ 
            daily_calls: data.targets.dailyCalls, 
            daily_completed: 20, 
            monthly_target: data.targets.monthly 
          }} 
          currentCalls={data.stats.todaysCalls}
          currentCompleted={data.stats.completedToday}
        />

        {/* --- Work session tracker attendance & performance gauges --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ErrorBoundary fallback={null}>
            <AttendanceWidget />
          </ErrorBoundary>

          {/* --- Circular performance analytics Board --- */}
          <Card className="shadow-xs border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl overflow-hidden relative">
            <CardHeader className="pb-3 border-b bg-slate-50/50 dark:bg-slate-800/20">
              <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-150 flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-indigo-500" />
                Session Analytics
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col items-center justify-center p-3 bg-slate-50/70 dark:bg-slate-950/20 border rounded-xl dark:border-slate-850">
                  <RadialProgress percent={data.stats.conversionRate} colorClass="text-indigo-600 dark:text-indigo-400" />
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 mt-2">Conversion</span>
                  <span className="text-[9px] text-slate-400 mt-0.5">Calls to Lead</span>
                </div>
                <div className="flex flex-col items-center justify-center p-3 bg-slate-50/70 dark:bg-slate-950/20 border rounded-xl dark:border-slate-850">
                  <RadialProgress percent={data.stats.successRate} colorClass="text-emerald-500" />
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 mt-2">Response Rate</span>
                  <span className="text-[9px] text-slate-400 mt-0.5">Connect ratio</span>
                </div>
              </div>
              <div className="p-3 bg-indigo-50/40 dark:bg-indigo-950/10 border border-indigo-100/60 dark:border-indigo-950/30 rounded-xl">
                <div className="flex items-center gap-2 text-[9px] font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-widest mb-1">
                  <Zap className="h-3 w-3 fill-indigo-600" /> AI Target Advice
                </div>
                <p className="text-[10px] text-indigo-650 dark:text-indigo-400 font-medium leading-relaxed">
                  Tip: Telecallers closing deals between 2:00 PM - 4:00 PM see a 25% higher connect response rate. Schedule active high-intent dials for this interval!
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* --- Quick Insights Section (New) --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="shadow-xs border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl overflow-hidden relative">
            <CardHeader className="pb-3 border-b bg-slate-50/50 dark:bg-slate-800/20">
              <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-150 flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-indigo-500" />
                Pipeline Health
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <MyLeadStatusChart userId={data.user?.id || ""} />
            </CardContent>
          </Card>
          
          <Card className="shadow-xs border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl overflow-hidden relative">
            <CardHeader className="pb-3 border-b bg-slate-50/50 dark:bg-slate-800/20">
              <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-150 flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-emerald-500" />
                Actionable Recent Leads
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 px-2 sm:px-4">
              <RecentLeads userId={data.user?.id || ""} />
            </CardContent>
          </Card>
        </div>

        {/* --- Tasks & Leaderboard Section --- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={isRealEstate ? "lg:col-span-2 space-y-4" : "lg:col-span-3 space-y-4"}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-450 dark:text-slate-550 flex items-center gap-1.5">
                <Calendar className="h-4.5 w-4.5 text-indigo-600 dark:text-indigo-400" /> AI Recommended Schedule
              </h3>
            </div>
            <ErrorBoundary fallback={<EmptyState icon={AlertTriangle} title="Error" description="Failed to load tasks." />}>
              <TodaysTasks userId={data.user?.id || ""} />
            </ErrorBoundary>
          </div>
          
          {isRealEstate && (
            <div className="lg:col-span-1 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-450 dark:text-slate-550 flex items-center gap-1.5">
                  <Trophy className="h-4.5 w-4.5 text-yellow-500" /> Gamification
                </h3>
              </div>
              <ErrorBoundary fallback={<EmptyState icon={AlertTriangle} title="Error" description="Failed to load leaderboard." />}>
                <LiveLeaderboard />
              </ErrorBoundary>
            </div>
          )}
        </div>


        {/* --- Warning indicator banners --- */}
        {!isTargetMet && (
          <Alert variant="destructive" className="bg-red-50/80 dark:bg-red-950/15 border-red-150 dark:border-red-900/30 shadow-2xs rounded-2xl p-4">
            <div className="flex gap-3">
                <div className="p-2 bg-red-100 dark:bg-red-950/50 rounded-xl h-fit shrink-0">
                    <AlertTriangle className="h-4.5 w-4.5 text-red-650 dark:text-red-400" />
                </div>
                <div>
                    <AlertTitle className="text-red-800 dark:text-red-300 font-black text-xs uppercase tracking-wider mb-1">Dials Deficiency Alert</AlertTitle>
                    <AlertDescription className="text-red-650 dark:text-red-400 text-[11px] font-medium leading-snug">
                      You are trailing by <strong className="font-extrabold">{callShortage} calls</strong> behind today's target metrics. Initiate the autodialer to make up for the variance.
                    </AlertDescription>
                </div>
            </div>
          </Alert>
        )}

        {/* --- BOTTOM FLOATING ACTION BUTTON (FAB) EXPAND MENU --- */}
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3.5">
          {/* Expand Glassmorphic actions list */}
          {isFabOpen && (
            <div className="bg-white/85 dark:bg-slate-900/85 backdrop-blur-md p-2 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col gap-1.5 min-w-[155px] animate-in slide-in-from-bottom-5 fade-in duration-200">
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full justify-start text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 h-8.5 rounded-lg px-2.5"
                onClick={() => { router.push("/leads/new"); setIsFabOpen(false) }}
              >
                <Plus className="h-3.5 w-3.5 mr-2 text-indigo-500" /> Add Lead
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full justify-start text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 h-8.5 rounded-lg px-2.5"
                onClick={() => { router.push("/telecaller/calls"); setIsFabOpen(false) }}
              >
                <Phone className="h-3.5 w-3.5 mr-2 text-blue-500" /> Dialer logs
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full justify-start text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 h-8.5 rounded-lg px-2.5"
                onClick={() => { router.push("/telecaller/notes"); setIsFabOpen(false) }}
              >
                <StickyNote className="h-3.5 w-3.5 mr-2 text-purple-500" /> Notes pad
              </Button>
            </div>
          )}

          {/* Trigger button */}
          <Button 
            className={`rounded-full h-13 w-13 shadow-2xl text-white transition-all duration-300 ease-out active:scale-95 ${isFabOpen ? 'bg-slate-900 hover:bg-slate-800 rotate-135' : 'bg-indigo-600 hover:bg-indigo-700'}`}
            onClick={() => setIsFabOpen(!isFabOpen)}
          >
            <Plus className="h-6 w-6" />
          </Button>
        </div>

        {/* --- MOBILE NAV BAR --- */}
        <div className="fixed bottom-0 left-0 right-0 z-45 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-t border-slate-200/60 dark:border-slate-850 py-2.5 px-6 flex justify-around items-center md:hidden print:hidden shadow-lg">
          <Button variant="ghost" size="sm" className="flex flex-col items-center gap-1 text-[9px] font-bold text-indigo-600 dark:text-indigo-400 h-auto p-0" onClick={() => router.push("/telecaller")}>
            <LayoutDashboard className="h-5 w-5" /> Dashboard
          </Button>
          <Button variant="ghost" size="sm" className="flex flex-col items-center gap-1 text-[9px] font-bold text-slate-450 dark:text-slate-400 h-auto p-0" onClick={() => router.push("/telecaller/leads")}>
            <Users className="h-5 w-5" /> Leads
          </Button>
          <Button variant="ghost" size="sm" className="flex flex-col items-center gap-1 text-[9px] font-bold text-slate-450 dark:text-slate-400 h-auto p-0" onClick={() => router.push("/telecaller/tasks")}>
            <ListTodo className="h-5 w-5" /> Tasks
          </Button>
          <Button variant="ghost" size="sm" className="flex flex-col items-center gap-1 text-[9px] font-bold text-slate-450 dark:text-slate-400 h-auto p-0" onClick={() => router.push("/telecaller/calls")}>
            <Phone className="h-5 w-5" /> Calls
          </Button>
        </div>

      </div>
    </NotificationProvider>
  )
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 max-w-lg mx-auto space-y-6">
      <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-3 rounded-2xl border dark:border-slate-800 shadow-3xs">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-1.5"><Skeleton className="h-3.5 w-28 rounded" /><Skeleton className="h-2.5 w-16 rounded" /></div>
        </div>
        <div className="flex gap-2"><Skeleton className="h-8 w-20 rounded-full" /><Skeleton className="h-8 w-8 rounded-lg" /></div>
      </div>
      
      <Skeleton className="h-44 w-full rounded-3xl" />
      
      <div className="grid grid-cols-2 gap-3.5">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>

      <Skeleton className="h-[280px] w-full rounded-2xl" />
    </div>
  )
}
