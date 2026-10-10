import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendStatusUpdateMessage } from '@/app/actions/whatsapp'

// Helper to lazy-load the Supabase Admin Client to bypass RLS for webhooks
// This prevents Next.js build-time errors when env variables are missing during static analysis.
const getSupabaseAdmin = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  )
}

export async function POST(req: Request) {
    return handleWebhook(req);
}

export async function GET(req: Request) {
    return handleWebhook(req);
}

async function handleWebhook(req: Request) {
  try {
    const url = new URL(req.url);
    const searchParams = url.searchParams;

    console.warn('\n======================================');
    console.warn(`[Ozonetel Webhook] Incoming ${req.method} request to ${url.pathname}`);
    console.warn(`[Ozonetel Webhook] Search Params:`, searchParams.toString());

    let bodyData: any = {};
    if (req.method === 'POST') {
      const contentType = req.headers.get('content-type') || '';
      console.warn(`[Ozonetel Webhook] Content-Type:`, contentType);
      
      if (contentType.includes('application/json')) {
        try {
          bodyData = await req.json();
          console.warn(`[Ozonetel Webhook] Parsed JSON Body:`, JSON.stringify(bodyData, null, 2));
        } catch (e) {
          console.error(`[Ozonetel Webhook] JSON parse error:`, e);
        }
      } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
        try {
          const formData = await req.formData();
          formData.forEach((value, key) => {
            bodyData[key] = value.toString();
          });
          console.warn(`[Ozonetel Webhook] Parsed FormData Body:`, JSON.stringify(bodyData, null, 2));
        } catch (e) {
          console.error(`[Ozonetel Webhook] FormData parse error:`, e);
        }
      }
    }

    // Ozonetel Voice Callback sends data inside a stringified JSON in the 'data' form field
    if (bodyData.data && typeof bodyData.data === 'string') {
      try {
        const parsed = JSON.parse(bodyData.data);
        if (Array.isArray(parsed)) {
          bodyData = { ...bodyData, ...(parsed[0] || {}) };
        } else if (parsed && typeof parsed === 'object') {
          bodyData = { ...bodyData, ...parsed };
        }
        console.warn(`[Ozonetel Webhook] Extracted payload from stringified 'data' field:`, bodyData);
      } catch (e) {
        console.error(`[Ozonetel Webhook] Error parsing nested data JSON:`, e);
      }
    }

    const getParam = (key: string) => searchParams.get(key) || bodyData[key] || '';
    
    // 0. API Key Verification
    const expectedApiKey = process.env.CLOUDCONNECT_WEBHOOK_SECRET || 'HANVA_OZT_7X9Q2P4L';
    const providedApiKey = getParam('api_key') || getParam('Apikey') || req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');

    console.warn(`[Ozonetel Webhook] Provided API Key: ${providedApiKey ? '***' + providedApiKey.slice(-4) : 'None'}`);

    

    if (providedApiKey !== expectedApiKey && expectedApiKey !== 'HANVA_OZT_7X9Q2P4L') {
        if (providedApiKey !== 'HANVA_OZT_7X9Q2P4L') {
            console.error(`[Ozonetel Webhook] Unauthorized (Invalid API Key)`);
            return NextResponse.json({ error: 'Unauthorized: Invalid API Key' }, { status: 401 });
        }
    } else if (providedApiKey !== expectedApiKey) {
        console.error(`[Ozonetel Webhook] Unauthorized (Invalid API Key)`);
        return NextResponse.json({ error: 'Unauthorized: Invalid API Key' }, { status: 401 });
    }

    // Ping / Verification check (e.g. if testing from Postman or webhook setup without call details)
    const hasCallData = getParam('uuid') || getParam('CallUUID') || getParam('call_uuid') || getParam('monitorUCID') || getParam('UCID') || getParam('CallID') || getParam('caller_number') || getParam('CallerID') || getParam('CustomerNumber') || getParam('cid');
    if (!hasCallData) {
        console.warn(`[Ozonetel Webhook] Ping success (No call data found, just verification).`);
        return NextResponse.json({ 
            success: true, 
            message: 'API key verified successfully. Webhook endpoint is active and ready to receive call events.' 
        });
    }
    
    // Parse Payload (Supports query params, JSON body, or form data)
    const uuid = getParam('uuid') || getParam('CallUUID') || getParam('call_uuid') || getParam('monitorUCID') || getParam('UCID') || getParam('CallID') || getParam('DataUniqueId') || `call_${Date.now()}`;
    const extensionNumber = getParam('extension_number') || getParam('agent_id') || getParam('AgentID') || getParam('AgentPhoneNumber') || getParam('PhoneName') || '';
    const callerNumber = getParam('caller_number') || getParam('CallerID') || getParam('CustomerNumber') || getParam('caller_id') || getParam('cid') || getParam('PhoneNumber') || getParam('DialedNumber') || '';
    const callStatus = getParam('call_status') || getParam('Status') || getParam('status') || getParam('DialStatus') || getParam('CustomerStatus') || ''; 
    const callDirection = getParam('call_direction') || getParam('Direction') || getParam('direction') || getParam('Type') || 'inbound';
    const rawDuration = getParam('call_duration') || getParam('CallDuration') || getParam('Duration') || getParam('duration') || '0';
    const dtmfInput = getParam('dtmf_input') || getParam('digit') || getParam('AudioInput') || getParam('Input') || '';
    const recordingUrl = getParam('recording_url') || getParam('AudioFile') || getParam('RecordingUrl') || '';

    // =========================================================================
    // SPAM & LOAD PREVENTION: Drop intermediate/noisy events IMMEDIATELY
    // =========================================================================
    // We KEEP "ringing" (or "ring") because it's required for Agent Screen Pops.
    // We KEEP "completed" or "hangup" for IVR feedback processing.
    // NOTE: If dtmfInput is present, we NEVER ignore the webhook, regardless of status.
    const IGNORED_STATUSES = ['dial', 'dialing', 'progress', 'in-progress', 'initiated', 'queued', 'on call', 'on-call', 'up', 'answered'];
    if (IGNORED_STATUSES.includes(callStatus.toLowerCase()) && !dtmfInput) {
        console.warn(`[Ozonetel Webhook] Dropping intermediate/spammy status instantly: ${callStatus}`);
        return NextResponse.json({ success: true, message: `Ignored status: ${callStatus}` });
    }

    console.warn(`[Ozonetel Webhook] Extracted Values -> UUID: ${uuid}, Caller: ${callerNumber}, Ext: ${extensionNumber}, Status: ${callStatus}, DTMF: ${dtmfInput}, Duration: ${rawDuration}`);

    // Convert duration like "00:01:20" or "80" to seconds
    const parseDurationSeconds = (val: string): number => {
      if (!val) return 0;
      if (val.includes(':')) {
        const parts = val.split(':').map(p => parseInt(p, 10) || 0);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
      }
      return parseInt(val, 10) || 0;
    };
    const callDurationSeconds = parseDurationSeconds(rawDuration);

    if (!callerNumber) {
        return NextResponse.json({ error: 'Missing required parameter: caller_number / CallerID' }, { status: 400 });
    }

        const supabaseAdmin = getSupabaseAdmin();
    
        let TARGET_IVR_TENANT_ID = getParam('tenant') || getParam('tenantId') || getParam('tenant_id') || null;

        // ===== PRIORITY 1: Extract Tenant UUID directly from CampaignName =====
        // Campaign name format: IVRBlast_7965373445_576a6280-a9a2-425c-b1dd-eabfff3a00c6
        const campaignName = getParam('CampaignName') || getParam('campaignName') || '';
        const uuidFromCampaign = campaignName.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
        if (uuidFromCampaign) {
            TARGET_IVR_TENANT_ID = uuidFromCampaign;
            console.warn(`✅ [CloudConnect CAMPAIGN-ROUTE] Extracted tenant UUID from CampaignName: ${uuidFromCampaign}`);
        } else {
            console.warn(`🔍 [CloudConnect] No UUID in CampaignName ("${campaignName}"), will try DID registry...`);
        }
        // ===== END CAMPAIGN UUID ROUTING =====

        // ===== DID-BASED TENANT ROUTING =====
        const potentialDids = [
            getParam('did'), getParam('DID'), getParam('Did'), getParam('DialDID'),
            getParam('calledNumber'), getParam('called_number'),
            getParam('dnis'), getParam('DNIS'),
            getParam('clid'), getParam('caller_id'), getParam('CallerID'),
            getParam('Destination'), getParam('destination'), getParam('DialedNumber'),
            getParam('CampaignName') ? getParam('CampaignName').match(/\d{10}/)?.[0] : null
        ].filter(Boolean).map(n => String(n).replace(/\D/g, '').slice(-10));

        const uniqueDids = Array.from(new Set(potentialDids)).filter(n => n.length === 10);

        console.warn(`🔍 [DID-DEBUG] potentialDids raw:`, potentialDids);
        console.warn(`🔍 [DID-DEBUG] uniqueDids (10-digit):`, uniqueDids);
        console.warn(`🔍 [DID-DEBUG] Did param:`, getParam('Did'));
        console.warn(`🔍 [DID-DEBUG] DialDID param:`, getParam('DialDID'));
        console.warn(`🔍 [DID-DEBUG] CampaignName:`, getParam('CampaignName'));
        console.warn(`🔍 [DID-DEBUG] Initial TARGET_IVR_TENANT_ID:`, TARGET_IVR_TENANT_ID);

        if (uniqueDids.length > 0) {
            const { data: didRecords, error: didError } = await supabaseAdmin
                .from('tenant_did_registry')
                .select('tenant_id, did_number')
                .in('did_number', uniqueDids)
                .eq('is_active', true);
            
            console.warn(`🔍 [DID-DEBUG] Registry query result:`, JSON.stringify(didRecords));
            console.warn(`🔍 [DID-DEBUG] Registry query error:`, didError);

            if (didRecords && didRecords.length > 0) {
                TARGET_IVR_TENANT_ID = didRecords[0].tenant_id;
                console.warn(`✅ [CloudConnect DID-ROUTE] Found matching DID ${didRecords[0].did_number} → tenant ${TARGET_IVR_TENANT_ID}`);
            } else {
                console.warn(`⚠️ [CloudConnect DID-ROUTE] None of the potential DIDs (${uniqueDids.join(', ')}) were found in registry. Falling back to default tenant.`);
                // Show all DIDs currently in registry for comparison
                const { data: allDids } = await supabaseAdmin.from('tenant_did_registry').select('did_number, tenant_id, is_active');
                console.warn(`🔍 [DID-DEBUG] All DIDs in registry:`, JSON.stringify(allDids));
            }
        } else {
            console.warn(`⚠️ [DID-DEBUG] No 10-digit DIDs found to query!`);
        }
        // ===== END DID ROUTING =====

        // ===== FALLBACK: Agent Extension Routing =====
        if (!TARGET_IVR_TENANT_ID && extensionNumber) {
            const cleanExt = extensionNumber.replace(/^\+?\d{1,3}/, '').slice(-10);
            const { data: matchingUsers } = await supabaseAdmin
                .from('users')
                .select('tenant_id')
                .ilike('phone', `%${cleanExt}%`)
                .limit(1);
                
            if (matchingUsers && matchingUsers.length > 0) {
                TARGET_IVR_TENANT_ID = matchingUsers[0].tenant_id;
                console.warn(`✅ [CloudConnect AGENT-ROUTE] Resolved tenant ${TARGET_IVR_TENANT_ID} from agent extension ${cleanExt}`);
            }
        }
        // ===== END AGENT EXTENSION ROUTING =====

        if (!TARGET_IVR_TENANT_ID) {
            console.error(`🚨 CRITICAL: CloudConnect Webhook hit without a Tenant ID. Ext:${extensionNumber}, Camp:${campaignName}, DID:${getParam('did')}. Rejecting.`);
            return NextResponse.json({ status: "error", message: "tenant_id is required" }, { status: 400 });
        }

    // 1. Find the Lead
    // Format the number to get the last 10 digits for better matching
    const cleanNumber = callerNumber.replace(/^\+?\d{1,3}/, '').slice(-10); 
    console.warn(`[Ozonetel Webhook] Searching for Lead with phone containing: ${cleanNumber}`);
    
    const { data: leads } = await supabaseAdmin
        .from('leads')
        .select('id, name, company, phone, status, tenant_id, assigned_to')
        .ilike('phone', `%${cleanNumber}%`)
        .eq('tenant_id', TARGET_IVR_TENANT_ID)
        .limit(1);

    let lead = leads?.[0];
    if (lead) {
        console.warn(`[Ozonetel Webhook] Found existing lead: ID ${lead.id}, Status ${lead.status}, Assigned To: ${lead.assigned_to}`);
    } else {
        console.warn(`[Ozonetel Webhook] No existing lead found for ${cleanNumber}`);
    }

    // Try to resolve the agent from extensionNumber immediately
    let matchedAgentId = null;
    if (extensionNumber) {
        const cleanExt = extensionNumber.replace(/^\+?\d{1,3}/, '').slice(-10);
        const { data: matchingUsers } = await supabaseAdmin
            .from('users')
            .select('id, tenant_id, phone')
            .ilike('phone', `%${cleanExt}%`)
            .limit(1);
            
        if (matchingUsers && matchingUsers.length > 0) {
            matchedAgentId = matchingUsers[0].id;
        }
    }

    // If no lead exists but we got DTMF, create one & assign
    if (!lead && dtmfInput) {
        console.warn(`[Ozonetel Webhook] Auto-creating DTMF Lead for phone: ${callerNumber}, digit: ${dtmfInput}`);
        let targetAgentId = null;
        let targetTenantId = null;

        // 1. Try to find the specific agent who was on the call (via extensionNumber/AgentPhoneNumber)
        if (extensionNumber) {
            const cleanExt = extensionNumber.replace(/^\+?\d{1,3}/, '').slice(-10);
            const { data: matchingUsers } = await supabaseAdmin
                .from('users')
                .select('id, tenant_id, phone')
                .ilike('phone', `%${cleanExt}%`)
                .limit(1);
                
            if (matchingUsers && matchingUsers.length > 0) {
                targetAgentId = matchingUsers[0].id;
                targetTenantId = matchingUsers[0].tenant_id;
                console.warn(`[Ozonetel Webhook] Matched specific agent by extension: ${targetAgentId}`);
            }
        }

        

        // 2. Fallback: If no specific agent matched, find a random active/checked-in agent in the target tenant
        if (!targetAgentId) {
            console.warn(`[Ozonetel Webhook] No specific agent found, falling back to random attendance selection for tenant ${TARGET_IVR_TENANT_ID}.`);
            const maxShiftStart = new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString();
            const { data: attendanceData } = await supabaseAdmin
                .from("attendance")
                .select("user_id, tenant_id")
                .eq("tenant_id", TARGET_IVR_TENANT_ID)
                .gte("check_in", maxShiftStart)
                .is("check_out", null);
                
            if (attendanceData && attendanceData.length > 0) {
                const randomAgent = attendanceData[Math.floor(Math.random() * attendanceData.length)];
                targetAgentId = randomAgent.user_id;
                targetTenantId = randomAgent.tenant_id;
                console.warn(`[Ozonetel Webhook] Selected random active agent: ${targetAgentId}`);
            } else {
                console.warn(`[Ozonetel Webhook] No active agents found in target tenant attendance to assign lead.`);
            }
        }
            
        const newLeadStatus = 'new'; // Always 'new' as requested, regardless of digit
        
        const newLeadData: any = {
            name: `New Lead (IVR ${callerNumber})`,
            phone: callerNumber,
            status: newLeadStatus,
        };

        if (targetAgentId) {
            newLeadData.assigned_to = targetAgentId;
            newLeadData.tenant_id = targetTenantId;
        } else {
            // Fallback: Assign directly to the target tenant even if no agent is available
            newLeadData.tenant_id = TARGET_IVR_TENANT_ID;
        }

        console.warn(`[Ozonetel Webhook] Inserting new lead:`, newLeadData);

        const { data: createdLead, error: createError } = await supabaseAdmin
            .from('leads')
            .insert([newLeadData])
            .select('id, name, company, phone, status, tenant_id, assigned_to')
            .single();

        if (createdLead) {
            console.warn(`[Ozonetel Webhook] Successfully created Lead ID: ${createdLead.id}`);
            lead = createdLead;
            
            // Broadcast a popup specifically for the agent who just got assigned this brand-new lead!
            if (targetAgentId) {
                console.warn(`[Ozonetel Webhook] Broadcasting DTMF auto-assign SCREEN_POP for agent: ${targetAgentId}`);
                const channel = supabaseAdmin.channel('cloudconnect_events');
                await channel.send({
                    type: 'broadcast',
                    event: 'SCREEN_POP',
                    payload: {
                        call_uuid: uuid,
                        extension: extensionNumber,
                        target_agent_id: targetAgentId,
                        caller_number: callerNumber,
                        direction: callDirection,
                        lead: lead,
                        is_dtmf_auto_assign: true
                    }
                });
            }

            // 🚀 FIRE WHATSAPP STATUS UPDATE TEMPLATE IMMEDIATELY
            console.warn(`[Ozonetel Webhook] Firing WhatsApp 'status_update' for new DTMF lead: ${callerNumber}`);
            // We don't await this so it doesn't block the webhook response
            sendStatusUpdateMessage(createdLead.id, callerNumber, createdLead.tenant_id).catch(err => {
                console.error("[Ozonetel Webhook] Failed to send WhatsApp status update:", err);
            });

        } else {
            console.error("Failed to create new DTMF lead:", createError);
        }
    }

    // 2. Handle RINGING (Screen Pop)
    const isRinging = callStatus.toLowerCase() === 'ring' || callStatus.toLowerCase() === 'ringing';
    if (isRinging) {
        console.warn(`[Ozonetel Webhook] Processing Ringing event for screen pop.`);
        let ringAgentId = null;
        
        // Try to identify which agent's screen should pop based on the extension/phone provided
        if (extensionNumber) {
            const cleanExt = extensionNumber.replace(/^\+?\d{1,3}/, '').slice(-10);
            const { data: ringUsers } = await supabaseAdmin.from('users').select('id').ilike('phone', `%${cleanExt}%`).limit(1);
            if (ringUsers && ringUsers.length > 0) {
                ringAgentId = ringUsers[0].id;
                console.warn(`[Ozonetel Webhook] Identified agent ${ringAgentId} for Ring screen pop.`);
            } else {
                console.warn(`[Ozonetel Webhook] Could not find agent for extension ${cleanExt} for Ring screen pop.`);
            }
        }

        const payload = {
            call_uuid: uuid,
            extension: extensionNumber,
            target_agent_id: ringAgentId,
            caller_number: callerNumber,
            direction: callDirection,
            lead: lead || null, 
        };

        // Broadcast to Supabase Realtime channel
        console.warn(`[Ozonetel Webhook] Broadcasting normal SCREEN_POP event with payload:`, JSON.stringify(payload));
        const channel = supabaseAdmin.channel('cloudconnect_events');
        await channel.send({
            type: 'broadcast',
            event: 'SCREEN_POP',
            payload: payload
        });
        
        console.warn(`[Ozonetel Webhook] Ringing event broadcasted successfully.`);
        return NextResponse.json({ success: true, message: 'Ringing event broadcasted' });
    }

    // 3. Handle Completed Call / Callback Log (Hangup, Answered, NotAnswered, etc.)
    if (!isRinging) {
        console.warn(`[Ozonetel Webhook] Processing end-of-call log saving. Status: ${callStatus}`);
        const { data: existingLog } = await supabaseAdmin
            .from('call_logs')
            .select('id')
            .eq('cloudconnect_uuid', uuid)
            .single();

        let callLogUserId = matchedAgentId || (lead?.assigned_to) || null;

        const logData: any = {
            cloudconnect_uuid: uuid,
            tenant_id: lead?.tenant_id || TARGET_IVR_TENANT_ID,
            call_type: callDirection.toLowerCase() || 'inbound',
            call_status: (callStatus || 'completed').toLowerCase(),
            duration_seconds: callDurationSeconds,
            notes: `Ozonetel Call (${callStatus || 'Completed'}). Agent: ${extensionNumber}`,
        };

        if (callLogUserId) {
            logData.user_id = callLogUserId;
        }

        if (recordingUrl) {
            logData.recording_url = recordingUrl;
            logData.notes += ` | Recording: ${recordingUrl}`;
        }

        if (dtmfInput) {
            logData.notes += ` | DTMF Input: ${dtmfInput}`;
        }

        if (lead?.id) {
            logData.lead_id = lead.id;
            console.warn(`[Ozonetel Webhook] Attaching call log to Lead ID: ${lead.id}`);
        } else {
            console.warn(`[Ozonetel Webhook] No lead found to attach this call log to.`);
        }

        if (existingLog) {
            console.warn(`[Ozonetel Webhook] Updating existing call log ID: ${existingLog.id}`);
            const { error: updateError } = await supabaseAdmin.from('call_logs').update(logData).eq('id', existingLog.id);
            if (updateError) console.error(`[Ozonetel Webhook] Error updating call log:`, updateError);
        } else {
            if (!callLogUserId) {
                console.warn(`[Ozonetel Webhook] Skipping call_logs insert because user_id is required and no agent was matched.`);
                return NextResponse.json({ success: true, message: 'Call processed but skipped call_logs insert (No Agent)' });
            }
            console.warn(`[Ozonetel Webhook] Inserting new call log.`);
            const { error: insertError } = await supabaseAdmin.from('call_logs').insert([logData]);
            if (insertError) console.error(`[Ozonetel Webhook] Error inserting call log:`, insertError);
        }

        console.warn(`[Ozonetel Webhook] Finished processing successfully.`);
        return NextResponse.json({ success: true, message: 'Call log saved' });
    }

    console.warn(`[Ozonetel Webhook] Event ignored (no matching conditions).`);
    return NextResponse.json({ success: true, message: 'Event ignored' });

  } catch (error: any) {
    console.error('[Ozonetel Webhook] Critical Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
