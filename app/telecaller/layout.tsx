import type React from "react"
import { TelecallerSidebar } from "@/components/telecaller-sidebar"
import { CallTrackingProvider } from "@/context/call-tracking-context"
import { PushSubscriber } from "@/components/push-subscriber" 
import { TelecallerTicker } from "@/components/telecaller-ticker"
import { DailyWelcomeModal } from "@/components/telecaller/daily-welcome-modal"
import { AttendanceReminderModal } from "@/components/telecaller/AttendanceReminderModal"
import { Watermark } from "@/components/watermark"

// ✅ 1. IMPORT YOUR AGENT STATUS BAR & SUPABASE SERVER
import { AgentStatusBar } from "@/components/telecaller/AgentStatusBar"
import { GeofenceAccessGuard } from "@/components/telecaller/GeofenceAccessGuard"
import { createClient } from "@/lib/supabase/server"
import { CloudConnectSoftphone } from "@/components/telecaller/CloudConnectSoftphone"
import { CallScreenPop } from "@/components/telecaller/CallScreenPop"

// ✅ IMPORT THE THEME PROVIDER
import { ThemeProvider } from "@/components/theme-provider"

import { redirect } from "next/navigation"

// ✅ 2. MAKE THE LAYOUT ASYNC TO FETCH THE USER
export default async function TelecallerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  // Check if tenant has CloudConnect enabled AND the agent has it enabled
  const { data: userData } = await supabase.from('users').select('tenant_id, cloudconnect_enabled').eq('id', user.id).single()
  let isCloudConnectEnabled = false
  if (userData?.tenant_id && userData?.cloudconnect_enabled) {
    const { data: orgData } = await supabase.from('organizations').select('enabled_modules').eq('id', userData.tenant_id).single()
    if (orgData?.enabled_modules && orgData.enabled_modules.includes('cloudconnect_telephony')) {
      isCloudConnectEnabled = true
    }
  }

  return (
    // ✅ WRAP EVERYTHING IN THE THEME PROVIDER
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
        <PushSubscriber />
        <Watermark />
        <CallTrackingProvider>
          
          <DailyWelcomeModal />
          {user && <AttendanceReminderModal userId={user.id} />}
          
          {user && isCloudConnectEnabled && <CloudConnectSoftphone agentId={user.id} />}
          {user && <CallScreenPop agentId={user.id} />}
          
          {/* ✅ Added dark:bg-gray-900 so dark mode actually changes the background */}
          <div className="flex h-screen bg-gray-50 dark:bg-slate-950">
            <TelecallerSidebar />
            
            <div className="flex-1 flex flex-col overflow-hidden relative"> 
              
              {/* ✅ TOP NAVIGATION AREA */}
              <div className="flex flex-col border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 z-40">
                {/* Status Bar */}
                {user && (
                   <div className="w-full">
                     <AgentStatusBar userId={user.id} />
                   </div>
                )}

                {/* ✅ Ticker moved here - embedded naturally, NOT floating */}
                <div className="w-full px-4 overflow-hidden">
                  <TelecallerTicker />
                </div>
              </div>

              {/* ✅ Main Content Area - Clicks will work perfectly here now */}
              <main className="flex-1 overflow-y-auto relative p-6">
                <GeofenceAccessGuard>
                  {children}
                </GeofenceAccessGuard>
              </main>
            </div>
          </div>
        </CallTrackingProvider>
    </ThemeProvider>
  )
}
