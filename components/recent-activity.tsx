"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { formatDistanceToNow } from "date-fns"
import { Phone, FileText, UserPlus, Clock } from "lucide-react"

interface Activity {
  id: string
  type: "call" | "note" | "lead" | "follow_up"
  description: string
  created_at: string
  user_name?: string
}

export function RecentActivity() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchRecentActivity = async () => {
      const supabase = createClient()

      try {
        // Get recent call logs
        const { data: callLogs } = await supabase
          .from("call_logs")
          .select(`
            id,
            created_at,
            call_status,
            users!call_logs_user_id_fkey(full_name),
            leads!call_logs_lead_id_fkey(name)
          `)
          .in("call_type", ["outbound", "outbound_c2c"])
          .order("created_at", { ascending: false })
          .limit(5)

        // Get recent notes
        const { data: notes } = await supabase
          .from("notes")
          .select(`
            id,
            created_at,
            note_type,
            users!notes_user_id_fkey(full_name),
            leads!notes_lead_id_fkey(name)
          `)
          .order("created_at", { ascending: false })
          .limit(5)

        // Get recent leads
        const { data: leads } = await supabase
          .from("leads")
          .select("id, name, created_at")
          .order("created_at", { ascending: false })
          .limit(5)

        const allActivities: Activity[] = []

        // Process call logs
        callLogs?.forEach((log: any) => {
          allActivities.push({
            id: log.id,
            type: "call",
            description: `${log.users?.full_name} made a ${log.call_status} call to ${log.leads?.name}`,
            created_at: log.created_at,
          })
        })

        // Process notes
        notes?.forEach((note: any) => {
          allActivities.push({
            id: note.id,
            type: "note",
            description: `${note.users?.full_name} added a ${note.note_type} note for ${note.leads?.name}`,
            created_at: note.created_at,
          })
        })

        // Process leads
        leads?.forEach((lead: any) => {
          allActivities.push({
            id: lead.id,
            type: "lead",
            description: `New lead added: ${lead.name}`,
            created_at: lead.created_at,
          })
        })

        // Sort by date and take top 10
        allActivities.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        setActivities(allActivities.slice(0, 10))
      } catch (error) {
        console.error("Error fetching recent activity:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchRecentActivity()
  }, [])

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "call":
        return Phone
      case "note":
        return FileText
      case "lead":
        return UserPlus
      case "follow_up":
        return Clock
      default:
        return FileText
    }
  }

  const getActivityColor = (type: string) => {
    switch (type) {
      case "call":
        return "text-blue-600 bg-blue-50"
      case "note":
        return "text-green-600 bg-green-50"
      case "lead":
        return "text-purple-600 bg-purple-50"
      case "follow_up":
        return "text-orange-600 bg-orange-50"
      default:
        return "text-gray-600 bg-gray-50"
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="animate-pulse flex items-center space-x-3">
            <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
            <div className="flex-1 space-y-1">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {activities.length === 0 ? (
        <p className="text-gray-500 text-center py-4">No recent activity</p>
      ) : (
        activities.map((activity) => {
          const Icon = getActivityIcon(activity.type)
          const colorClasses = getActivityColor(activity.type)

          return (
            <div key={activity.id} className="flex items-start space-x-3">
              <div className={`p-2 rounded-full ${colorClasses}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900">{activity.description}</p>
                <p className="text-xs text-gray-500">
                  {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                </p>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
