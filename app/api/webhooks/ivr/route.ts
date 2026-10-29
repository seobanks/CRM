// app/api/webhooks/ivr/route.ts
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sendStatusUpdateMessage } from "@/app/actions/whatsapp";
import { recordIvrLeadReceived } from "@/lib/ivr-tracker";

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key"
);

// --- 1. REALISTIC INDIAN NAME GENERATOR ---
const INDIAN_FIRST_NAMES = ["Siddharth", "Rohan", "Aditi", "Shreya", "Kunal", "Aarti", "Aditya", "Megha", "Vishal", "Kirti", "Prakash", "Vandana", "Nitin", "Priti", "Sameer", "Sweta", "Alok", "Pallavi", "Kamlesh", "Rupali", "Hemant", "Sonali", "Chetan", "Mahesh", "Geeta", "Rajendra", "Smita", "Sandeep", "Varsha", "Arvind", "Maya", "Tushar", "Neeta", "Dinesh", "Shilpa", "Harish", "Archana", "Gopal", "Nidhi", "Pradeep", "Rachna", "Pramod", "Kalpana", "Naveen", "Madhuri", "Kishor", "Sangeeta", "Jatin", "Lata", "Satish", "Varun", "Deepika", "Akhil", "Gauri", "Mayank", "Isha", "Swapnil", "Rutuja", "Vaibhav", "Nikita"];
const INDIAN_LAST_NAMES = ["Sharma", "Singh", "Kumar", "Das", "Patel", "Gupta", "Verma", "Jain", "Yadav", "Prasad", "Mishra", "Pandey", "Tiwari", "Chauhan", "Thakur", "Reddy", "Patil", "Deshmukh", "Kulkarni", "Joshi", "Menon", "Rao", "Iyer", "Nair", "Pillai", "Chatterjee", "Sengupta", "Banerjee", "Bose", "Dasgupta", "Bhattacharya", "Roy", "Sen", "Saha", "Nayak", "Biswas", "Chakraborty", "Mukherjee", "Agarwal", "Bansal", "Garg", "Mehta", "Choudhary", "Bhatia", "Gowda", "Naidu", "Chacko", "Babu", "Varghese", "Kurian"];

function getRandomIndianName() {
  return `${INDIAN_FIRST_NAMES[Math.floor(Math.random() * INDIAN_FIRST_NAMES.length)]} ${INDIAN_LAST_NAMES[Math.floor(Math.random() * INDIAN_LAST_NAMES.length)]}`;
}

// --- 2. IST TIMEZONE CALCULATOR ---
function getStartOfTodayIST() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(now.getTime() + istOffset);
  nowIST.setUTCHours(0, 0, 0, 0); 
  return new Date(nowIST.getTime() - istOffset).toISOString();
}

// --- 3. FAIR DISTRIBUTION HELPER FUNCTION (TENANT AWARE) ---
async function getFairAssigneeId(tenantId: string) {
    const startOfTodayISO = getStartOfTodayIST();

    const { data: attendanceData } = await supabaseAdmin
        .from("attendance")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .is("check_out", null)
        .gte("check_in", startOfTodayISO);

    const checkedInUserIds = attendanceData?.map(a => a.user_id) || [];
    if (checkedInUserIds.length === 0) return null;

    let { data: telecallers } = await supabaseAdmin
        .from("users")
        .select("id, full_name")
        .eq("tenant_id", tenantId)
        .in("role", ["telecaller", "agent", "user"]); 

    const activeTelecallers = (telecallers || []).filter(t => checkedInUserIds.includes(t.id));
    if (activeTelecallers.length === 0) return null;
        
    const { data: todaysLeads } = await supabaseAdmin
        .from("leads")
        .select("assigned_to")
        .eq("tenant_id", tenantId)
        .gte("created_at", startOfTodayISO); 

    const leadCounts: Record<string, number> = {};
    activeTelecallers.forEach(t => leadCounts[t.id] = 0); 

    if (todaysLeads) {
        todaysLeads.forEach(l => {
            if (l.assigned_to && leadCounts[l.assigned_to] !== undefined) leadCounts[l.assigned_to]++;
        });
    }

    const minLeads = Math.min(...Object.values(leadCounts));
    const eligibleTelecallers = activeTelecallers.filter(t => leadCounts[t.id] === minLeads);
    const winner = eligibleTelecallers[Math.floor(Math.random() * eligibleTelecallers.length)];
    
    return winner.id;
}
// ------------------------------------------

