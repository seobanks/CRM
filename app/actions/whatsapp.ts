// app/actions/whatsapp.ts
"use server"

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// In-memory cache for WABA Number -> Fonada Account ID
const WABA_ACCOUNT_CACHE = new Map<string, { accountId: string; timestamp: number }>();

// Fast-path known mappings from your connected WhatsApp accounts
const KNOWN_WABA_ACCOUNTS: Record<string, string> = {
  '8217354172': '8f523000-07f1-4bf0-b7f0-286baef186e1', // Bankscart (+918217354172 - template: application_status_update)
  '7965995763': '9f0fef20-cc75-49d4-bfee-20513268cad8', // Bankscart (+917965995763 - template: application_status_update)
  '7965590263': 'c6f20bca-6523-4a99-8c29-5835a49161a0', // Bankscart (+917965590263)
  '7965590268': '0077dbbe-4a99-48ae-8a44-6b75f8f47469', // Bankscart (+917965590268)
  '7965590267': '0510bc1d-a89c-4cf6-9ee3-1eb76e4b765c', // Bankscart (+917965590267)
  '7965590266': '52b4deea-f393-42e5-ba8c-e7979eeed2ef', // Bankscart (+917965590266)
  '7965590265': '9cdd0a8d-6e00-4044-88bf-c56c620d0b8a', // Bankscart (+917965590265)
  '7965590264': '8c54ce91-7dec-475b-9027-0f497e3d5281', // Bankscart (+917965590264)
  '7965373459': '78c079e7-c500-4678-99c4-1ac8b51d5637', // Hanva (+917965373459)
};

export async function resolveFonadaAccountId(bearerToken: string, wabaNumber?: string): Promise<string> {
  const cleanWaba = (wabaNumber || '').replace(/\D/g, '').slice(-10);
  
  if (cleanWaba && KNOWN_WABA_ACCOUNTS[cleanWaba]) {
    return KNOWN_WABA_ACCOUNTS[cleanWaba];
  }

  const cached = WABA_ACCOUNT_CACHE.get(cleanWaba);
  if (cached && Date.now() - cached.timestamp < 3600000) {
    return cached.accountId;
  }

  try {
    const res = await fetch("https://app.fonada.ai/functions/v1/whatsapp_templates", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${bearerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "list_accounts" })
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.data?.accounts)) {
      for (const acc of data.data.accounts) {
        const accPhone = (acc.business_phone_number || '').replace(/\D/g, '').slice(-10);
        if (accPhone) {
          WABA_ACCOUNT_CACHE.set(accPhone, { accountId: acc.id, timestamp: Date.now() });
          if (cleanWaba && accPhone === cleanWaba) {
            return acc.id;
          }
        }
      }
      const bankscartAcc = data.data.accounts.find((a: any) => 
        (a.business_phone_number || '').includes('8217354172') || 
        (a.display_name || '').toLowerCase().includes('bankscart')
      );
      if (bankscartAcc) return bankscartAcc.id;
    }
  } catch (err) {
    console.error("Error resolving Fonada account ID:", err);
  }

  return process.env.FONADA_WHATSAPP_ACCOUNT_ID || "8f523000-07f1-4bf0-b7f0-286baef186e1";
}

