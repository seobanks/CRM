// app/api/cron/daily-report/route.ts
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'

// --- CONFIGURATION ---
const resend = new Resend(process.env.RESEND_API_KEY || 're_mock_key_for_nextjs_build')
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key" // Admin client to fetch across all tenants
)

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Increase Vercel timeout to 60s (requires Pro plan)

// TARGETS
const TARGET_DAILY_CALLS = 350
const TARGET_DAILY_LOGINS = 3

// HELPER: Pause execution to prevent email rate limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// HELPER: Currency Formatter
const formatCurrency = (amount: number) => 
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)

// HELPER: Safe Number Parser (Fixes the concatenation issue)
const parseAmount = (value: any) => {
  if (!value) return 0;
  // Convert to string, remove commas/symbols, then parse to float
  const cleanString = String(value).replace(/[^0-9.-]+/g, "");
  const number = parseFloat(cleanString);
  return isNaN(number) ? 0 : number;
}

export async function GET(request: Request) {
  try {
    // 1. SECURITY CHECK
    const authHeader = request.headers.get('authorization')
    const { searchParams } = new URL(request.url)
    const queryKey = searchParams.get('key')
    const secret = process.env.CRON_SECRET

    if ((authHeader !== `Bearer ${secret}`) && (queryKey !== secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log("⏳ Starting Multi-Tenant Daily Report Job...")

    // 2. TIME CALCULATIONS
    const today = new Date()
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    
    // Dates
    const dateStr = yesterday.toISOString().split('T')[0] // YYYY-MM-DD
    const startOfYesterday = `${dateStr}T00:00:00.000Z`
    const endOfYesterday = `${dateStr}T23:59:59.999Z`

    // Monthly Range (For Revenue Targets)
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString()
    const totalDaysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
    const daysRemaining = Math.max(1, totalDaysInMonth - today.getDate())

    let emailsSent = 0

    // 🔴 3. FETCH TENANTS WITH DAILY REPORTS ENABLED
    const { data: activeTenants, error: tenantError } = await supabaseAdmin
      .from('tenant_settings')
      .select('tenant_id')
      .eq('cron_daily_report', true);

    if (tenantError) throw tenantError;

    if (!activeTenants || activeTenants.length === 0) {
      console.log("⏭️ [CRON] No tenants have daily reports enabled. Skipping.");
      return NextResponse.json({ message: 'No tenants have daily reports enabled.' });
    }

    const enabledTenantIds = activeTenants.map(t => t.tenant_id);

    // 🔴 4. FETCH ALL ACTIVE USERS (ONLY FOR OPTED-IN TENANTS)
    const { data: allUsers } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, role, tenant_id, monthly_target')
      .eq('is_active', true)
      .in('tenant_id', enabledTenantIds) // Strict Isolation Filter

    if (!allUsers || allUsers.length === 0) return NextResponse.json({ message: "No active users found in opted-in tenants" })

    // Group by Tenant (To strictly isolate data processing per company)
    const usersByTenant: Record<string, any[]> = {}
    allUsers.forEach(u => {
      if (!usersByTenant[u.tenant_id]) usersByTenant[u.tenant_id] = []
      usersByTenant[u.tenant_id].push(u)
    })

    // ============================================================
    // 5. PROCESS EACH TENANT SEPARATELY (ISOLATED EXECUTION)
    // ============================================================
    for (const tenantId of Object.keys(usersByTenant)) {
      console.log(`🏢 Processing reports for Tenant: ${tenantId}`);
      
      // 🔒 IDEMPOTENCY LOCK: Prevent duplicate emails if cron retries
      const { data: existingLock } = await supabaseAdmin
        .from('notifications')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('title', `Daily Report: ${dateStr}`)
        .limit(1)
        .maybeSingle();

      if (existingLock) {
        console.log(`⏭️ Reports already sent for Tenant ${tenantId} today. Skipping to prevent duplicates.`);
        continue;
      }

      const tenantUsers = usersByTenant[tenantId]
      
      // Identify Roles for this specific tenant
      const telecallers = tenantUsers.filter(u => u.role === 'telecaller')
      const admins = tenantUsers.filter(u => ['admin', 'manager', 'team_leader', 'super_admin', 'tenant_admin', 'marketing_manager', 'owner'].includes(u.role))
      
      const staffIds = telecallers.map(u => u.id)
      if (staffIds.length === 0) continue

      // A. FETCH RAW DATA FOR THIS TENANT ONLY
      // --------------------------------------
      
      // 1. Call Logs (Yesterday)
      const { data: calls } = await supabaseAdmin
        .from('call_logs')
        .select('user_id, duration_seconds, call_status')
        .eq('tenant_id', tenantId) // Ensure we only hit this tenant's logs
        .in('user_id', staffIds)
        .gte('created_at', startOfYesterday)
        .lte('created_at', endOfYesterday)

      // 2. Leads Updated Yesterday
      const { data: leadUpdates } = await supabaseAdmin
        .from('leads')
        .select('assigned_to, status')
        .eq('tenant_id', tenantId) // Ensure we only hit this tenant's leads
        .in('assigned_to', staffIds)
        .gte('updated_at', startOfYesterday)
        .lte('updated_at', endOfYesterday)

      // 3. Revenue (Month to Date)
      const { data: revenueLeads } = await supabaseAdmin
        .from('leads')
        .select('assigned_to, disbursed_amount, loan_amount')
        .eq('tenant_id', tenantId)
        .in('assigned_to', staffIds)
        .gte('updated_at', startOfMonth)
        .lte('updated_at', endOfMonth)
        .eq('status', 'Disbursed') // Ensure exact case match with your DB

      // B. AGGREGATE STATS
      // -----------------
      const statsMap: Record<string, any> = {}

      // Init Map
      telecallers.forEach(u => {
        statsMap[u.id] = {
          user: u,
          count: 0, duration: 0, nr: 0, callback: 0, interested: 0, 
          login: 0, notEligible: 0, notLogins: 0, notInterested: 0, DISBURSEDCount: 0,
          revenueAchieved: 0
        }
      })

      // Fill Calls
      calls?.forEach(c => {
        if(statsMap[c.user_id]) {
          statsMap[c.user_id].count++
          statsMap[c.user_id].duration += (c.duration_seconds || 0)
        }
      })

      // Fill Statuses
      leadUpdates?.forEach(l => {
        if(!statsMap[l.assigned_to]) return
        const s = statsMap[l.assigned_to]
        const status = l.status
        
        if (status === 'follow_up') s.callback++
        else if (['Interested', 'Documents_Sent'].includes(status)) s.interested++
        else if (['Login', 'Sent to Login'].includes(status)) s.login++
        else if (status === 'not_eligible') s.notEligible++
        else if (status === 'Not_Interested') s.notInterested++
        else if (['nr', 'Busy', 'RNR', 'Switched Off'].includes(status)) s.nr++
        else if (status === 'Disbursed' || status === 'DISBURSED') s.DISBURSEDCount++
      })

      // Fill Revenue
      revenueLeads?.forEach(l => {
        if(statsMap[l.assigned_to]) {
          const rawAmount = l.disbursed_amount || l.loan_amount;
          const cleanAmount = parseAmount(rawAmount);
          statsMap[l.assigned_to].revenueAchieved += cleanAmount;
        }
      })

      // Convert to Array & Sort
      const statsArray = Object.values(statsMap)
      
      // Revenue Leaderboard (For Ranking)
      const revenueSorted = [...statsArray].sort((a:any, b:any) => b.revenueAchieved - a.revenueAchieved)
      const topRevenuePerformer = revenueSorted[0] || { user: { full_name: "N/A" }, revenueAchieved: 0 }

      // Volume Leaderboard (For Admin Table)
      const volumeSorted = [...statsArray].sort((a:any, b:any) => b.count - a.count)


      // C. SEND EMAILS FOR THIS TENANT
      // ------------------------------

      let tenantEmailsSent = 0;

      // 1. Send "Performance Coach" to Telecallers
      for (const stat of statsArray) {
        const rank = revenueSorted.findIndex((s:any) => s.user.id === stat.user.id) + 1
        
        await sendTelecallerReport({
          recipient: stat.user,
          stats: stat,
          rank,
          totalStaff: revenueSorted.length,
          topPerformer: topRevenuePerformer,
          daysRemaining,
          dateStr
        })
        emailsSent++
        tenantEmailsSent++
        await delay(100) // Slight delay to respect Resend API limits
      }

      // 2. Send "Global Report" to Admins of THIS Tenant
      if (admins.length > 0) {
        const adminHTML = generateAdminHTML(volumeSorted, dateStr)
        
        for (const admin of admins) {
          const { data, error } = await resend.emails.send({
            from: 'Hanva CRM <reports@crm.hanva.in>',
            to: admin.email,
            subject: `📊 Workspace Daily Report - ${dateStr}`,
            html: adminHTML
          })
          
          if (error) {
            console.error(`❌ Failed to send admin report to ${admin.email}:`, error)
          } else {
            console.log(`✅ Admin report sent to ${admin.email}. Msg ID: ${data?.id}`)
          }
          emailsSent++
          tenantEmailsSent++
          await delay(100)
        }
      }

      // 🔒 SET IDEMPOTENCY LOCK: Record that this tenant's emails are done for today
      if (tenantEmailsSent > 0) {
        const firstUserId = admins[0]?.id || staffIds[0];
        await supabaseAdmin.from('notifications').insert({
          tenant_id: tenantId,
          user_id: firstUserId,
          title: `Daily Report: ${dateStr}`,
          message: `System successfully generated and sent ${tenantEmailsSent} daily performance emails.`,
          type: 'system',
          is_read: false,
          created_at: new Date().toISOString()
        });
      }

    } // End Tenant Loop

    console.log(`✅ [CRON FINISHED] Successfully sent ${emailsSent} report emails.`);
    return NextResponse.json({ success: true, emails_sent: emailsSent })

  } catch (error: any) {
    console.error("❌ Cron Job Failed:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}


// ==================================================================
// TEMPLATE 1: TELECALLER COACHING REPORT
// ==================================================================
async function sendTelecallerReport({ recipient, stats, rank, totalStaff, topPerformer, daysRemaining, dateStr }: any) {
  
  const target = parseAmount(recipient.monthly_target || 3000000)
  const gap = Math.max(0, target - stats.revenueAchieved)
  const dailyRequired = gap / daysRemaining
  
  let rankColor = '#f97316' 
  let rankMsg = "You're doing okay, keep pushing."
  if (rank === 1) { rankColor = '#22c55e'; rankMsg = "You are the CHAMPION! 🏆"; }
  else if (rank > (totalStaff * 0.66)) { rankColor = '#ef4444'; rankMsg = "You are in the danger zone."; }

  let coachBox = ''
  if (stats.count < TARGET_DAILY_CALLS) {
    coachBox = `
      <div style="border-left: 4px solid #ef4444; background: #fef2f2; padding: 10px; margin-bottom: 10px;">
        <strong style="color: #991b1b;">⚠️ Volume Alert:</strong> 
        You made <strong>${stats.count}</strong> calls yesterday. The target is <strong>${TARGET_DAILY_CALLS}</strong>. 
        High volume is the first step to success.
      </div>`
  } else if (stats.login < TARGET_DAILY_LOGINS) {
    coachBox = `
      <div style="border-left: 4px solid #f97316; background: #fff7ed; padding: 10px; margin-bottom: 10px;">
        <strong style="color: #9a3412;">⚠️ Conversion Alert:</strong> 
        Good volume (${stats.count}), but only <strong>${stats.login}</strong> logins. Focus on closing today.
      </div>`
  } else {
    coachBox = `
      <div style="border-left: 4px solid #22c55e; background: #f0fdf4; padding: 10px; margin-bottom: 10px;">
        <strong style="color: #166534;">✅ Excellent Work:</strong> 
        You hit your targets! Keep this momentum going.
      </div>`
  }

  const progressPercent = Math.min(100, (stats.revenueAchieved / target) * 100)

  const html = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; background: #fff; border: 1px solid #eee; border-radius: 8px;">
        
        <div style="text-align: center; background: #1e3a8a; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">Daily Performance Coach</h2>
          <p style="margin: 5px 0 0; opacity: 0.8;">${dateStr}</p>
        </div>

        <div style="padding: 20px;">
          
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="margin: 0; font-size: 42px; color: ${rankColor};">#${rank}</h1>
            <p style="margin: 0; font-weight: bold; color: ${rankColor};">${rankMsg}</p>
            <p style="font-size: 12px; color: #999;">Workspace Rank (Revenue)</p>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; text-align: center;">
              <p style="font-size: 11px; color: #666; margin: 0;">Calls (Target: ${TARGET_DAILY_CALLS})</p>
              <p style="font-size: 20px; font-weight: bold; margin: 5px 0; color: ${stats.count >= TARGET_DAILY_CALLS ? '#22c55e' : '#ef4444'}">
                ${stats.count}
              </p>
            </div>
            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; text-align: center;">
              <p style="font-size: 11px; color: #666; margin: 0;">Logins (Target: ${TARGET_DAILY_LOGINS})</p>
              <p style="font-size: 20px; font-weight: bold; margin: 5px 0; color: ${stats.login >= TARGET_DAILY_LOGINS ? '#22c55e' : '#ef4444'}">
                ${stats.login}
              </p>
            </div>
          </div>

          <h3 style="font-size: 14px; text-transform: uppercase; color: #999; margin-bottom: 10px;">🛡️ Coach's Analysis</h3>
          
          ${coachBox}

          <div style="margin-top: 30px;">
            <h3 style="font-size: 14px; text-transform: uppercase; color: #999; margin-bottom: 10px;">💰 Revenue Target</h3>
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px;">
              <span>Achieved: ${formatCurrency(stats.revenueAchieved)}</span>
              <span>Target: ${formatCurrency(target)}</span>
            </div>
            <div style="width: 100%; background: #e2e8f0; height: 12px; border-radius: 6px; overflow: hidden;">
              <div style="width: ${progressPercent}%; background: #2563eb; height: 100%;"></div>
            </div>
            
            <div style="background: #eff6ff; padding: 10px; margin-top: 10px; border-radius: 5px; font-size: 13px; color: #1e40af;">
               To hit your target, you need <strong>${formatCurrency(dailyRequired)}</strong> in disbursement <strong>every day</strong> for the remaining ${daysRemaining} days.
            </div>
          </div>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center;">
            <p>Top Performer Today: <strong>${topPerformer.user.full_name}</strong> (${formatCurrency(topPerformer.revenueAchieved)})</p>
            Keep pushing! 🚀
          </div>

        </div>
      </div>
  `

  const { data, error } = await resend.emails.send({
    from: 'Hanva CRM <reports@crm.hanva.in>', 
    to: recipient.email,
    subject: `🎯 Performance Coach - ${dateStr}`,
    html: html
  })

  if (error) {
    console.error(`❌ Failed to send telecaller report to ${recipient.email}:`, error)
  } else {
    console.log(`✅ Telecaller report sent to ${recipient.email}. Msg ID: ${data?.id}`)
  }
}


// ==================================================================
// TEMPLATE 2: ADMIN GLOBAL REPORT (Pivot Table)
// ==================================================================
function generateAdminHTML(sortedStats: any[], dateStr: string) {
  
  const total = { count: 0, nr: 0, callback: 0, interested: 0, login: 0, notEligible: 0, notInterested: 0, DISBURSED: 0, duration: 0 }
  
  sortedStats.forEach(s => {
    total.count += s.count
    total.nr += s.nr
    total.callback += s.callback
    total.interested += s.interested
    total.login += s.login
    total.notEligible += s.notEligible
    total.notInterested += s.notInterested
    total.DISBURSED += s.DISBURSEDCount
    total.duration += s.duration
  })

  const rowsHTML = sortedStats.map((s, index) => {
    const totalUsers = sortedStats.length
    
    let countStyle = 'padding: 8px; font-weight: bold;'
    if (s.count === 0) countStyle += 'background-color: #fee2e2; color: #991b1b;' 
    else if (index < totalUsers / 3) countStyle += 'background-color: #dcfce7; color: #166534;' 
    else if (index < (totalUsers * 2) / 3) countStyle += 'background-color: #ffedd5; color: #9a3412;' 
    else countStyle += 'background-color: #fee2e2; color: #991b1b;' 

    return `
    <tr style="border-bottom: 1px solid #eee; text-align: center; color: #333;">
      <td style="padding: 8px; text-align: left; font-weight: 500;">${s.user.full_name}</td>
      <td style="${countStyle}">${s.count}</td>
      <td style="padding: 8px;">${s.nr}</td>
      <td style="padding: 8px;">${s.callback}</td>
      <td style="padding: 8px;">${s.interested}</td>
      <td style="padding: 8px;">${s.login}</td>
      <td style="padding: 8px;">${s.notEligible}</td>
      <td style="padding: 8px;">${s.notInterested}</td>
      <td style="padding: 8px;">${s.DISBURSEDCount}</td>
      <td style="padding: 8px;">${(s.duration / 60).toFixed(1)} m</td>
    </tr>`
  }).join('')

  return `
      <div style="font-family: Arial, sans-serif; font-size: 12px; color: #333; overflow-x: auto;">
        <h2 style="color: #1e3a8a;">Workspace Daily Report (${dateStr})</h2>
        <p>Sorted by call volume (High to Low).</p>
        
        <table style="width: 100%; border-collapse: collapse; min-width: 800px;">
          <thead>
            <tr style="background-color: #1e3a8a; color: white; text-align: center;">
              <th style="padding: 10px; text-align: left;">User</th>
              <th style="padding: 10px;">Count</th>
              <th style="padding: 10px;" title="NR, Busy, RNR, Switched Off">NR/RNR</th>
              <th style="padding: 10px;">Callback</th>
              <th style="padding: 10px;" title="Interested + Docs Pending">Inter.</th>
              <th style="padding: 10px;" title="Login + Sent to Login">Logged</th>
              <th style="padding: 10px;">Not Elg.</th>
              <th style="padding: 10px;">Not Int.</th>
              <th style="padding: 10px;">Disb.</th>
              <th style="padding: 10px;">Dur.</th>
            </tr>
          </thead>
          <tbody>
            
            <tr style="background-color: #e0f2fe; font-weight: bold; text-align: center; border-bottom: 2px solid #1e40af;">
              <td style="padding: 10px; text-align: left;">All (Total)</td>
              <td style="padding: 10px;">${total.count}</td>
              <td style="padding: 10px;">${total.nr}</td>
              <td style="padding: 10px;">${total.callback}</td>
              <td style="padding: 10px;">${total.interested}</td>
              <td style="padding: 10px;">${total.login}</td>
              <td style="padding: 10px;">${total.notEligible}</td>
              <td style="padding: 10px;">${total.notInterested}</td>
              <td style="padding: 10px;">${total.DISBURSED}</td>
              <td style="padding: 10px;">${(total.duration / 60).toFixed(1)} m</td>
            </tr>
  
            ${rowsHTML}

          </tbody>
        </table>
        
        <div style="margin-top: 15px; font-size: 11px;">
           <span style="display:inline-block; width: 10px; height: 10px; background: #dcfce7; border: 1px solid #166534; margin-right: 5px;"></span> High Activity
           <span style="display:inline-block; width: 10px; height: 10px; background: #ffedd5; border: 1px solid #9a3412; margin-right: 5px; margin-left: 10px;"></span> Medium
           <span style="display:inline-block; width: 10px; height: 10px; background: #fee2e2; border: 1px solid #991b1b; margin-right: 5px; margin-left: 10px;"></span> Low
        </div>
      </div>
  `
}
