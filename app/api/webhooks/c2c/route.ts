import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

// ⚠️ Use Service Role key to bypass RLS since Webhooks have no logged-in user
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key"
);

export async function POST(request: NextRequest) {
  console.log("🔔 [C2C WEBHOOK HIT] Call ended, analyzing CDR data.");

  try {
    const rawBody = await request.text();
    let body: any = {};
    if (rawBody) {
      try { body = JSON.parse(rawBody); } 
      catch(e) { body = Object.fromEntries(new URLSearchParams(rawBody)); }
    }

    console.log("📋 [C2C PAYLOAD (RAW)]:", body);

    // 🔴 1. THE BULLETPROOF FIX: Convert all keys to lowercase to ignore Hanva's capitalization quirks
    const safeBody: any = {};
    for (const key in body) {
        if (body.hasOwnProperty(key)) {
            safeBody[key.toLowerCase()] = body[key];
        }
    }

    // 2. EXTRACT FIELDS USING THE LOWERCASE KEYS
    const customerPhone = safeBody.customernumber || safeBody.dst || null;
    const agentPhone = safeBody.agentnumber || safeBody.src || null;
    
    // Duration is total time including ringing
    const duration = parseInt(safeBody.duration || "0");
    
    // Extract ACTUAL customer talk time for accurate billing
    const billsec = parseInt(safeBody.customerbillsec || safeBody.totalbillsec || safeBody.billsec || "0");
    
    const recordingUrl = safeBody.recordinglink || safeBody.recordingurl || null;
    const agentDisposition = (safeBody.agentdisposition || safeBody.agenthangupcause || "").toUpperCase();
    const customerDisposition = (safeBody.customerdisposition || safeBody.disposition || "UNKNOWN").toUpperCase();

    if (!agentPhone) {
      return NextResponse.json({ status: "ignored", reason: "Missing agent phone" });
    }

    let dbAgentPhone = agentPhone.replace(/^\+?91/, '').slice(-10);

    // 3. SMART LOOKUP: Find the agent to get their Tenant ID
    const { data: agent } = await supabaseAdmin
        .from("users")
        .select("id, tenant_id")
        .ilike("phone", `%${dbAgentPhone}%`)
        .limit(1)
        .maybeSingle();

    if (!agent || !agent.tenant_id) {
      console.error(`🚨 [SECURITY WARNING] Agent not found for phone: ${dbAgentPhone}`);
      return NextResponse.json({ status: "ignored", reason: "agent_or_tenant_not_found" });
    }

    const tenantId = agent.tenant_id;

    // If the Agent didn't pick up, the call ends immediately (No charge)
    if (["FAILED", "BUSY", "NO ANSWER", "CANCEL"].includes(agentDisposition.trim())) {
        await supabaseAdmin.from("users").update({
            current_status: 'wrap_up',
            status_reason: `Agent Leg: ${agentDisposition}`,
            status_updated_at: new Date().toISOString()
        }).eq("id", agent.id);

        return NextResponse.json({ status: "success", message: "Agent leg failed, no charge." });
    }

    let dbCustomerPhone = customerPhone ? customerPhone.replace(/^\+?91/, '').slice(-10) : null;
    let finalLeadId = null;

    if (dbCustomerPhone) {
        // Find the lead inside this specific company
        const { data: leads } = await supabaseAdmin
            .from("leads")
            .select("id")
            .eq("tenant_id", tenantId) 
            .ilike("phone", `%${dbCustomerPhone}%`)
            .eq("assigned_to", agent.id) 
            .order("last_contacted", { ascending: false }) 
            .limit(1);

        finalLeadId = leads?.[0]?.id;

        // Fallback search
        if (!finalLeadId) {
            const { data: fallbackLead } = await supabaseAdmin
                .from("leads")
                .select("id")
                .eq("tenant_id", tenantId) 
                .ilike("phone", `%${dbCustomerPhone}%`)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
            finalLeadId = fallbackLead?.id;
        }
    }

    if (finalLeadId) {
        // 🔴 3. INSERT CALL LOG
        const { data: callLog, error: logError } = await supabaseAdmin.from("call_logs").insert({
            tenant_id: tenantId, 
            lead_id: finalLeadId,
            user_id: agent.id,
            call_type: "outbound_c2c",
            call_status: "completed",
            duration_seconds: duration,
            disposition: customerDisposition, 
            recording_url: recordingUrl,
            notes: `C2C Call. Customer Status: ${customerDisposition}. Talk Time: ${billsec}s.`
        }).select().single();

        if (logError) {
            console.error("🚨 [DB ERROR] Call Log Insert Failed! Wallet deduction blocked to prevent ghost charges.", logError);
        }

        // 🔴 4. DYNAMIC CREDIT DEDUCTION (UPDATED)
        // Removed the strict "ANSWERED" check. If there are billable seconds, it will deduct.
        let totalCreditsToDeduct = 0;

        if (billsec > 0 && callLog) {
            const { data: settings } = await supabaseAdmin.from('tenant_settings')
                .select('billing_pulse_seconds, credits_per_pulse')
                .eq('tenant_id', tenantId)
                .maybeSingle();

            const pulseSecs = settings?.billing_pulse_seconds || 15;
            const creditsPerPulse = settings?.credits_per_pulse || 1;

            const pulses = Math.ceil(billsec / pulseSecs); 
            totalCreditsToDeduct = pulses * creditsPerPulse;

            // Deduct from Ledger
            const { error: ledgerError } = await supabaseAdmin.from("wallet_ledger").insert({
                tenant_id: tenantId,
                credits: -Math.abs(totalCreditsToDeduct), 
                transaction_type: 'C2C_CALL',
                description: `C2C Call to ${dbCustomerPhone} (Status: ${customerDisposition}, Talk Time: ${billsec}s = ${pulses} pulses)`,
                reference_id: callLog.id
            });

            // Save the billing data back to the Call Log for fast reporting
            await supabaseAdmin.from("call_logs").update({ 
                talk_time_seconds: billsec, 
                credits_used: totalCreditsToDeduct 
            }).eq("id", callLog.id);

            if (ledgerError) {
                 console.error("🚨 [LEDGER ERROR] Failed to deduct credits:", ledgerError);
            } else {
                 console.log(`🪙 [WALLET] Deducted ${totalCreditsToDeduct} credits from Tenant ${tenantId}`);
            }
            
        } else {
            console.log(`⏩ [WALLET] Skipped Deduction. BillSec: ${billsec}, Disposition: '${customerDisposition}', CallLog Saved: ${!!callLog}`);
        }

        // 5. SHORT CALL LOGIC
        if (billsec < 5 || ["NO ANSWER", "FAILED", "BUSY", "CANCEL"].includes(customerDisposition.trim())) {
             await supabaseAdmin.from('leads').update({ status: 'nr' }).eq('id', finalLeadId);
             await supabaseAdmin.from("users").update({
                 current_status: 'active', 
                 status_reason: 'Auto-Skipped NR', 
                 status_updated_at: new Date().toISOString()
             }).eq("id", agent.id);
             return NextResponse.json({ status: "success", message: "Short/Unanswered call auto-marked NR." });
        }
    }

    // Normal Call Wrap-up (> 5 seconds of talk time AND answered)
    await supabaseAdmin.from("users").update({
        current_status: 'wrap_up', 
        status_reason: 'Call Completed', 
        status_updated_at: new Date().toISOString()
    }).eq("id", agent.id);

    return NextResponse.json({ status: "success", message: "C2C Call logged & billed securely." });

  } catch (error) {
    console.error("🔥 [CRITICAL ERROR] C2C Webhook failed:", error);
    return NextResponse.json({ status: "error", message: "Internal Server Error" }, { status: 500 });
  }
}