// Helper to fetch tenant settings securely
async function getTenantWaCredentials(tenantId: string | null) {
  let fonadaUser = process.env.FONADA_USERID || "bankscart";
  let fonadaPass = process.env.FONADA_PASSWORD || "zfsWTyKw";
  let fonadaWaba = process.env.FONADA_WABA_NUMBER || "918217354172";
  let whatsappApiKey = process.env.FONADA_WHATSAPP_BEARER_TOKEN || "fsk_fa674b9a167787e48b2b29f48939a4570fe02efc1a4ec012c9f60bacc76bc250";
  let accountId = process.env.FONADA_WHATSAPP_ACCOUNT_ID || "8f523000-07f1-4bf0-b7f0-286baef186e1";

  let targetTenantId = tenantId;
  if (!targetTenantId) {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('users').select('tenant_id').eq('id', user.id).maybeSingle();
        if (profile?.tenant_id) targetTenantId = profile.tenant_id;
      }
    } catch (e) {
      // Ignore auth errors if calling from background context without session
    }
  }

  if (targetTenantId) {
    const supabaseAdmin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    let { data: settings } = await supabaseAdmin
      .from('tenant_settings')
      .select('fonada_userid, fonada_password, fonada_waba_number, whatsapp_api_key, wa_userid, wa_password, wa_waba_number')
      .eq('tenant_id', targetTenantId)
      .maybeSingle();
      
    // Fallback: If this tenant has NO credentials, grab the first tenant that DOES
    if (!settings?.fonada_waba_number && !settings?.whatsapp_api_key && !settings?.fonada_userid) {
      const { data: fallbackSettings } = await supabaseAdmin
        .from('tenant_settings')
        .select('fonada_userid, fonada_password, fonada_waba_number, whatsapp_api_key, wa_userid, wa_password, wa_waba_number')
        .not('fonada_waba_number', 'is', null)
        .limit(1)
        .maybeSingle();
        
      if (fallbackSettings) {
        settings = fallbackSettings;
      }
    }
    
    const actualUser = settings?.fonada_userid || settings?.wa_userid;
    const actualPass = settings?.fonada_password || settings?.wa_password;
    const actualWaba = settings?.fonada_waba_number || settings?.wa_waba_number;

    if (actualUser) fonadaUser = actualUser;
    if (actualPass) fonadaPass = actualPass;
    if (actualWaba) fonadaWaba = actualWaba;
    if (settings?.whatsapp_api_key) whatsappApiKey = settings.whatsapp_api_key;
  }

  // Resolve matching account ID for this WABA number
  accountId = await resolveFonadaAccountId(whatsappApiKey, fonadaWaba);

  return { fonadaUser, fonadaPass, fonadaWaba, whatsappApiKey, accountId };
}

// Unified helper to send WhatsApp messages using modern Fonada AI message sender with SendMsgOld fallback
async function sendViaFonadaOldApi(creds: any, phone: string, text: string) {
  let safePhone = phone.replace(/^\+/, '');
  if (safePhone.length === 10) safePhone = `91${safePhone}`;

  const bearerToken = creds.whatsappApiKey || process.env.FONADA_WHATSAPP_BEARER_TOKEN || "fsk_fa674b9a167787e48b2b29f48939a4570fe02efc1a4ec012c9f60bacc76bc250";
  const accountId = creds.accountId || await resolveFonadaAccountId(bearerToken, creds.fonadaWaba);

  // 1. Primary: Fonada AI Message Sender API
  try {
    const aiUrl = "https://app.fonada.ai/functions/v1/whatsapp_message_sender";
    const res = await fetch(aiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${bearerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        account_id: accountId,
        to: safePhone,
        message: {
          type: "text",
          text: {
            body: text
          }
        }
      })
    });

    const data = await res.json();
    if (res.ok && !data.error) {
      const msgId = data?.data?.message_id || data?.id || data?.message_id || `msg_${Date.now()}`;
      console.log(`✅ [FONADA AI] Message sent successfully to ${safePhone}. ID: ${msgId}`);
      return { safePhone, msgId };
    }
    console.warn(`⚠️ [FONADA AI] Message sender responded with:`, data?.error || res.statusText, "Trying fallback...");
  } catch (err: any) {
    console.warn(`⚠️ [FONADA AI] Sender exception:`, err.message, "Trying fallback...");
  }

  // 2. Legacy Fallback: waba.fonada.com/api/SendMsgOld
  if (creds.fonadaUser && creds.fonadaPass) {
    const apiUrl = "https://waba.fonada.com/api/SendMsgOld";
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const formData = new FormData();
    formData.append("userid", creds.fonadaUser);
    formData.append("password", creds.fonadaPass);
    formData.append("wabaNumber", creds.fonadaWaba || "917965373459");
    formData.append("mobile", safePhone); 
    formData.append("msg", text);
    formData.append("msgType", "text");
    formData.append("sendMethod", "quick");
    formData.append("output", "json");

    const res = await fetch(apiUrl, { method: "POST", body: formData });
    const data = await res.json();

    if (data.status === "error" || data.error) {
      throw new Error(data.message || data.error || "Fonada API Error");
    }
    return { safePhone, msgId: data.msgId || null };
  }

  return { safePhone, msgId: `msg_${Date.now()}` };
}

