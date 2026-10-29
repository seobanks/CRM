// app/api/debug/daily-report/route.ts
// 🔍 DIAGNOSTIC ENDPOINT — Shows exactly where the daily report is failing
// Access: GET /api/debug/daily-report?key=YOUR_CRON_SECRET

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const queryKey = searchParams.get('key')
  const secret = process.env.CRON_SECRET

  if (queryKey !== secret) {
    return NextResponse.json({ error: 'Unauthorized. Pass ?key=YOUR_CRON_SECRET' }, { status: 401 })
  }

  const report: Record<string, any> = {
    timestamp: new Date().toISOString(),
    steps: {}
  }

  // ── STEP 1: Check env variables ──────────────────────────────────
  report.steps.env_check = {
    RESEND_API_KEY: process.env.RESEND_API_KEY ? `✅ Set (starts with ${process.env.RESEND_API_KEY.substring(0, 6)}...)` : '❌ MISSING — emails cannot send!',
    CRON_SECRET: process.env.CRON_SECRET ? '✅ Set' : '❌ MISSING',
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ Set' : '❌ MISSING',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ MISSING',
  }

  // ── STEP 2: Test Supabase connection ──────────────────────────────
  let supabaseAdmin: any
  try {
    supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data, error } = await supabaseAdmin.from('organizations').select('id').limit(1)
    report.steps.supabase_connection = error
      ? `❌ Failed: ${error.message}`
      : `✅ Connected (found ${data?.length} org rows)`
  } catch (e: any) {
    report.steps.supabase_connection = `❌ Exception: ${e.message}`
    return NextResponse.json(report)
  }

  // ── STEP 3: Check tenant_settings for cron_daily_report enabled ──
  const { data: activeTenants, error: tenantError } = await supabaseAdmin
    .from('tenant_settings')
    .select('tenant_id, cron_daily_report')
    .eq('cron_daily_report', true)

  if (tenantError) {
    report.steps.tenant_settings = `❌ Query failed: ${tenantError.message}`
    return NextResponse.json(report)
  }

  report.steps.tenant_settings = activeTenants?.length > 0
    ? `✅ ${activeTenants.length} tenant(s) have daily reports enabled: ${activeTenants.map((t: any) => t.tenant_id).join(', ')}`
    : `⚠️ NO tenants have cron_daily_report = true! Go to Admin → Settings → enable Daily Reports.`

  if (!activeTenants || activeTenants.length === 0) {
    return NextResponse.json(report)
  }

  const enabledTenantIds = activeTenants.map((t: any) => t.tenant_id)

  // ── STEP 4: Check active users for those tenants ──────────────────
  const { data: allUsers, error: usersError } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name, role, tenant_id')
    .eq('is_active', true)
    .in('tenant_id', enabledTenantIds)

  if (usersError) {
    report.steps.users_fetch = `❌ Query failed: ${usersError.message}`
    return NextResponse.json(report)
  }

  const telecallers = allUsers?.filter((u: any) => u.role === 'telecaller') || []
  const admins = allUsers?.filter((u: any) =>
    ['admin', 'manager', 'team_leader', 'super_admin', 'tenant_admin'].includes(u.role)
  ) || []

  report.steps.users_fetch = {
    total_active_users: allUsers?.length || 0,
    telecallers: telecallers.map((u: any) => `${u.full_name} <${u.email}>`),
    admins: admins.map((u: any) => `${u.full_name} <${u.email}>`),
  }

  if (telecallers.length === 0) {
    report.steps.users_fetch.warning = '⚠️ No telecallers found — no one will receive a personal report!'
  }
  if (admins.length === 0) {
    report.steps.users_fetch.warning2 = '⚠️ No admin/manager users found — no one will receive the team summary!'
  }

  // ── STEP 5: Check yesterday's call logs ───────────────────────────
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const dateStr = yesterday.toISOString().split('T')[0]
  const startOfYesterday = `${dateStr}T00:00:00.000Z`
  const endOfYesterday = `${dateStr}T23:59:59.999Z`

  const staffIds = telecallers.map((u: any) => u.id)

  if (staffIds.length > 0) {
    const { data: calls, error: callsError } = await supabaseAdmin
      .from('call_logs')
      .select('user_id, call_status', { count: 'exact' })
      .in('tenant_id', enabledTenantIds)
      .in('user_id', staffIds)
      .in('call_type', ['outbound', 'outbound_c2c'])
      .gte('created_at', startOfYesterday)
      .lte('created_at', endOfYesterday)

    report.steps.call_logs_yesterday = callsError
      ? `❌ Query failed: ${callsError.message}`
      : `✅ Found ${calls?.length || 0} call log entries for ${dateStr}`
  } else {
    report.steps.call_logs_yesterday = '⏭️ Skipped — no telecallers to query'
  }

  // ── STEP 6: Test Resend by sending to Resend's official test sink ─
  // NOTE: domains.list() requires full API key. A send-only key gives 401 there.
  // So we test by actually sending to Resend's sink — this is the real test.
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { data, error: resendError } = await resend.emails.send({
      from: 'Hanva CRM <reports@crm.hanva.in>',
      to: 'delivered@resend.dev',  // Resend's official test sink - always safe
      subject: 'CRM Debug - Resend Connection Test',
      html: '<p>This is an automated connection test from Hanva CRM debug endpoint.</p>',
    })

    if (resendError) {
      report.steps.resend_api = `❌ Send FAILED: ${JSON.stringify(resendError)} — The domain crm.hanva.in is probably NOT verified in Resend, OR the API key is wrong.`
    } else {
      report.steps.resend_api = `✅ Resend can send emails! The domain crm.hanva.in IS verified. Test msg ID: ${data?.id}`
    }
  } catch (e: any) {
    report.steps.resend_api = `❌ Resend exception: ${e.message}`
  }

  // ── STEP 7: Check sender domain ───────────────────────────────────
  report.steps.sender_domain = {
    from_address: 'reports@crm.hanva.in',
    note: 'Make sure the domain crm.hanva.in is verified in your Resend dashboard under Domains. If not verified, all emails will silently fail.',
  }

  // ── STEP 8: Send a single test email to verify Resend works ──────
  const testRecipient = searchParams.get('test_email')
  if (testRecipient) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const { data, error } = await resend.emails.send({
        from: 'Hanva CRM <reports@crm.hanva.in>',
        to: testRecipient,
        subject: `🔍 Daily Report Debug Test — ${new Date().toLocaleString('en-IN')}`,
        html: `<h2>✅ Test Email from Hanva CRM</h2><p>If you received this, your Resend setup is working correctly and the daily report will send.</p><p>Sent at: ${new Date().toISOString()}</p>`,
      })
      report.steps.test_email_sent = error
        ? `❌ Send failed: ${JSON.stringify(error)}`
        : `✅ Test email sent to ${testRecipient}! Resend Msg ID: ${data?.id}`
    } catch (e: any) {
      report.steps.test_email_sent = `❌ Exception: ${e.message}`
    }
  } else {
    report.steps.test_email_sent = `ℹ️ Add &test_email=your@email.com to send a live test email`
  }

  // ── SUMMARY ───────────────────────────────────────────────────────
  report.summary = 'Check each step above. The first ❌ you see is the root cause of the issue.'
  report.cron_schedule = 'The cron runs at 0 2 * * * UTC = 7:30 AM IST every day.'
  report.vercel_logs = 'Also check: Vercel Dashboard → your project → Logs → Filter by "cron" to see past runs.'

  return NextResponse.json(report, { status: 200 })
}