export async function POST(request: NextRequest) {
  // 🔴 1. AGGRESSIVE LOGGING: Log immediately before doing ANY processing!
  console.log("🚨 [IVR WEBHOOK HIT] Received POST request from external service.");
  
  try {
    const rawBody = await request.text();

    
    console.log("📦 [IVR RAW PAYLOAD]:", rawBody); // Force Vercel to print the exact raw string

    let body: any = {};
    
    // 💡 ROBUST PARSING ENGINE
    if (rawBody) {
      try { 
        const cleanedBody = rawBody.replace(/~/g, ',');
        body = JSON.parse(cleanedBody); 
      } catch(e) { 
        try {
            body = Object.fromEntries(new URLSearchParams(rawBody)); 
        } catch (fallbackErr) {
            console.error("❌ [IVR PARSE ERROR] Total parse failure:", rawBody);
            return NextResponse.json({ status: "error", message: "Invalid payload format" }, { status: 400 });
        }
      }
    }

    console.log("🧩 [IVR PARSED JSON]:", body); // Verify the parser actually worked

    // 💡 SECURE VARIABLE EXTRACTION
    const customerPhone = body.mobileNumber || body.mobile_number || body.phone;
    const digitsPressed = body.digitsPressed || body['digitsPressed=CDR.digitpressed'] || body.digits_pressed;
    const callDuration = body.callDuration || 0;
    const campaignName = body.campaignName || 'Auto-IVR';
    const disposition = body.disposition || 'UNKNOWN';
    
    // 🔴 EXTRACT TENANT ID
    let tenantId = body.tenantId || body.tenant || request.nextUrl.searchParams.get("tenant") || null;

    // ===== DID-BASED TENANT ROUTING (Secure auto-routing) =====
    const potentialDids = [
      body.did, body.DID, body.Did, body.DialDID, 
      body.calledNumber, body.called_number, 
      body.dnis, body.DNIS, 
      body.clid, body.caller_id, body.callerId,
      body.Destination, body.destination,
      body.CampaignName ? String(body.CampaignName).match(/\d{10}/)?.[0] : null,
      body.campaignName ? String(body.campaignName).match(/\d{10}/)?.[0] : null
    ].filter(Boolean).map(n => String(n).replace(/\D/g, '').slice(-10));

    const uniqueDids = Array.from(new Set(potentialDids)).filter(n => n.length === 10);

    let matchedDid: string | null = null;
    if (uniqueDids.length > 0) {
      const { data: didRecords } = await supabaseAdmin
        .from('tenant_did_registry')
        .select('tenant_id, did_number')
        .in('did_number', uniqueDids)
        .eq('is_active', true);
        
      if (didRecords && didRecords.length > 0) {
        tenantId = didRecords[0].tenant_id;
        matchedDid = didRecords[0].did_number;
        console.log(`✅ [IVR DID-ROUTE] Found matching DID ${didRecords[0].did_number} → tenant ${tenantId}`);
      } else {
        console.warn(`⚠️ [IVR DID-ROUTE] None of the potential DIDs (${uniqueDids.join(', ')}) were found in registry. Falling back to manual tenant param.`);
        matchedDid = uniqueDids[0] || null;
      }
    }
    // ===== END DID ROUTING =====

    console.log(`📞 Target Phone: ${customerPhone}, Tenant: ${tenantId}`);

    if (!customerPhone) {
        console.warn("⚠️ Ignored: No mobile number provided.");
        return NextResponse.json({ status: "ignored", reason: "no_mobile_number" });
    }
    
    if (!tenantId) {
        console.error("🚨 CRITICAL: IVR Webhook hit without a Tenant ID. Cannot securely route data.");
        return NextResponse.json({ status: "error", reason: "missing_tenant_id" }, { status: 400 });
    }

    let dbPhone = customerPhone.replace(/^\+?91/, '');
    if (dbPhone.length > 10) dbPhone = dbPhone.slice(-10);

    // ====================================================================
    // 🆕 IVR DIGIT-PRESS AUTO ASSIGN SYSTEM
    // If customer pressed ANY digit, immediately create/assign lead to the
    // most available checked-in agent. Can be paused from Admin > Settings.
    // ====================================================================
    if (digitsPressed !== null && digitsPressed !== undefined && String(digitsPressed).trim() !== '') {
        console.log(`🔢 [IVR DIGIT] Customer pressed: ${digitsPressed} for phone: ${dbPhone}`);

        const { data: tenantCfg } = await supabaseAdmin
            .from('tenant_settings')
            .select('ivr_digit_auto_assign')
            .eq('tenant_id', tenantId)
            .maybeSingle();

        const isEnabled = tenantCfg?.ivr_digit_auto_assign !== false; // ON by default

        if (isEnabled) {
            const agentId = await getFairAssigneeId(tenantId);

            const { data: existingLead } = await supabaseAdmin
                .from('leads')
                .select('id, notes, assigned_to, status')
                .eq('tenant_id', tenantId)
                .or(`phone.eq.${dbPhone},phone.eq.+91${dbPhone},phone.eq.91${dbPhone}`)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            const digitNote = `📞 [IVR] Customer pressed digit "${digitsPressed}" on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}. Campaign: ${campaignName}.`;

            if (existingLead) {
                const updatedNotes = existingLead.notes ? `${existingLead.notes}\n\n${digitNote}` : digitNote;
                const { error: updErr } = await supabaseAdmin.from('leads').update({
                    assigned_to: agentId,
                    status: 'new',
                    notes: updatedNotes,
                    last_contacted: new Date().toISOString()
                }).eq('id', existingLead.id);
                
                if (updErr) console.error("🚨 [IVR DIGIT] Update Error:", updErr);
                else {
                    console.log(`♻️ [IVR DIGIT] Re-assigned existing lead ${existingLead.id} to agent ${agentId}`);
                    
                    // Track lead arrival for IVR campaign upload status (pending -> running)
                    recordIvrLeadReceived(supabaseAdmin, tenantId, matchedDid).catch(err => {
                        console.error("[IVR DIGIT] Error tracking IVR lead status:", err);
                    });

                    if (tenantId) {
                        try {
                            const { data: org } = await supabaseAdmin.from('organizations').select('workflow_triggers').eq('id', tenantId).maybeSingle();
                            const triggers = org?.workflow_triggers || {};
                            const allowedDigit = triggers.ivr_dtmf_digit || 'any';
                            const cleanInput = String(digitsPressed).trim();
                            const cleanAllowed = String(allowedDigit).trim();
                            const matchesDigit = cleanAllowed === 'any' || cleanAllowed === cleanInput || cleanAllowed.split(',').map((d: string) => d.trim()).includes(cleanInput);

                            if (matchesDigit) {
                                await sendStatusUpdateMessage(existingLead.id, dbPhone, tenantId, triggers.ivr_dtmf_template, triggers.ivr_dtmf_campaign);
                            }
                        } catch (err: any) {
                            console.error("[IVR DIGIT] Failed to send auto WhatsApp:", err);
                        }
                    }
                }
            } else {
                const autoName = getRandomIndianName();
                const { data: newLeadData, error: insErr } = await supabaseAdmin.from('leads').insert({
                    tenant_id: tenantId,
                    name: autoName,
                    phone: dbPhone,
                    status: 'new',
                    notes: `🤖 [IVR Auto-Created]\n${digitNote}`,
                    assigned_to: agentId
                }).select('id').single();
                
                if (insErr) console.error("🚨 [IVR DIGIT] Insert Error:", insErr);
                else {
                    console.log(`✨ [IVR DIGIT] Created new lead for ${dbPhone} → agent ${agentId}`);
                    
                    // Track lead arrival for IVR campaign upload status (pending -> running)
                    recordIvrLeadReceived(supabaseAdmin, tenantId, matchedDid).catch(err => {
                        console.error("[IVR DIGIT] Error tracking IVR lead status:", err);
                    });

                    if (tenantId && newLeadData?.id) {
                        try {
                            const { data: org } = await supabaseAdmin.from('organizations').select('workflow_triggers').eq('id', tenantId).maybeSingle();
                            const triggers = org?.workflow_triggers || {};
                            const allowedDigit = triggers.ivr_dtmf_digit || 'any';
                            const cleanInput = String(digitsPressed).trim();
                            const cleanAllowed = String(allowedDigit).trim();
                            const matchesDigit = cleanAllowed === 'any' || cleanAllowed === cleanInput || cleanAllowed.split(',').map((d: string) => d.trim()).includes(cleanInput);

                            if (matchesDigit) {
                                await sendStatusUpdateMessage(newLeadData.id, dbPhone, tenantId, triggers.ivr_dtmf_template, triggers.ivr_dtmf_campaign);
                            }
                        } catch (err: any) {
                            console.error("[IVR DIGIT] Failed to send auto WhatsApp:", err);
                        }
                    }
                }
            }

            if (agentId) {
                await supabaseAdmin.from('notifications').insert({
                    user_id: agentId,
                    tenant_id: tenantId,
                    title: '📞 New IVR Lead Assigned',
                    message: `A customer pressed digit "${digitsPressed}" on IVR. Phone: ${dbPhone}. Follow up now!`,
                    read: false,
                    created_at: new Date().toISOString(),
                });
            }

            return NextResponse.json({ status: 'success', action: 'ivr_digit_lead_assigned', agent: agentId });
        } else {
            console.log(`⏸️ [IVR DIGIT] Auto-assign is PAUSED for tenant ${tenantId}. Continuing normal flow.`);
        }
    }
    // ====================================================================

    // 🔴 SEARCH FOR LEAD ONLY WITHIN THIS TENANT (original flow for no-digit calls)
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("id, notes, status")
      .eq("tenant_id", tenantId)
      .ilike("phone", `%${dbPhone}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const digitText = digitsPressed ? `Digit Pressed: **${digitsPressed}**` : "No digit pressed";
    const ivrNote = `🤖 [IVR Auto-Log | Campaign: ${campaignName}]\nStatus: ${disposition}\n${digitText}\nDuration: ${callDuration}s.`;

    if (lead) {
        const statusLower = (lead.status || "").toLowerCase();

        if (statusLower === "disbursed") {
            console.log("✅ Ignored: Lead already disbursed.");
            return NextResponse.json({ status: "success", message: "Ignored disbursed lead" });
        }

        const deadStatuses = ["dead_bucket", "not_interested", "nr", "recycle_pool", "not_eligible", "self_employed"];
        
        if (deadStatuses.includes(statusLower)) {
            const assignedToId = await getFairAssigneeId(tenantId); 
            const fakeName = getRandomIndianName();
            
            const { data: recLead } = await supabaseAdmin.from("leads").insert({
                tenant_id: tenantId,
                name: fakeName, 
                phone: dbPhone,
                status: "new",
                notes: `[Recycled from previous status: ${lead.status}]\n\n${ivrNote}`,
                assigned_to: assignedToId,
            }).select('id').single();

            if (tenantId === '576a6280-a9a2-425c-b1dd-eabfff3a00c6' && recLead?.id) {
                sendStatusUpdateMessage(recLead.id, dbPhone, tenantId).catch(err => {
                    console.error("[IVR Recycled] Failed to send auto WhatsApp:", err);
                });
            }

            console.log("♻️ Recycled dead lead as a new lead.");
            return NextResponse.json({ status: "success", message: "Recycled as new lead" });
        }

        const warmStatuses = ["interested", "documents_sent", "follow_up"];
        
        if (warmStatuses.includes(statusLower)) {
            const istDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
            const bumpNote = `\n\n🚨 Customer called IVR again on ${istDate}!`;
            const existingNotes = lead.notes ? `${lead.notes}\n\n${ivrNote}${bumpNote}` : `${ivrNote}${bumpNote}`;

            await supabaseAdmin.from("leads").update({ 
                status: "new",           
                notes: existingNotes,    
                last_contacted: new Date().toISOString() 
            }).eq("id", lead.id);

            console.log("🔥 Bumped warm lead back to new.");
            return NextResponse.json({ status: "success", message: "Warm lead bumped to New" });
        }

        const existingNotes = lead.notes ? `${lead.notes}\n\n${ivrNote}` : ivrNote;
        await supabaseAdmin.from("leads").update({ notes: existingNotes }).eq("id", lead.id);
        console.log("📝 Appended IVR note to existing lead.");

    } 
    else {
        const assignedToId = await getFairAssigneeId(tenantId);
        const fakeName = getRandomIndianName();

        const { data: brandNewLead } = await supabaseAdmin.from("leads").insert({
            tenant_id: tenantId,
            name: fakeName, 
            phone: dbPhone,
            status: "new",
            notes: ivrNote,
            assigned_to: assignedToId,
        }).select('id').single();

        if (tenantId === '576a6280-a9a2-425c-b1dd-eabfff3a00c6' && brandNewLead?.id) {
            sendStatusUpdateMessage(brandNewLead.id, dbPhone, tenantId).catch(err => {
                console.error("[IVR New Lead] Failed to send auto WhatsApp:", err);
            });
        }
        console.log("✨ Created brand new lead from IVR call.");
    }

    // 🔴 RECORD IN IVR_CALL_LOGS FOR ANALYTICS
    const batchId = body.batchId || body.batch_id || null;
    const clid = body.clid || body.caller_id || null;
    const hangupCause = body.hangupCause || null;
    const hangupCode = body.hangupCode || null;
    const answerDate = body.answerDate || null;
    
    // Calculate credits used if possible
    let creditsUsed = 0;
    if (disposition === 'ANSWERED') {
        creditsUsed = Math.ceil((parseInt(callDuration) || 0) / 60);
        if (creditsUsed === 0) creditsUsed = 1;
    }

    try {
        if (batchId && dbPhone) {
            const { data: existingLog } = await supabaseAdmin.from("ivr_call_logs")
                .select("id")
                .eq("batch_id", batchId)
                .eq("mobile_number", dbPhone)
                .eq("call_duration", parseInt(callDuration) || 0)
                .limit(1)
                .maybeSingle();

            if (existingLog) {
                console.log(`⚠️ [WEBHOOK] Duplicate CDR ignored for ${dbPhone} in Batch ${batchId}`);
                return NextResponse.json({ status: "success", message: "Duplicate CDR ignored" });
            }
        }

        await supabaseAdmin.from("ivr_call_logs").insert({
            tenant_id: tenantId,
            batch_id: batchId,
            mobile_number: dbPhone,
            disposition: disposition,
            call_duration: parseInt(callDuration) || 0,
            bill_seconds: parseInt(callDuration) || 0, 
            digits_pressed: digitsPressed ? String(digitsPressed) : null,
            credits_used: creditsUsed,
            hangup_cause: hangupCause,
            hangup_code: hangupCode,
            clid: clid,
            answer_date: answerDate ? new Date(answerDate).toISOString() : null,
            raw_payload: body,
        });
        console.log("📊 Logged call to ivr_call_logs for analytics.");
    } catch (logErr) {
        console.error("⚠️ Failed to log to ivr_call_logs (Analytics might be missing this call):", logErr);
    }

    return NextResponse.json({ status: "success", message: "IVR data processed securely" });

  } catch (error) {
    console.error("🔥 [CRITICAL ERROR] IVR Webhook failed:", error);
    return NextResponse.json({ status: "error", message: "Internal Server Error" }, { status: 500 });
  }
}

// 🔴 2. ALSO LOG GET REQUESTS (In case Fonada is configured wrong!)
export async function GET(request: NextRequest) {
  console.log("⚠️ [IVR WEBHOOK HIT] Received GET request. Fonada usually sends POST.");
  console.log("URL Parameters:", request.nextUrl.searchParams.toString());
  
  return NextResponse.json({ status: "success", message: "Multi-Tenant IVR Webhook is ready! (Note: Expected POST for data submission)" });
}
