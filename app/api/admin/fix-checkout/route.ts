import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const istDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const badTime = `${istDateStr}T19:00:00`; 
    const goodTime = `${istDateStr}T19:00:00+05:30`;

    // Find all attendance records checked out at the bad time
    const { data: badRecords, error: fetchError } = await supabaseAdmin
      .from('attendance')
      .select('*')
      .eq('date', istDateStr)
      .eq('check_out', badTime);

    if (fetchError) throw fetchError;

    if (!badRecords || badRecords.length === 0) {
      return NextResponse.json({ message: "No corrupted checkouts found." });
    }

    // Fix them
    for (const record of badRecords) {
      await supabaseAdmin
        .from('attendance')
        .update({ check_out: goodTime })
        .eq('id', record.id);
    }

    return NextResponse.json({ 
      success: true, 
      message: `Fixed ${badRecords.length} records to 7:00 PM IST.`
    });

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
