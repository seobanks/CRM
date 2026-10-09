import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { differenceInMinutes, parseISO } from 'date-fns';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // 1. CRON SECURITY
    const authHeader = request.headers.get('authorization');
    const { searchParams } = new URL(request.url);
    const queryKey = searchParams.get('key');
    const secret = process.env.CRON_SECRET;

    if (process.env.NODE_ENV !== 'development' && authHeader !== `Bearer ${secret}` && queryKey !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log("⏱️ [CRON] Running Multi-Tenant Auto-Checkout...");

    // Initialize Admin Client to bypass RLS for background jobs
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const istDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const today = istDateStr; // e.g., '2026-10-08'
    // Append +05:30 so Supabase knows it means 7:00 PM IST, not 7:00 PM UTC (which is 12:30 AM IST).
    const autoCheckoutTimeStr = `${today}T19:00:00+05:30`; 
    const autoCheckoutDate = new Date(autoCheckoutTimeStr);

    // 🔴 2. FETCH ALL ACTIVE SESSIONS FOR TODAY (IST)
    const { data: activeSessions, error: fetchError } = await supabaseAdmin
      .from('attendance')
      .select('*')
      .eq('date', today)
      .not('check_in', 'is', null)
      .is('check_out', null);

    if (fetchError) throw fetchError;

    if (!activeSessions || activeSessions.length === 0) {
      console.log(`✅ [CRON] No active sessions found to auto-checkout for date: ${today}`);
      return NextResponse.json({ message: 'No active sessions found to auto-checkout.' });
    }

    // 🔴 3. FETCH OPTED-OUT TENANTS
    // By default (or if settings don't exist), auto-checkout is TRUE. We only skip those explicitly set to FALSE.
    const { data: optedOutTenants, error: tenantError } = await supabaseAdmin
      .from('tenant_settings')
      .select('tenant_id')
      .eq('cron_auto_checkout', false);

    const optedOutIds = optedOutTenants?.map(t => t.tenant_id) || [];

    // Filter sessions
    const sessionsToCheckout = activeSessions.filter(s => !optedOutIds.includes(s.tenant_id));

    if (sessionsToCheckout.length === 0) {
      console.log("⏭️ [CRON] Active sessions exist, but all belong to tenants who opted out of auto-checkout.");
      return NextResponse.json({ message: 'All active sessions belong to opted-out tenants.' });
    }

    console.log(`⚠️ [CRON] Auto-checking out ${sessionsToCheckout.length} users...`);

    // 4. PROCESS CHECKOUTS (Connection Pool Protected)
    const chunkSize = 15;
    for (let i = 0; i < sessionsToCheckout.length; i += chunkSize) {
      const chunk = sessionsToCheckout.slice(i, i + chunkSize);
      const chunkPromises = chunk.map(async (session) => {
        const checkInDate = new Date(session.check_in);
        
        let totalMinutes = differenceInMinutes(autoCheckoutDate, checkInDate);
        let breakMinutes = 0;

        if (session.lunch_start && session.lunch_end) {
          breakMinutes = differenceInMinutes(parseISO(session.lunch_end), parseISO(session.lunch_start));
        } else if (session.lunch_start && !session.lunch_end) {
          breakMinutes = differenceInMinutes(autoCheckoutDate, parseISO(session.lunch_start));
          await supabaseAdmin.from('attendance')
              .update({ lunch_end: autoCheckoutTimeStr })
              .eq('id', session.id);
        }

        const workingMinutes = Math.max(0, totalMinutes - breakMinutes);
        const hours = Math.floor(workingMinutes / 60);
        const mins = workingMinutes % 60;
        const totalHoursStr = `${hours}:${mins.toString().padStart(2, '0')}`;

        const existingNotes = session.notes ? session.notes + '\n' : '';
        const autoNote = "System: Auto-checked out at 7:00 PM";

        // 🔴 EXTRA ISOLATION SAFETY: Match both ID and Tenant ID on the update
        await supabaseAdmin
          .from('attendance')
          .update({
            check_out: autoCheckoutTimeStr,
            total_hours: totalHoursStr,
            status: 'present',
            notes: existingNotes + autoNote,
            updated_at: new Date().toISOString()
          })
          .eq('id', session.id)
          .eq('tenant_id', session.tenant_id); 
      });
      await Promise.all(chunkPromises);
    }

    console.log(`🏁 [CRON FINISHED] Successfully checked out ${sessionsToCheckout.length} employees.`);
    
    return NextResponse.json({ 
      success: true, 
      message: `Auto-checked out ${sessionsToCheckout.length} employees across opted-in workspaces.`,
      users_affected: sessionsToCheckout.length
    });

  } catch (error) {
    console.error("🔥 [CRON ERROR] Auto-checkout failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
