"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"

export function MyPerformanceChart({ userId }: { userId: string }) {
  const [data, setData] = useState<Array<{ date: string; calls: number; connected: number }>>([])
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get last 30 days
        const dates = []
        for (let i = 29; i >= 0; i--) {
          const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
          dates.push(date.toISOString().split("T")[0])
        }

        const chartData = []

        for (const date of dates) {
          const [{ count: totalCalls }, { count: connectedCalls }] = await Promise.all([
            supabase
              .from("call_logs")
              .select("*", { count: "exact", head: true })
              .eq("user_id", userId)
              .in("call_type", ["outbound", "outbound_c2c"])
              .gte("created_at", date)
              .lt("created_at", `${date}T23:59:59`),
            supabase
              .from("call_logs")
              .select("*", { count: "exact", head: true })
              .eq("user_id", userId)
              .in("call_type", ["outbound", "outbound_c2c"])
              .eq("call_status", "connected")
              .gte("created_at", date)
              .lt("created_at", `${date}T23:59:59`),
          ])

          chartData.push({
            date: new Date(date).toLocaleDateString(),
            calls: totalCalls || 0,
            connected: connectedCalls || 0,
          })
        }

        setData(chartData)
      } catch (error) {
        console.error("Error fetching performance data:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [userId, supabase])

  if (isLoading) {
    return <div className="h-64 flex items-center justify-center">Loading chart...</div>
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="calls" stroke="#3B82F6" strokeWidth={2} name="Total Calls" />
          <Line type="monotone" dataKey="connected" stroke="#10B981" strokeWidth={2} name="Connected Calls" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
