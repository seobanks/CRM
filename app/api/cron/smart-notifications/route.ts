// app/api/cron/smart-notifications/route.ts
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// --- CONFIGURATION ---
// 🔴 Use the Admin Client to bypass RLS for background jobs
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key"
)

export const dynamic = 'force-dynamic'

// --- CREATIVE MESSAGE BANK ---
const MESSAGES = {
  LATE_CHECKIN: [
    "⏰ It's 9:30 AM! You aren't checked in yet. Don't lose your pay—Clock in NOW! 💸",
    "Empty chair alert! 🪑 Check in fast or the system marks you Absent.",
    "Rise and shine! The market is waiting. Mark your attendance ASAP! ☀️"
  ],
  ON_TIME_CHECKIN: [
    "🚀 You're here! Awesome start. Let's crush today's login targets!",
    "Great to see you! Grab a coffee and let's make some money today. ☕💰",
    "Attendance marked ✅ Now let's mark some success stories!"
  ],
  LOW_PERFORMANCE_MORNING: [
    "📉 It's 11 AM and the board is quiet. Try calling your 'Follow Up' list now for a quick win!",
    "💡 Tip: Energy is everything! Stand up, stretch, and dial your best leads now.",
    "Silent morning? Break the ice! Ask for referrals to boost your login count."
  ],
  LUNCH_APPROACHING: [
    "🍔 Hunger is kicking in! Close one login and earn your Biryani.",
    "Lunch is coming fast! 🍛 Finish that follow-up call so you can eat in peace.",
    "Fuel up soon! But first, let's get one approval on the board."
  ],
  POST_LUNCH_BOOST: [
    "⚡ 2 PM Slump? No way! Splash some water on your face and rock the second half.",
    "Come back to work and ROCK! 🎸 The afternoon is where the closers shine.",
    "Coffee time ☕ Wake up! The leads are waiting for your magic."
  ],
  LAST_HOUR_PUSH: [
    "🏁 It's 5 PM! The final lap. Call those 'Thinking about it' clients NOW.",
    "🍕 Pizza party vibes? Only if we hit the target! Push hard this last hour.",
    "Don't go home empty-handed! One last push for the day. You got this! 💪"
  ],
  WEEKEND_VIBES: [
    "🎉 Weekend is almost here! Push numbers now, enjoy the party later.",
    "Work hard, Party hard! 🍹 Close this deal and your weekend tastes sweeter.",
    "Incentive Alert! 💰 Hit the target and the pizza is on us!"
  ]
}

// Helper to pick random message
const getRandomMsg = (array: string[]) => array[Math.floor(Math.random() * array.length)]

