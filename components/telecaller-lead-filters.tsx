"use client"

import { Label } from "@/components/ui/label"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, X, SlidersHorizontal, RefreshCcw, Loader2, Zap, Mic, Sparkles, Calendar } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, useEffect, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

export function TelecallerLeadFilters({ initialSearchParams }: { initialSearchParams: any }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [search, setSearch] = useState(initialSearchParams.search || "")
  const [status, setStatus] = useState(initialSearchParams.status || "all")
  const [priority, setPriority] = useState(initialSearchParams.priority || "all")
  const [dateRange, setDateRange] = useState(initialSearchParams.date_range || "all")
  const [fromDate, setFromDate] = useState(initialSearchParams.from || "")
  const [toDate, setToDate] = useState(initialSearchParams.to || "")

  // Sync state with URL
  useEffect(() => {
    setSearch(searchParams.get("search") || "")
    setStatus(searchParams.get("status") || "all")
    setPriority(searchParams.get("priority") || "all")
    setDateRange(searchParams.get("date_range") || "all")
    setFromDate(searchParams.get("from") || "")
    setToDate(searchParams.get("to") || "")
  }, [searchParams])

  const updateFilters = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", "1")
    
    // Disable Focus Mode if manual filters are changed
    params.delete('mode');

    if (value && value !== "all") params.set(key, value)
    else params.delete(key)
    
    startTransition(() => {
      router.push(`/telecaller/leads?${params.toString()}`)
    })
  }

  const applySearch = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", "1")
    if (search) params.set("search", search)
    else params.delete("search")
    
    startTransition(() => {
      router.push(`/telecaller/leads?${params.toString()}`)
    })
  }

  const handleDateRangeChange = (val: string) => {
    setDateRange(val)
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", "1")
    params.delete('mode')

    if (val !== "custom") {
      if (val && val !== "all") {
        params.set("date_range", val)
      } else {
        params.delete("date_range")
      }
      params.delete("from")
      params.delete("to")
      setFromDate("")
      setToDate("")
    } else {
      params.set("date_range", "custom")
    }

    startTransition(() => {
      router.push(`/telecaller/leads?${params.toString()}`)
    })
  }

  const handleCustomDateChange = (field: 'from' | 'to', val: string) => {
    if (field === 'from') setFromDate(val)
    if (field === 'to') setToDate(val)

    const params = new URLSearchParams(searchParams.toString())
    params.set("page", "1")
    params.set("date_range", "custom")
    if (val) {
      params.set(field, val)
    } else {
      params.delete(field)
    }

    startTransition(() => {
      router.push(`/telecaller/leads?${params.toString()}`)
    })
  }

  const clearFilters = () => {
    setSearch("")
    setStatus("all")
    setPriority("all")
    setDateRange("all")
    setFromDate("")
    setToDate("")
    startTransition(() => {
      router.push("/telecaller/leads")
    })
  }
  
  // AUTOMATION: Power Hour Mode (Modified)
  const togglePowerMode = () => {
    const params = new URLSearchParams(searchParams.toString());
    const isPowerMode = params.get('mode') === 'power';

    if (isPowerMode) {
        // Turn OFF - Reset all automation filters
        params.delete('mode');
        params.delete('status');
        params.delete('priority'); 
        params.delete('sort_by');
        params.delete('sort_order');
    } else {
        // Turn ON: New Leads ONLY
        params.set('mode', 'power');
        params.set('status', 'new'); 
        
        // Sorting by priority so list is ordered intelligently (High -> Low)
        params.set('sort_by', 'priority');
        params.set('sort_order', 'desc');
    }
    startTransition(() => {
        router.push(`/telecaller/leads?${params.toString()}`)
    })
  }

  const hasActiveFilters = status !== "all" || priority !== "all" || search !== "" || (dateRange !== "all" && dateRange !== "");
  const isPowerMode = searchParams.get('mode') === 'power';

  return (
    <div className="space-y-3.5">
      {/* ⚡ POWER HOUR MOTIVATIONAL ALERT BANNER */}
      {isPowerMode && (
        <div className="relative overflow-hidden bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white p-3 rounded-xl shadow-md border border-amber-400/20 animate-pulse flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="bg-white/20 p-1.5 rounded-lg">
              <Zap className="h-4 w-4 fill-white text-white" />
            </div>
            <div className="space-y-0.5">
              <h5 className="text-xs sm:text-sm font-extrabold tracking-wide uppercase flex items-center gap-1.5">
                Power Hour Active <Sparkles className="h-3 w-3 fill-white text-white animate-spin" />
              </h5>
              <p className="text-[10px] sm:text-xs text-white/90 font-medium">
                Distractions muted. Focus is locked. Showing high-priority New Prospects first!
              </p>
            </div>
          </div>
          <Button 
            size="sm" 
            variant="ghost" 
            onClick={togglePowerMode} 
            className="text-white hover:bg-white/10 hover:text-white border border-white/25 rounded-lg text-xs h-7 px-2.5 font-bold"
          >
            Exit Power Mode
          </Button>
        </div>
      )}

      {/* FILTER CONTROLS BAR */}
      <div className="flex flex-col lg:flex-row gap-3">
        {/* Search Field */}
        <div className="flex-1 relative group">
          <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-slate-400 group-hover:text-slate-500 dark:group-hover:text-slate-300 h-4 w-4 transition-colors" />
          <Input 
            placeholder="Search prospect by name, phone, company..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 pr-10 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 rounded-xl focus-visible:ring-indigo-500 h-10 shadow-inner"
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
          />
          <button 
            type="button" 
            onClick={() => toast.info("Voice search is analyzing background sounds...")}
            className="absolute right-3.5 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            title="Voice Search"
          >
            <Mic className="h-4 w-4" />
          </button>
        </div>

        {/* Action Button Set */}
        <div className="flex gap-2 w-full lg:w-auto overflow-x-auto pb-1.5 lg:pb-0 scrollbar-none items-center">
          
          {/* POWER HOUR MODE TOGGLE */}
          <Button 
            variant={isPowerMode ? "default" : "outline"}
            onClick={togglePowerMode}
            className={cn(
              "whitespace-nowrap rounded-xl font-bold text-xs h-10 px-4 transition-all duration-300 border shadow-sm flex items-center gap-1.5",
              isPowerMode 
                ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-amber-600 shadow-amber-500/20 shadow-md scale-[1.03] animate-pulse" 
                : "text-amber-700 border-amber-200 bg-amber-50/50 hover:bg-amber-100/80 dark:text-amber-400 dark:border-amber-900/40 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
            )}
          >
            <Zap className={cn("h-4 w-4", isPowerMode ? "fill-white text-white" : "fill-amber-500 text-amber-500")} />
            <span>{isPowerMode ? "POWER HOUR ON" : "POWER HOUR"}</span>
          </Button>

          {/* Status Dropdown */}
          <Select value={status} onValueChange={(val) => { setStatus(val); updateFilters('status', val); }}>
            <SelectTrigger className="w-[150px] bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-xl h-10 font-medium text-xs shadow-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New Lead</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="Interested">Interested</SelectItem>
              <SelectItem value="Documents_Sent">Docs Pending</SelectItem>
              <SelectItem value="Login">Login</SelectItem>
              <SelectItem value="DISBURSED">Disbursed</SelectItem>
              <SelectItem value="follow_up">Call Back</SelectItem>
              <SelectItem value="nr">Not Reachable</SelectItem>
              <SelectItem value="not_eligible">Not Eligible</SelectItem>
            </SelectContent>
          </Select>

          {/* Priority Dropdown */}
          <Select value={priority} onValueChange={(val) => { setPriority(val); updateFilters('priority', val); }}>
            <SelectTrigger className="w-[130px] bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-xl h-10 font-medium text-xs shadow-sm">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="high">🔥 High</SelectItem>
              <SelectItem value="medium">🟡 Medium</SelectItem>
              <SelectItem value="low">❄ Low</SelectItem>
            </SelectContent>
          </Select>

          {/* Date Filter Dropdown */}
          <Select value={dateRange} onValueChange={handleDateRangeChange}>
            <SelectTrigger className={cn("w-[150px] bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-xl h-10 font-medium text-xs shadow-sm", dateRange !== "all" && "border-indigo-500 bg-indigo-50/50 text-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-400 dark:border-indigo-800")}>
              <div className="flex items-center gap-1.5 truncate">
                <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <SelectValue placeholder="Created Date" />
              </div>
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="yesterday">Yesterday</SelectItem>
              <SelectItem value="this_week">Last 7 Days</SelectItem>
              <SelectItem value="this_month">This Month</SelectItem>
              <SelectItem value="custom">📅 Custom Range</SelectItem>
            </SelectContent>
          </Select>

          {/* Filter & Reset Actions */}
          <Button 
            onClick={applySearch} 
            className="bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 rounded-xl h-10 px-4 font-bold text-xs shadow-sm" 
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin"/> : <SlidersHorizontal className="h-4 w-4 mr-1.5" />} 
            Filter
          </Button>
          
          {hasActiveFilters && (
            <Button 
              variant="outline" 
              onClick={clearFilters} 
              title="Reset Filters" 
              disabled={isPending} 
              className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-xl h-10 w-10 p-0 flex items-center justify-center shadow-sm"
            >
              <RefreshCcw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Expanded Custom Date Picker Drawer */}
      {dateRange === "custom" && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl w-full sm:w-fit animate-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-2">
            <Label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">From:</Label>
            <Input 
              type="date" 
              value={fromDate} 
              onChange={(e) => handleCustomDateChange('from', e.target.value)} 
              className="h-8 rounded-lg bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100 w-[140px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">To:</Label>
            <Input 
              type="date" 
              value={toDate} 
              onChange={(e) => handleCustomDateChange('to', e.target.value)} 
              className="h-8 rounded-lg bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100 w-[140px]"
            />
          </div>
        </div>
      )}

      {/* ACTIVE FILTER CHIPS */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2 px-1">
          {status !== "all" && (
            <Badge variant="secondary" className="px-2.5 py-1 text-[11px] font-medium gap-1.5 cursor-pointer bg-indigo-50 text-indigo-700 border border-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-900/40 rounded-lg hover:bg-indigo-100" onClick={() => updateFilters('status', 'all')}>
              Status: <span className="font-bold capitalize">{status}</span> <X className="h-3 w-3" />
            </Badge>
          )}
          {priority !== "all" && (
            <Badge variant="secondary" className="px-2.5 py-1 text-[11px] font-medium gap-1.5 cursor-pointer bg-indigo-50 text-indigo-700 border border-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-900/40 rounded-lg hover:bg-indigo-100" onClick={() => updateFilters('priority', 'all')}>
              Priority: <span className="font-bold capitalize">{priority}</span> <X className="h-3 w-3" />
            </Badge>
          )}
          {search && (
            <Badge variant="secondary" className="px-2.5 py-1 text-[11px] font-medium gap-1.5 cursor-pointer bg-indigo-50 text-indigo-700 border border-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-900/40 rounded-lg hover:bg-indigo-100" onClick={() => { setSearch(""); applySearch(); }}>
              Search: <span className="font-bold">"{search}"</span> <X className="h-3 w-3" />
            </Badge>
          )}
          {dateRange && dateRange !== "all" && (
            <Badge variant="secondary" className="px-2.5 py-1 text-[11px] font-medium gap-1.5 cursor-pointer bg-indigo-50 text-indigo-700 border border-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-900/40 rounded-lg hover:bg-indigo-100" onClick={() => handleDateRangeChange('all')}>
              Date: <span className="font-bold capitalize">{dateRange === 'custom' ? `${fromDate || 'Start'} to ${toDate || 'End'}` : dateRange.replace('_', ' ')}</span> <X className="h-3 w-3" />
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}

