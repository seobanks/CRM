// app/telecaller/calls/page.tsx
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Phone, Clock, Calendar, User, FileText, Bell, 
  UserX, PhoneOff, Briefcase, CheckCircle, Ban, BarChart2
} from "lucide-react"
import { format, isFuture } from "date-fns"

export default async function CallHistoryPage({
  searchParams,
}: {
  searchParams: { follow_up?: string; call_type?: string }
}) {
  const supabase = await createClient()

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Build query - JOINING leads table records directly
  let query = supabase
    .from("call_logs")
    .select(`
      *,
      leads (
        id,
        name,
        phone,
        company,
        status
      )
    `)
    .eq("user_id", user.id)

  // Apply filters
  if (searchParams.follow_up === "true") {
    query = query.eq("follow_up_required", true)
  }
  if (searchParams.call_type === "outbound") {
    query = query.eq("call_type", "outbound")
  } else if (searchParams.call_type === "outbound_c2c" || searchParams.call_type === "c2c") {
    query = query.eq("call_type", "outbound_c2c")
  } else {
    // Only show outbound and C2C calls
    query = query.in("call_type", ["outbound", "outbound_c2c"])
  }

  const { data: callLogs, error } = await query.order("created_at", { ascending: false })

  if (error) {
    console.error("Error fetching call logs:", error)
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">Call Dashboard</h1>
        <Card>
          <CardContent className="p-12 text-center text-red-600 font-semibold">
            Error loading system call metrics.
          </CardContent>
        </Card>
      </div>
    )
  }

  // Visual Badge Formatting Helpers
  const getStatusColor = (callType: string) => {
    switch (callType?.toLowerCase()) {
      case "outbound": return "bg-blue-100 text-blue-800"
      case "inbound": return "bg-purple-100 text-purple-800"
      default: return "bg-gray-100 text-gray-800"
    }
  }

  const getResultColor = (status: string) => {
    if (!status) return "bg-gray-100 text-gray-800"
    const normalized = status.toLowerCase().trim()
    switch (normalized) {
      case "disbursed":
      case "interested":
        return "bg-green-100 text-green-800"
      case "follow_up":
      case "documents_sent":
        return "bg-blue-100 text-blue-800"
      case "login":
        return "bg-orange-100 text-orange-800"
      case "not_interested":
      case "not_eligible":
      case "nr":
        return "bg-red-100 text-red-800"
      case "self_employed":
        return "bg-amber-100 text-amber-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const formatDuration = (seconds: number) => {
    if (!seconds) return "0:00"
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
  }

  // --- Calculate Overall Statistics ---
  const totalCalls = callLogs?.length || 0
  const completedCalls = callLogs?.filter((call: any) => call.disposition?.toUpperCase() !== "NR").length || 0
  const followUpRequired = callLogs?.filter((call: any) => call.follow_up_required).length || 0
  const upcomingCalls = callLogs?.filter((call: any) => 
    call.next_call_scheduled && isFuture(new Date(call.next_call_scheduled))
  ).length || 0
  const avgDuration = callLogs?.length
    ? Math.round(callLogs.reduce((sum: number, call: any) => sum + (call.duration_seconds || 0), 0) / callLogs.length)
    : 0

  // --- Filter Today's Telecalling Log ---
  const todayCalls = callLogs?.filter((call: any) => {
    if (!call.created_at) return false
    const todayStr = new Date().toISOString().split('T')[0] // "YYYY-MM-DD"
    const callDateStr = call.created_at.split('T')[0]       // "YYYY-MM-DD"
    return todayStr === callDateStr
  }) || []

  // Reads the active outcome category from the linked lead profile
  const countTodayLeadStatus = (targetStatus: string) => {
    return todayCalls.filter((call: any) => {
      const rawLead = call.leads;
      const leadItem = Array.isArray(rawLead) ? rawLead[0] : rawLead;
      if (!leadItem?.status) return false;

      const cleanLeadStatus = leadItem.status.toString().trim().toLowerCase();
      const cleanTarget = targetStatus.toLowerCase().trim();

      return cleanLeadStatus === cleanTarget;
    }).length
  }
  
  const todayStats = {
    total: todayCalls.length,
    duration: todayCalls.reduce((sum: number, call: any) => sum + (call.duration_seconds || 0), 0),
    nr: countTodayLeadStatus("nr"),
    notInterested: countTodayLeadStatus("not_interested"),
    selfEmployed: countTodayLeadStatus("self_employed"),
    notEligible: countTodayLeadStatus("not_eligible"),
    interested: countTodayLeadStatus("interested"),
    followUp: countTodayLeadStatus("follow_up"),
    docsPending: countTodayLeadStatus("documents_sent"),
    login: countTodayLeadStatus("login"),
    disbursed: countTodayLeadStatus("disbursed")
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Call Dashboard</h1>
          <p className="text-gray-600 mt-1">Track your daily performance and call history</p>
        </div>
      </div>

      <Tabs defaultValue="today" className="w-full space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="today">Today's Status</TabsTrigger>
          <TabsTrigger value="history">Overall History</TabsTrigger>
        </TabsList>

        {/* --- TAB 1: TODAY'S STATUS FROM THE LIVE LEAD --- */}
        <TabsContent value="today" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            
            {/* Total Updates */}
            <Card className="bg-blue-50/50 border-blue-100">
              <CardContent className="p-6 flex items-center">
                <BarChart2 className="h-8 w-8 text-blue-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Total Updates</p>
                  <p className="text-2xl font-bold text-blue-700">{todayStats.total}</p>
                </div>
              </CardContent>
            </Card>

            {/* NR */}
            <Card>
              <CardContent className="p-6 flex items-center">
                <PhoneOff className="h-8 w-8 text-gray-400" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Not Response (NR)</p>
                  <p className="text-2xl font-bold text-gray-900">{todayStats.nr}</p>
                </div>
              </CardContent>
            </Card>

            {/* Interested */}
            <Card>
              <CardContent className="p-6 flex items-center">
                <CheckCircle className="h-8 w-8 text-green-500" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Interested</p>
                  <p className="text-2xl font-bold text-gray-900">{todayStats.interested}</p>
                </div>
              </CardContent>
            </Card>

            {/* Call Back / Follow Up */}
            <Card>
              <CardContent className="p-6 flex items-center">
                <Bell className="h-8 w-8 text-indigo-500" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Call Back Set</p>
                  <p className="text-2xl font-bold text-gray-900">{todayStats.followUp}</p>
                </div>
              </CardContent>
            </Card>

            {/* Docs Pending */}
            <Card>
              <CardContent className="p-6 flex items-center">
                <FileText className="h-8 w-8 text-purple-500" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Docs Pending</p>
                  <p className="text-2xl font-bold text-gray-900">{todayStats.docsPending}</p>
                </div>
              </CardContent>
            </Card>

            {/* Login */}
            <Card>
              <CardContent className="p-6 flex items-center">
                <BarChart2 className="h-8 w-8 text-orange-500" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Login Files</p>
                  <p className="text-2xl font-bold text-gray-900">{todayStats.login}</p>
                </div>
              </CardContent>
            </Card>

            {/* Disbursed */}
            <Card>
              <CardContent className="p-6 flex items-center">
                <CheckCircle className="h-8 w-8 text-emerald-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Disbursed</p>
                  <p className="text-2xl font-bold text-gray-900">{todayStats.disbursed}</p>
                </div>
              </CardContent>
            </Card>

            {/* Not Interested */}
            <Card>
              <CardContent className="p-6 flex items-center">
                <UserX className="h-8 w-8 text-red-500" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Not Interested</p>
                  <p className="text-2xl font-bold text-gray-900">{todayStats.notInterested}</p>
                </div>
              </CardContent>
            </Card>

            {/* Not Eligible */}
            <Card>
              <CardContent className="p-6 flex items-center">
                <Ban className="h-8 w-8 text-rose-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Not Eligible</p>
                  <p className="text-2xl font-bold text-gray-900">{todayStats.notEligible}</p>
                </div>
              </CardContent>
            </Card>

            {/* Self Employed */}
            <Card>
              <CardContent className="p-6 flex items-center">
                <Briefcase className="h-8 w-8 text-amber-500" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Self Employed</p>
                  <p className="text-2xl font-bold text-gray-900">{todayStats.selfEmployed}</p>
                </div>
              </CardContent>
            </Card>

            {/* Total Talk Time */}
            <Card className="col-span-2 md:col-span-1 bg-slate-50/50">
              <CardContent className="p-6 flex items-center">
                <Clock className="h-8 w-8 text-indigo-500" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Total Talk Time</p>
                  <p className="text-2xl font-bold text-gray-900">{formatDuration(todayStats.duration)}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* --- TAB 2: OVERALL HISTORY & LOG LIST --- */}
        <TabsContent value="history" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="p-6 text-center md:text-left">
                <Phone className="h-8 w-8 text-blue-600 mx-auto md:mx-0" />
                <p className="text-sm font-medium text-gray-600 mt-2">All Time Calls</p>
                <p className="text-2xl font-bold text-gray-900">{totalCalls}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center md:text-left">
                <Clock className="h-8 w-8 text-green-600 mx-auto md:mx-0" />
                <p className="text-sm font-medium text-gray-600 mt-2">Connected</p>
                <p className="text-2xl font-bold text-gray-900">{completedCalls}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center md:text-left">
                <Bell className="h-8 w-8 text-yellow-600 mx-auto md:mx-0" />
                <p className="text-sm font-medium text-gray-600 mt-2">Pending Follow-ups</p>
                <p className="text-2xl font-bold text-gray-900">{followUpRequired}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center md:text-left">
                <Calendar className="h-8 w-8 text-purple-600 mx-auto md:mx-0" />
                <p className="text-sm font-medium text-gray-600 mt-2">Avg Duration</p>
                <p className="text-2xl font-bold text-gray-900">{formatDuration(avgDuration)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center md:text-left">
                <User className="h-8 w-8 text-indigo-600 mx-auto md:mx-0" />
                <p className="text-sm font-medium text-gray-600 mt-2">Upcoming</p>
                <p className="text-2xl font-bold text-gray-900">{upcomingCalls}</p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Detailed Call Log</h2>
            {callLogs?.map((call: any) => {
              const rawLead = call.leads
              const lead = Array.isArray(rawLead) ? rawLead[0] : rawLead
              const activeLeadStatus = lead?.status;
              
              return (
                <Card key={call.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
                      <div className="flex items-start space-x-4">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex flex-shrink-0 items-center justify-center">
                          <Phone className="h-5 w-5 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <p className="text-lg font-semibold text-gray-900">
                              {lead?.name || "Unknown Lead"}
                            </p>
                            <Badge className={getStatusColor(call.call_type)}>
                              {call.call_type?.toUpperCase() || "OUTBOUND"}
                            </Badge>
                            {activeLeadStatus && (
                              <Badge variant="outline" className={getResultColor(activeLeadStatus)}>
                                {String(activeLeadStatus).replace("_", " ").toUpperCase()}
                              </Badge>
                            )}
                            {call.follow_up_required && (
                              <Badge variant="outline" className="text-orange-600 border-orange-600">
                                Follow-up Required
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                            <span className="flex items-center">
                              <Phone className="h-4 w-4 mr-1" /> {lead?.phone || "No phone"}
                            </span>
                            <span className="flex items-center">
                              <User className="h-4 w-4 mr-1" /> {lead?.company || "No company"}
                            </span>
                            <span className="flex items-center">
                              <Calendar className="h-4 w-4 mr-1" /> {format(new Date(call.created_at), "MMM dd, yyyy HH:mm")}
                            </span>
                            <span className="flex items-center">
                              <Clock className="h-4 w-4 mr-1" /> {formatDuration(call.duration_seconds)}
                            </span>
                          </div>
                          {call.next_call_scheduled && (
                            <div className="mt-2 flex items-center space-x-2 text-sm text-blue-600">
                              <Calendar className="h-4 w-4" />
                              <span>Next call: {format(new Date(call.next_call_scheduled), "MMM dd, yyyy 'at' HH:mm")}</span>
                            </div>
                          )}
                          {call.notes && (
                            <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                              <p className="text-sm text-gray-700 flex items-start">
                                <FileText className="h-4 w-4 text-gray-500 mt-0.5 mr-2 flex-shrink-0" />
                                {call.notes}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center md:justify-end">
                        {lead?.phone && (
                          <Button variant="outline" size="sm" asChild className="w-full md:w-auto">
                            <a href={`tel:${lead.phone}`}>
                              <Phone className="h-4 w-4 mr-1" /> Call Again
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}

            {(!callLogs || callLogs.length === 0) && (
              <Card>
                <CardContent className="p-12 text-center">
                  <Phone className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No Call History</h3>
                  <p className="text-gray-600">
                    No matching activity recorded yet.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