// Unified helper to send WhatsApp Templates using Fonada AI Direct Message Sender with Campaign Creator fallback
async function sendTemplateViaFonadaApi(
  creds: any, 
  phone: string, 
  templateName: string, 
  buttonsPayload?: string, 
  bodyVariables?: string[], 
  customCampaignName?: string,
  mediaUrl?: string
) {
  let safePhone = phone.replace(/^\+/, '');
  if (safePhone.length === 10) safePhone = `91${safePhone}`;

  const bearerToken = creds.whatsappApiKey || process.env.FONADA_WHATSAPP_BEARER_TOKEN || "fsk_fa674b9a167787e48b2b29f48939a4570fe02efc1a4ec012c9f60bacc76bc250";
  const accountId = creds.accountId || await resolveFonadaAccountId(bearerToken, creds.fonadaWaba);

  // 1. Primary: Direct Real-Time WhatsApp Message Sender with Template Type (Sub-500ms Instant Dispatch)
  try {
    const senderUrl = "https://app.fonada.ai/functions/v1/whatsapp_message_sender";
    const templatePayload: any = {
      name: templateName,
      language: { code: "en" }
    };
    const components: any[] = [];
    if (mediaUrl) {
      components.push({
        type: "header",
        parameters: [{ type: "image", image: { link: mediaUrl } }]
      });
    }
    if (bodyVariables && bodyVariables.length > 0) {
      components.push({
        type: "body",
        parameters: bodyVariables.map(v => ({ type: "text", text: String(v) }))
      });
    }
    if (components.length > 0) {
      templatePayload.components = components;
    }

    const res = await fetch(senderUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${bearerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        account_id: accountId,
        to: safePhone,
        message: {
          type: "template",
          template: templatePayload
        }
      })
    });

    const data = await res.json();
    if (res.ok && data.success && (data.data?.message_id || data.data?.status === 'sent')) {
      const msgId = data.data?.message_id || `fonada_${Date.now()}`;
      console.log(`✅ [FONADA AI DIRECT] Template '${templateName}' dispatched instantly to ${safePhone}. Message ID: ${msgId}`);
      return { safePhone, msgId };
    }
    console.warn(`⚠️ [FONADA AI DIRECT] Direct template dispatch returned:`, data?.error || data, "Trying campaign creator...");
  } catch (err: any) {
    console.warn(`⚠️ [FONADA AI DIRECT] Exception:`, err.message, "Trying campaign creator...");
  }

  // Build audience row variables (BODY_1, BODY_2, etc.) matching campaign creator schema
  const audienceRow: Record<string, string> = {
    phone: safePhone,
    Phone: safePhone,
  };
  if (mediaUrl) {
    audienceRow["media_url"] = mediaUrl;
  }
  if (bodyVariables && bodyVariables.length > 0) {
    bodyVariables.forEach((val, idx) => {
      audienceRow[`BODY_${idx + 1}`] = String(val);
    });
  }

  // 2. Secondary: Fonada AI Campaign Creator API
  try {
    const campaignUrl = "https://app.fonada.ai/functions/v1/whatsapp_campaign_creator";
    const res = await fetch(campaignUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${bearerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        campaign_name: `${customCampaignName || 'crm'}_${safePhone}_${Date.now()}`,
        template_name: templateName,
        account_id: accountId,
        check_duplicate: false,
        audience_rows: [audienceRow]
      })
    });

    const data = await res.json();
    if (res.ok && (data.success || data.campaign_id)) {
      console.log(`✅ [FONADA AI CAMPAIGN] Template campaign dispatched successfully. Campaign ID: ${data.campaign_id}`);
      return { safePhone, msgId: data.campaign_id || `cmp_${Date.now()}` };
    }
    console.warn(`⚠️ [FONADA AI CAMPAIGN] Template send failed:`, data?.error || res.statusText, "Trying fallback...");
  } catch (err: any) {
    console.warn(`⚠️ [FONADA AI CAMPAIGN] Campaign creator exception:`, err.message, "Trying fallback...");
  }

  // 2. Fallback: waba.fonada.com/api/SendMsg/template
  if (creds.fonadaUser && creds.fonadaPass) {
    const apiUrl = "https://waba.fonada.com/api/SendMsg/template";
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const formData = new URLSearchParams();
    formData.append("mobile", safePhone);
    formData.append("wabaNumber", creds.fonadaWaba || "917965373459");
    formData.append("campaignName", customCampaignName || "StatusUpdateAlert");
    formData.append("templateName", templateName);
    
    if (buttonsPayload) {
      formData.append("buttonsPayload", buttonsPayload);
    }
    
    if (bodyVariables && bodyVariables.length > 0) {
      formData.append("bodyVariables", JSON.stringify(bodyVariables));
    }

    const authHeader = "Basic " + Buffer.from(`${creds.fonadaUser}:${creds.fonadaPass}`).toString('base64');

    const res = await fetch(apiUrl, { 
      method: "POST", 
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formData.toString() 
    });
    
    const data = await res.json();
    if (data.status === "error" || data.error) {
      throw new Error(data.message || data.error || "Fonada Template API Error");
    }
    return { safePhone, msgId: data.msgId || null };
  }

  return { safePhone, msgId: `cmp_${Date.now()}` };
}