export async function GET(request: Request) {
  try {
    // 1. Security Check
    const authHeader = request.headers.get('authorization')
    const { searchParams } = new URL(request.url);
    const queryKey = searchParams.get('key');
    const secret = process.env.CRON_SECRET;
    
    if (process.env.NODE_ENV !== 'development' && authHeader !== `Bearer ${secret}` && queryKey !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Determine Time (IST)
    const now = new Date()
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000)
    const istOffset = 5.5 * 60 * 60 * 1000
    const istDate = new Date(utcTime + istOffset)
    
    const currentHour = istDate.getHours() // 0-23
    const currentMinute = istDate.getMinutes() // 0-59
    const isWeekend = [5, 6].includes(istDate.getDay()) // 5=Friday, 6=Saturday (Adjust as needed)

    console.log(`⏰ Running Smart Notifications Job. Time: ${currentHour}:${currentMinute} (IST)`)

    // 🔴 3. FETCH TENANTS WITH SMART NOTIFICATIONS ENABLED
    const { data: activeTenants, error: tenantError } = await supabaseAdmin
      .from('tenant_settings')
      .select('tenant_id')
      .eq('cron_smart_notifications', true)

    if (tenantError) throw tenantError

    if (!activeTenants || activeTenants.length === 0) {
      console.log("⏭️ [CRON] No tenants have smart notifications enabled. Skipping.")
      return NextResponse.json({ message: 'No active tenants.' })
    }

    // Extract enabled IDs
    const enabledTenantIds = activeTenants.map(t => t.tenant_id)
    let notificationsSent = 0

    // =================================================================
    // SCENARIO 1: 9:30 AM - CHECK-IN REMINDERS
    // =================================================================
    if (currentHour === 9 && currentMinute >= 30 && currentMinute < 60) {
      
      // Get all active telecallers strictly inside enabled tenants
      const { data: telecallers } = await supabaseAdmin
        .from('users')
        .select('id, full_name, tenant_id')
        .eq('role', 'telecaller')
        .eq('is_active', true)
        .in('tenant_id', enabledTenantIds) // ISOLATION

      if (telecallers && telecallers.length > 0) {
        const todayStr = istDate.toISOString().split('T')[0]
        
        const { data: attendance } = await supabaseAdmin
          .from('attendance')
          .select('user_id')
          .eq('date', todayStr)
          .in('tenant_id', enabledTenantIds) // ISOLATION

        const checkedInIds = new Set(attendance?.map(a => a.user_id) || [])

        const notificationsBatch = []
        for (const user of telecallers) {
          if (!checkedInIds.has(user.id)) {
            // NOT CHECKED IN -> Pass tenant_id to the helper
            notificationsBatch.push({
              tenant_id: user.tenant_id,
              user_id: user.id,
              title: "⚠️ Attendance Alert",
              message: getRandomMsg(MESSAGES.LATE_CHECKIN),
              is_read: false,
              type: 'system',
              created_at: new Date().toISOString()
            })
          }
        }
        if (notificationsBatch.length > 0) {
          await sendNotificationsBatch(notificationsBatch)
          notificationsSent += notificationsBatch.length
        }
      }
    }

    // =================================================================
    // SCENARIO 2: HOURLY PERFORMANCE CHECKS (11 AM - 5 PM)
    // =================================================================
    if (currentHour >= 11 && currentHour <= 17) {
      
      const startOfDay = new Date(istDate.setHours(0,0,0,0)).toISOString()
      const endOfDay = new Date(istDate.setHours(23,59,59,999)).toISOString()

      // Fetch users in enabled tenants
      const { data: telecallers } = await supabaseAdmin
        .from('users')
        .select('id, full_name, tenant_id')
        .eq('role', 'telecaller')
        .eq('is_active', true)
        .in('tenant_id', enabledTenantIds) // ISOLATION

      if (telecallers && telecallers.length > 0) {
        // Fetch Logins for the specific tenants
        const { data: leads } = await supabaseAdmin.from('leads')
          .select('assigned_to, status')
          .in('status', ['Login', 'Login Done']) // Match UI string
          .gte('updated_at', startOfDay)
          .lte('updated_at', endOfDay)
          .in('tenant_id', enabledTenantIds) // ISOLATION

        // Map Counts
        const loginCounts: Record<string, number> = {}
        leads?.forEach(l => { 
            if(l.assigned_to) {
                loginCounts[l.assigned_to] = (loginCounts[l.assigned_to] || 0) + 1 
            }
        })

        const notificationsBatch = []
        for (const user of telecallers) {
          const count = loginCounts[user.id] || 0
          let title = ""
          let message = ""

          if (currentHour === 11 && count === 0) {
              title = "📈 Catch Up Required"
              message = getRandomMsg(MESSAGES.LOW_PERFORMANCE_MORNING)
          } else if (currentHour === 13) {
              title = "🍛 Lunch Time Soon"
              message = getRandomMsg(MESSAGES.LUNCH_APPROACHING)
          } else if (currentHour === 14) {
               title = "🚀 Back to Work"
               message = getRandomMsg(MESSAGES.POST_LUNCH_BOOST)
          } else if (currentHour === 17) {
              title = "🏁 Final Hour"
              message = isWeekend ? getRandomMsg(MESSAGES.WEEKEND_VIBES) : getRandomMsg(MESSAGES.LAST_HOUR_PUSH)
          } else if (count < 2) { 
              title = "💡 Quick Tip"
              message = `You have ${count} logins. Pick up the pace! Call your fresh leads now.`
          }

          if (message) {
              // Pass the tenant_id to the helper
              notificationsBatch.push({
                tenant_id: user.tenant_id,
                user_id: user.id,
                title: title,
                message: message,
                is_read: false,
                type: 'system',
                created_at: new Date().toISOString()
              })
          }
        }
        if (notificationsBatch.length > 0) {
          await sendNotificationsBatch(notificationsBatch)
          notificationsSent += notificationsBatch.length
        }
      }
    }

    console.log(`🏁 [CRON FINISHED] Sent ${notificationsSent} smart notifications.`)
    return NextResponse.json({ success: true, notifications_sent: notificationsSent })

  } catch (error: any) {
    console.error("❌ Notification Job Failed:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// --- HELPER: INSERT INTO DB (TENANT AWARE) ---
async function sendNotification(userId: string, tenantId: string, title: string, message: string) {
    const { error } = await supabaseAdmin.from('notifications').insert({
        tenant_id: tenantId, // 🔴 SECURE ISOLATION
        user_id: userId,
        title: title,
        message: message,
        is_read: false,
        type: 'system', 
        created_at: new Date().toISOString()
    })

    if (error) console.error("DB Insert Error", error)
}

async function sendNotificationsBatch(notifications: any[]) {
    if (!notifications || notifications.length === 0) return
    const { error } = await supabaseAdmin.from('notifications').insert(notifications)
    if (error) console.error("DB Batch Insert Error", error)
}
