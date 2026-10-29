import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart3, TrendingUp, Phone, Target } from "lucide-react"
import { MyPerformanceChart } from "@/components/my-performance-chart"
import { MyLeadStatusChart } from "@/components/my-lead-status-chart"
import { redirect } from "next/navigation"

export default async function TelecallerReportsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  // Get last 30 days performance
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  const today = new Date().toISOString().split("T")[0]

  const [
    { count: myLeads },
    { count: myCalls },
    { count: connectedCalls },
    { count: convertedLeads },
    { count: todaysCalls },
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("assigned_to", user.id)
      .gte("created_at", thirtyDaysAgo),
    supabase
      .from("call_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("call_type", ["outbound", "outbound_c2c"])
      .gte("created_at", thirtyDaysAgo),
    supabase
      .from("call_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("call_type", ["outbound", "outbound_c2c"])
      .neq("disposition", "NR")
      .gte("created_at", thirtyDaysAgo),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("assigned_to", user.id)
      .eq("status", "closed_won")
      .gte("created_at", thirtyDaysAgo),
    supabase
      .from("call_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("call_type", ["outbound", "outbound_c2c"])
      .gte("created_at", today),
  ])

  const connectRate = myCalls ? (((connectedCalls || 0) / myCalls) * 100).toFixed(1) : "0"
  const conversionRate = myLeads ? (((convertedLeads || 0) / myLeads) * 100).toFixed(1) : "0"

  const stats = [
    {
      title: "My Leads (30d)",
      value: myLeads || 0,
      subtitle: "Assigned to me",
      icon: Target,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      title: "Calls Made (30d)",
      value: myCalls || 0,
      subtitle: `${todaysCalls || 0} today`,
      icon: Phone,
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      title: "Connect Rate",
      value: `${connectRate}%`,
      subtitle: `${connectedCalls || 0} connected`,
      icon: TrendingUp,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      title: "Conversion Rate",
      value: `${conversionRate}%`,
      subtitle: `${convertedLeads || 0} converted`,
      icon: BarChart3,
      color: "text-orange-600",
      bgColor: "bg-orange-50",
    },
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My Performance</h1>
          <p className="text-gray-600 mt-1">Track your performance and progress</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <Card key={index} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{stat.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{stat.subtitle}</p>
                </div>
                <div className={`p-3 rounded-full ${stat.bgColor}`}>
                  <stat.icon className={`h-6 w-6 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Performance Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Daily Activity (Last 30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MyPerformanceChart userId={user.id} />
          </CardContent>
        </Card>

        {/* Lead Status Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              My Lead Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MyLeadStatusChart userId={user.id} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