// ============================================================================
// FETCH ALL APPROVED WHATSAPP TEMPLATES FROM FONADA AI
// ============================================================================
export async function getApprovedWhatsAppTemplates(tenantId?: string | null) {
  try {
    const creds = await getTenantWaCredentials(tenantId || null);
    const bearerToken = creds.whatsappApiKey || process.env.FONADA_WHATSAPP_BEARER_TOKEN || "fsk_fa674b9a167787e48b2b29f48939a4570fe02efc1a4ec012c9f60bacc76bc250";
    const accountId = creds.accountId || "8f523000-07f1-4bf0-b7f0-286baef186e1";

    const res = await fetch("https://app.fonada.ai/functions/v1/whatsapp_templates", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${bearerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ account_id: accountId })
    });

    const data = await res.json();
    if (res.ok && data.success && data.data?.templates) {
      return { success: true, templates: data.data.templates };
    }
    return { success: false, error: data?.error || "Failed to fetch templates", templates: [] };
  } catch (err: any) {
    console.error("Error fetching approved WhatsApp templates:", err);
    return { success: false, error: err.message, templates: [] };
  }
}

// ============================================================================
// FETCH ALL WHATSAPP CAMPAIGNS FROM FONADA AI / WHATSAPP API
// ============================================================================
export async function getWhatsAppCampaignsList(tenantId?: string | null) {
  try {
    const creds = await getTenantWaCredentials(tenantId || null);
    const bearerToken = creds.whatsappApiKey || process.env.FONADA_WHATSAPP_BEARER_TOKEN || "fsk_fa674b9a167787e48b2b29f48939a4570fe02efc1a4ec012c9f60bacc76bc250";
    const accountId = creds.accountId || "8f523000-07f1-4bf0-b7f0-286baef186e1";

    const res = await fetch("https://app.fonada.ai/functions/v1/whatsapp_campaigns_list", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${bearerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ account_id: accountId, limit: 50 })
    });

    const data = await res.json();
    if (res.ok && data.success && Array.isArray(data.data)) {
      const campaigns = data.data.map((c: any) => ({
        id: c.id,
        campaign_name: c.campaign_name,
        template_name: c.whatsapp_platform_templates?.template_name || "",
        category: c.whatsapp_platform_templates?.category || "",
        status: c.status || "ACTIVE",
        created_at: c.created_at
      }));
      return { success: true, campaigns };
    }
    return { success: false, error: data?.error || "Failed to fetch campaigns", campaigns: [] };
  } catch (err: any) {
    console.error("Error fetching WhatsApp campaigns list:", err);
    return { success: false, error: err.message, campaigns: [] };
  }
}

// ============================================================================
// FETCH ALL CONNECTED WHATSAPP ACCOUNTS / PHONE NUMBERS FROM FONADA AI
// ============================================================================
export async function getWhatsAppAccountsList(tenantId?: string | null) {
  try {
    const creds = await getTenantWaCredentials(tenantId || null);
    const bearerToken = creds.whatsappApiKey || process.env.FONADA_WHATSAPP_BEARER_TOKEN || "fsk_fa674b9a167787e48b2b29f48939a4570fe02efc1a4ec012c9f60bacc76bc250";

    const res = await fetch("https://app.fonada.ai/functions/v1/whatsapp_templates", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${bearerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "list_accounts" })
    });

    const data = await res.json();
    if (res.ok && data.success && Array.isArray(data.data?.accounts)) {
      return { success: true, accounts: data.data.accounts };
    }
    return { success: false, error: data?.error || "Failed to list accounts", accounts: [] };
  } catch (err: any) {
    console.error("Error fetching WhatsApp accounts list:", err);
    return { success: false, error: err.message, accounts: [] };
  }
}

// ============================================================================
// 1. SEND NORMAL TEXT MESSAGE (Used in Chat UI)
// ============================================================================
export async function sendWhatsAppText(leadId: string, customerPhone: string, text: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: profile } = await supabase.from('users').select('tenant_id').eq('id', user.id).single();
    const creds = await getTenantWaCredentials(profile?.tenant_id || null);

    const { safePhone, msgId } = await sendViaFonadaOldApi(creds, customerPhone, text);

    const { error: insertError } = await supabase.from("chat_messages").insert({
        tenant_id: profile?.tenant_id || null,
        lead_id: leadId, phone_number: safePhone, direction: 'outbound',
        message_type: 'text', content: text, fonada_message_id: msgId, status: 'sent'
    });

    if (insertError) throw new Error(`Database Insert Failed: ${insertError.message}`);

    await supabase.from("leads").update({ 
      last_message_at: new Date().toISOString(),
      last_message_content: text.substring(0, 100),
      last_message_type: 'outbound'
    }).eq("id", leadId);
    return { success: true };
  } catch (error: any) {
    console.error("WA Text Send Error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 2. SEND MISSED CALL TEMPLATE
// ============================================================================
export async function sendMissedCallMessage(leadId: string, customerPhone: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: agent, error } = await supabase.from('users').select('full_name, phone, tenant_id').eq('id', user.id).single();
    if (error || !agent) throw new Error("Could not fetch agent details");
    
    const { data: lead } = await supabase.from('leads').select('name').eq('id', leadId).single();

    const creds = await getTenantWaCredentials(agent.tenant_id);

    const textMessage = `[ALERT]\n\n⚠️ We tried calling you but *couldn't connect*.\n\nYour loan application is pending due to missing documents. To avoid processing delays, *please share* the following *immediately*:\n\n*• PAN Card*\n*• Aadhaar Card*\n*• Latest Payslip*\n\n[I Have Uploaded]`;

    const customerName = lead?.name?.split(' ')[0] || "Customer";
    const agentName = agent.full_name?.split(' ')[0] || "Agent";

    const { safePhone, msgId } = await sendViaFonadaOldApi(creds, customerPhone, textMessage);

    const { error: insertError } = await supabase.from("chat_messages").insert({
        tenant_id: agent.tenant_id || null,
        lead_id: leadId, phone_number: safePhone, direction: 'outbound',
        message_type: 'template', content: textMessage, fonada_message_id: msgId, status: 'sent'
    });

    if (insertError) throw new Error(`Database Insert Failed: ${insertError.message}`);

    await supabase.from("leads").update({ 
      last_message_at: new Date().toISOString(),
      last_message_content: "Sent Missed Call / Callback Request",
      last_message_type: 'outbound'
    }).eq("id", leadId);
    return { success: true };
  } catch (error: any) {
    console.error("Missed Call WA Error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 3. SEND AUTOMATED KYC DOCUMENT REQUEST (Handles Initial & 24h Reminder)
// ============================================================================
export async function sendKYCRequestTemplate(leadId: string, customerPhone: string, isReminder: boolean = false) {
  try {
    const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    
    // Fetch lead to know which tenant is sending this
    const { data: lead } = await supabase.from('leads').select('tenant_id').eq('id', leadId).single();
    const creds = await getTenantWaCredentials(lead?.tenant_id || null);

    const textMessage = `Hello,\n\nThis is an update regarding your loan application. Your application is currently pending.\n\nPlease share clear photos or PDFs of your Aadhar Card, PAN Card, and latest Bank Statement by replying directly to this chat.\n\nThank you.`;

    const { safePhone, msgId } = await sendViaFonadaOldApi(creds, customerPhone, textMessage);

    const { error: insertError } = await supabase.from("chat_messages").insert({
        tenant_id: lead?.tenant_id || null,
        lead_id: leadId, phone_number: safePhone, direction: 'outbound',
        message_type: 'template', content: textMessage, fonada_message_id: msgId, status: 'sent'
    });

    if (insertError) throw new Error(`Database Insert Failed: ${insertError.message}`);

    const updatePayload: any = { last_message_at: new Date().toISOString(), last_message_content: isReminder ? "Sent 24h KYC Reminder" : "Sent Initial KYC Request", last_message_type: 'outbound' };
    if (isReminder) updatePayload.kyc_reminder_sent = true; 
    else { updatePayload.kyc_requested_at = new Date().toISOString(); updatePayload.kyc_reminder_sent = false; }

    await supabase.from("leads").update(updatePayload).eq("id", leadId);
    return { success: true };
  } catch (error: any) {
    console.error("KYC Request WA Error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 4. SEND "NOT INTERESTED" AUDIT (The Lie-Detector)
// ============================================================================
export async function sendNotInterestedAudit(leadId: string, customerPhone: string, customerName: string) {
  console.log(`🚀 [SERVER ACTION] Triggering QA Audit for Lead: ${leadId} | Phone: ${customerPhone}`);
  
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        console.error("❌ [QA AUDIT ERROR] No active user session.");
        throw new Error("Unauthorized");
    }

    const { data: profile } = await supabase.from('users').select('tenant_id').eq('id', user.id).single();
    const creds = await getTenantWaCredentials(profile?.tenant_id || null);

    const textMessage = `Hi ${customerName}, our agent noted that you are no longer interested in a loan at this time.\n\nTo help us improve our service, could you let us know why by replying with one of the following?\n\n1. Rate is too high\n2. Got another loan\n3. I am still interested`;

    const { safePhone, msgId } = await sendViaFonadaOldApi(creds, customerPhone, textMessage);

    await supabase.from("chat_messages").insert({
        tenant_id: profile?.tenant_id || null,
        lead_id: leadId, phone_number: safePhone, direction: 'outbound',
        message_type: 'template', content: textMessage, fonada_message_id: msgId, status: 'sent'
    });

    await supabase.from("leads").update({ 
        last_message_at: new Date().toISOString(),
        last_message_content: "Sent QA Audit Template",
        last_message_type: 'outbound'
    }).eq("id", leadId);

    console.log(`✅ [QA AUDIT SUCCESS] Template sent!`);
    return { success: true };

  } catch (error: any) {
    console.error("❌ [QA AUDIT FAILURE]:", error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 5. SEND CALLBACK REMINDER (Automated Pre-Call Alert)
// ============================================================================
export async function sendCallbackReminderTemplate(leadId: string, customerPhone: string, customerName: string, agentName: string, timeString: string) {
  try {
    const supabase = await createClient();
    
    // Fetch lead to know which tenant is sending this
    const { data: lead } = await supabase.from('leads').select('tenant_id').eq('id', leadId).single();
    const creds = await getTenantWaCredentials(lead?.tenant_id || null);

    const textMessage = `Hello ${customerName}, this is a reminder for your scheduled call with our loan advisor ${agentName} at ${timeString}. We will call you shortly. Thank you!`;

    const { safePhone, msgId } = await sendViaFonadaOldApi(creds, customerPhone, textMessage);

    const { error: insertError } = await supabase.from("chat_messages").insert({
        tenant_id: lead?.tenant_id || null,
        lead_id: leadId, phone_number: safePhone, direction: 'outbound',
        message_type: 'template', content: textMessage, fonada_message_id: msgId, status: 'sent'
    });

    if (insertError) throw new Error(`Database Insert Failed: ${insertError.message}`);

    await supabase.from("leads").update({ 
        last_message_at: new Date().toISOString(),
        last_message_content: `Sent Callback Reminder for ${timeString}`,
        last_message_type: 'outbound'
    }).eq("id", leadId);

    return { success: true, method: "template" };
  } catch (error: any) {
    console.error("Callback Reminder WA Error:", error);
    return { success: false, error: error.message };
  }
}

import { checkDailyDocMessageLimit, PERSONAL_LOAN_DOCS_MESSAGE } from "@/lib/whatsapp-rate-limiter";

// ============================================================================
// 6. SEND APPLICATION STATUS UPDATE TEMPLATE (For IVR DTMF Leads)
// ============================================================================
export async function sendStatusUpdateMessage(
  leadId: string, 
  customerPhone: string, 
  tenantId: string | null = null,
  templateNameOverride?: string,
  campaignNameOverride?: string
) {
  try {
    const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const creds = await getTenantWaCredentials(tenantId);

    // Fetch tenant-specific IVR DTMF workflow configuration
    let templateName = templateNameOverride;
    let campaignName = campaignNameOverride;

    if (!templateName || !campaignName) {
      if (tenantId) {
        const { data: org } = await supabase.from('organizations').select('workflow_triggers').eq('id', tenantId).maybeSingle();
        const triggers = org?.workflow_triggers || {};
        if (!templateName) templateName = triggers.ivr_dtmf_template || 'application_status_update';
        if (!campaignName) campaignName = triggers.ivr_dtmf_campaign || 'StatusUpdateAlert';
      } else {
        templateName = templateName || 'application_status_update';
        campaignName = campaignName || 'StatusUpdateAlert';
      }
    }

    console.log(`[Auto WhatsApp] Dispatching template '${templateName}' for IVR digit press (Phone: ${customerPhone}, Tenant: ${tenantId})`);

    // Template message text
    const APPLICATION_STATUS_UPDATE_TEXT = `*Application Status*\n\n*Hello!* Thank you for speaking with our *verification team.*\n\nYour initial *phone verification is successfully completed*. To keep your loan application moving forward, *please submit the remaining pending details* in your secure portal.\n\nLet us know if you need any assistance with the upload!\n\n_ICICI Bank Loan Desk_`;
    let finalContent = (templateName === 'application_status_update') 
      ? APPLICATION_STATUS_UPDATE_TEXT 
      : `[WhatsApp Template: ${templateName}]`;

    // Dispatch template via Fonada AI Gateway (Direct sub-500ms message sender with campaign creator fallback)
    let sendResult: any = null;
    try {
      sendResult = await sendTemplateViaFonadaApi(creds, customerPhone, templateName, undefined, undefined, campaignName);
    } catch (tmplErr: any) {
      console.warn(`[Auto WhatsApp] Template dispatch failed, falling back to text:`, tmplErr.message);
      sendResult = await sendViaFonadaOldApi(creds, customerPhone, finalContent);
    }

    const safePhone = sendResult?.safePhone || String(customerPhone).replace(/\D/g, '');
    const msgId = sendResult?.msgId || `msg_${Date.now()}`;

    const { error: insertError } = await supabase.from("chat_messages").insert({
        tenant_id: tenantId || null,
        lead_id: leadId, 
        phone_number: safePhone, 
        direction: 'outbound',
        message_type: 'template', 
        content: finalContent, 
        fonada_message_id: msgId, 
        status: 'sent'
    });

    if (insertError) throw new Error(`Database Insert Failed: ${insertError.message}`);

    await supabase.from("leads").update({ 
      last_message_at: new Date().toISOString(),
      last_message_content: `Sent ${templateName} (${campaignName})`,
      last_message_type: 'outbound'
    }).eq("id", leadId);
    
    return { success: true, templateName, campaignName, msgId };
  } catch (error: any) {
    console.error("Application Status Update WA Error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 7. UPLOAD & SEND ATTACHMENT (Images, PDF, Documents)
// ============================================================================
export async function uploadAndSendWhatsAppFile(formData: FormData) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: profile } = await supabase.from('users').select('tenant_id').eq('id', user.id).single();
    let tenantId = profile?.tenant_id;

    const file = formData.get("file") as File;
    const leadId = formData.get("leadId") as string;
    const customerPhone = formData.get("customerPhone") as string;
    const caption = (formData.get("caption") as string) || "";

    if (!file || !leadId || !customerPhone) {
      throw new Error("Missing required file or lead information");
    }

    // Fallback if tenantId not in profile
    if (!tenantId) {
      const { data: leadData } = await supabase.from('leads').select('tenant_id').eq('id', leadId).single();
      tenantId = leadData?.tenant_id;
    }
    if (!tenantId) throw new Error("Tenant ID could not be identified.");

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const rawExt = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const ext = rawExt.replace(/[^a-z0-9]/g, '');
    const cleanBaseName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 40);
    const storagePath = `${tenantId}/${leadId}/out_${Date.now()}_${cleanBaseName}.${ext}`;

    const supabaseAdmin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const isImage = file.type?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
    const isPdf = file.type === 'application/pdf' || ext === 'pdf';
    let mimeType = file.type;
    if (!mimeType) {
      if (isPdf) mimeType = 'application/pdf';
      else if (isImage) mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      else mimeType = 'application/octet-stream';
    }

    const { error: uploadError } = await supabaseAdmin.storage
      .from('kyc_documents')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

    if (uploadError) throw new Error(`Document upload failed: ${uploadError.message}`);

    const { data: publicUrlData } = supabaseAdmin.storage.from('kyc_documents').getPublicUrl(storagePath);
    const publicUrl = publicUrlData.publicUrl;

    // Send link via Fonada
    const creds = await getTenantWaCredentials(tenantId);
    const textToSend = caption.trim() ? `${caption.trim()}\n${publicUrl}` : publicUrl;
    const { safePhone, msgId } = await sendViaFonadaOldApi(creds, customerPhone, textToSend);

    const { error: insertError } = await supabaseAdmin.from("chat_messages").insert({
      tenant_id: tenantId,
      lead_id: leadId,
      phone_number: safePhone,
      direction: 'outbound',
      message_type: isImage ? 'image' : isPdf ? 'document' : 'document',
      content: textToSend,
      media_url: publicUrl,
      media_type: mimeType,
      file_name: file.name,
      fonada_message_id: msgId,
      status: 'sent'
    });

    if (insertError) console.error("chat_messages insert error:", insertError);

    await supabaseAdmin.from("leads").update({
      last_message_at: new Date().toISOString(),
      last_message_content: caption.trim() || `📎 ${file.name}`,
      last_message_type: 'outbound'
    }).eq("id", leadId);

    return { success: true, publicUrl, fileName: file.name };
  } catch (error: any) {
    console.error("Upload & Send WA File Error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 8. UPDATE LEAD STATUS DIRECTLY FROM CHAT HUB
// ============================================================================
export async function updateLeadStatusFromChat(leadId: string, newStatus: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: lead } = await supabase.from('leads').select('status, tenant_id').eq('id', leadId).single();
    if (!lead) throw new Error("Lead not found");

    const oldStatus = lead.status;
    const { error: updateError } = await supabase
      .from('leads')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', leadId);

    if (updateError) throw updateError;

    // Log timeline note
    await supabase.from('notes').insert({
      lead_id: leadId,
      user_id: user.id,
      content: `Status updated from ${oldStatus} to ${newStatus} via WhatsApp Hub`,
      note_type: 'status_change'
    });

    return { success: true };
  } catch (error: any) {
    console.error("Update Lead Status Error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 9. REASSIGN LEAD TO TELECALLER FROM CHAT HUB
// ============================================================================
export async function reassignLeadFromChat(leadId: string, newAssigneeId: string | null) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    let targetName = 'Unassigned';
    if (newAssigneeId) {
      const { data: targetUser } = await supabase.from('users').select('full_name').eq('id', newAssigneeId).maybeSingle();
      if (targetUser?.full_name) targetName = targetUser.full_name;
    }

    const { error: updateError } = await supabase
      .from('leads')
      .update({ assigned_to: newAssigneeId, updated_at: new Date().toISOString() })
      .eq('id', leadId);

    if (updateError) throw updateError;

    await supabase.from('notes').insert({
      lead_id: leadId,
      user_id: user.id,
      content: `Lead reassigned to ${targetName} via WhatsApp Hub`,
      note_type: 'assignment'
    });

    return { success: true, assigneeName: targetName };
  } catch (error: any) {
    console.error("Reassign Lead Error:", error);
    return { success: false, error: error.message };
  }
}
