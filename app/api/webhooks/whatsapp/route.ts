// app/api/webhooks/whatsapp/route.ts
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkDailyDocMessageLimit, PERSONAL_LOAN_DOCS_MESSAGE } from "@/lib/whatsapp-rate-limiter";
import { resolveFonadaAccountId } from "@/app/actions/whatsapp";

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key"
);

// Fallback primary tenant ID (BanksCart)
const DEFAULT_TENANT_ID = "576a6280-a9a2-425c-b1dd-eabfff3a00c6";

// =================================================================================
// GET: Webhook Verification Handshake & Health Checks
// =================================================================================
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  console.log(`🔔 [WA WEBHOOK GET] Handshake requested. Mode: ${mode}, Token: ${token}, Challenge: ${challenge}`);

  if (challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });
  }

  return NextResponse.json({
    status: "success",
    message: "Fonada WhatsApp Webhook active and verified"
  });
}

// =================================================================================
// POST: Inbound Messages, Button Clicks & Delivery Receipts
// =================================================================================
export async function POST(request: NextRequest) {
  console.log("🔔 [WA WEBHOOK POST] Received request");

  try {
    const searchParams = request.nextUrl.searchParams;
    let tenantId = searchParams.get("tenant_id") || DEFAULT_TENANT_ID;
    const updateType = searchParams.get("type");

    const rawBody = await request.text();
    let body: any = {};
    if (rawBody) {
      try { body = JSON.parse(rawBody); } 
      catch (e) { body = Object.fromEntries(new URLSearchParams(rawBody)); }
    }

    // 0. Acknowledge Fonada Test Pings immediately
    if (body._test || body._source === "fonada_webhook_test") {
      console.log("🧪 [WA WEBHOOK] Fonada test ping acknowledged successfully");
      return NextResponse.json({
        success: true,
        test: true,
        message: "Fonada webhook connection active and verified"
      });
    }

    // 1. Fetch credentials for this tenant
    const { data: settings } = await supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).maybeSingle();
    const fonadaUser = settings?.fonada_userid || settings?.wa_userid || process.env.FONADA_USERID || "bankscart";
    const fonadaPass = settings?.fonada_password || settings?.wa_password || process.env.FONADA_PASSWORD || "zfsWTyKw";
    const fonadaWaba = settings?.fonada_waba_number || settings?.wa_waba_number || process.env.FONADA_WABA_NUMBER || "918217354172";
    const bearerToken = settings?.whatsapp_api_key || process.env.FONADA_WHATSAPP_BEARER_TOKEN || "fsk_fa674b9a167787e48b2b29f48939a4570fe02efc1a4ec012c9f60bacc76bc250";
    const accountId = await resolveFonadaAccountId(bearerToken, fonadaWaba);

    // =================================================================================
    // CASE A: DELIVERY RECEIPTS (DLR)
    // =================================================================================
    const isDlrEvent =
      updateType === 'dlr' ||
      body.event_type === 'whatsapp_status_update' ||
      body.event_type === 'sent' ||
      body.event_type === 'delivered' ||
      body.event_type === 'read' ||
      body.event_type === 'failed' ||
      (body.status && !body.text && !body.message && !body.data?.button && !body.data?.text);

    if (isDlrEvent) {
      const msgId = body.data?.waid || body.data?.id || body.msgId || body.id;
      let status = (body.data?.status || body.status || body.event_type || 'delivered').toLowerCase();
      if (status.includes('deliv')) status = 'delivered';
      if (status.includes('sent')) status = 'sent';
      if (status.includes('read')) status = 'read';
      if (status.includes('fail')) status = 'failed';

      if (msgId && (status === 'delivered' || status === 'read' || status === 'failed' || status === 'sent')) {
        await supabase.from('chat_messages').update({ status }).eq('fonada_message_id', msgId);
      }
      return NextResponse.json({ status: "success", type: "dlr" });
    }

    // =================================================================================
    // CASE B: META / FONADA CLOUD API STANDARD PAYLOAD (body.entry)
    // =================================================================================
    if (body.object === "whatsapp_business_account" || Array.isArray(body.entry)) {
      console.log("📦 [WA WEBHOOK] Processing Meta / Fonada Cloud API Format");

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          if (!value) continue;

          // Inbound Messages
          if (Array.isArray(value.messages)) {
            for (const msg of value.messages) {
              const senderPhone = String(msg.from || '').trim();
              const msgId = msg.id;
              const msgType = msg.type;

              let messageText = "";
              let mediaUrl = "";

              if (msgType === "text") {
                messageText = msg.text?.body || "";
              } else if (msgType === "interactive") {
                messageText = msg.interactive?.button_reply?.title || msg.interactive?.button_reply?.id || "[Button Clicked]";
              } else if (msgType === "button") {
                messageText = msg.button?.text || msg.button?.payload || "[Button Response]";
              } else if (msgType === "document") {
                mediaUrl = msg.document?.link || "";
                messageText = msg.document?.caption || "📎 [Document Attachment]";
              } else if (msgType === "image") {
                mediaUrl = msg.image?.link || "";
                messageText = msg.image?.caption || "📷 [Image Attachment]";
              }

              if (!senderPhone || (!messageText && !mediaUrl)) continue;

              await processInboundMessage({
                customerPhone: senderPhone,
                messageText,
                mediaUrl,
                fonadaMsgId: msgId,
                tenantId,
                settings,
                fonadaUser,
                fonadaPass,
                fonadaWaba,
                bearerToken,
                accountId
              });
            }
          }

          // DLR updates
          if (Array.isArray(value.statuses)) {
            for (const statusItem of value.statuses) {
              const msgId = statusItem.id;
              let status = statusItem.status ? statusItem.status.toLowerCase() : "";
              if (status === "sent" || status === "delivered" || status === "read" || status === "failed") {
                await supabase.from("chat_messages").update({ status }).eq("fonada_message_id", msgId);
              }
            }
          }
        }
      }

      return NextResponse.json({ status: "success" });
    }

    // =================================================================================
    // CASE C: FONADA AI WEBHOOK MANAGER / LEGACY FONADA WEBHOOK
    // =================================================================================
    const customerPhone = String(
      body.data?.from ||
      body.data?.sender ||
      body.data?.phone ||
      body.customer_data?.Phone ||
      body.customer_data?.phone ||
      body.data?.recipient_id ||
      body.mobile ||
      body.sender ||
      body.from ||
      body.message?.from ||
      ''
    ).trim();

    let messageText = String(
      body.data?.button_reply?.title ||
      body.data?.button?.text ||
      body.data?.button ||
      body.data?.button_clicked ||
      body.data?.payload ||
      body.data?.text?.body ||
      body.data?.text ||
      body.data?.message ||
      body.data?.body ||
      body.text ||
      body.msg ||
      body.caption ||
      body.message?.text?.body ||
      body.button?.text ||
      body.button?.payload ||
      body.button_reply?.title ||
      body.interactive?.button_reply?.title ||
      body.payload ||
      ''
    ).trim();

    const mediaUrl = String(
      body.data?.media_url ||
      body.data?.mediaUrl ||
      body.data?.imageUrl ||
      body.data?.documentUrl ||
      body.data?.url ||
      body.imageUrl ||
      body.documentUrl ||
      body.videoUrl ||
      body.mediaUrl ||
      body.media_url ||
      body.url ||
      ''
    ).trim();

    const fonadaMsgId = body.data?.waid || body.data?.id || body.data?.msgId || body.msgId || body.id || null;

    if (customerPhone && (messageText || mediaUrl)) {
      console.log(`📥 [WA WEBHOOK] Inbound message from ${customerPhone}: "${messageText || mediaUrl}"`);
      await processInboundMessage({
        customerPhone,
        messageText,
        mediaUrl,
        fonadaMsgId,
        tenantId,
        settings,
        fonadaUser,
        fonadaPass,
        fonadaWaba,
        bearerToken,
        accountId
      });

      return NextResponse.json({ status: "success" });
    }

    return NextResponse.json({ status: "success", info: "unhandled_or_ack" });

  } catch (error: any) {
    console.error("🔥 [CRITICAL ERROR] Webhook failed:", error);
    return NextResponse.json({ status: "error", error: error.message }, { status: 500 });
  }
}

// =================================================================================
// HELPER: Process Inbound Message & Dispatch Auto-Replies
// =================================================================================
async function processInboundMessage({
  customerPhone,
  messageText,
  mediaUrl,
  fonadaMsgId,
  tenantId,
  settings,
  fonadaUser,
  fonadaPass,
  fonadaWaba,
  bearerToken,
  accountId
}: {
  customerPhone: string;
  messageText: string;
  mediaUrl: string;
  fonadaMsgId: string | null;
  tenantId: string;
  settings: any;
  fonadaUser: string;
  fonadaPass: string;
  fonadaWaba: string;
  bearerToken: string;
  accountId: string;
}) {
  let dbPhone = customerPhone.replace(/^\+?91/, '').replace(/\D/g, '');
  if (dbPhone.length > 10) dbPhone = dbPhone.slice(-10);

  // 1. Find or auto-create Lead
  let { data: lead } = await supabase
    .from("leads")
    .select("id, name, assigned_to, notes")
    .eq("tenant_id", tenantId)
    .ilike("phone", `%${dbPhone}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lead) {
    console.log(`🆕 [AUTO-CREATE LEAD] Inbound WA message from ${customerPhone} (Tenant: ${tenantId})`);
    const { data: newLead } = await supabase
      .from("leads")
      .insert({
        tenant_id: tenantId,
        name: "WhatsApp Customer",
        phone: dbPhone,
        status: "new",
        source: "whatsapp",
        notes: "🚨 [SYSTEM] Lead automatically created from inbound WhatsApp message."
      })
      .select("id, name, assigned_to, notes")
      .single();
    if (newLead) lead = newLead;
  }

  // 2. Insert into chat_messages
  const isMedia = !!mediaUrl;
  await supabase.from("chat_messages").insert({
    tenant_id: tenantId,
    lead_id: lead?.id || null,
    phone_number: customerPhone,
    direction: "inbound",
    message_type: isMedia ? "document" : "text",
    content: isMedia ? `${messageText}\n${mediaUrl}`.trim() : messageText,
    media_url: mediaUrl || null,
    fonada_message_id: fonadaMsgId,
    status: "delivered"
  });

  // 3. Update lead last message
  if (lead?.id) {
    await supabase.from("leads").update({
      last_message_at: new Date().toISOString(),
      last_message_content: (messageText || "Media message").substring(0, 100),
      last_message_type: "inbound"
    }).eq("id", lead.id);

    // 4. Trigger auto-replies
    await handleAutoReply({
      lead,
      customerPhone,
      messageText,
      isMedia,
      tenantId,
      settings,
      fonadaUser,
      fonadaPass,
      fonadaWaba,
      bearerToken,
      accountId
    });
  }
}

// =================================================================================
// HELPER: Auto-Reply Handling
// =================================================================================
async function handleAutoReply({
  lead,
  customerPhone,
  messageText,
  isMedia,
  tenantId,
  settings,
  fonadaUser,
  fonadaPass,
  fonadaWaba,
  bearerToken,
  accountId
}: any) {
  if (!lead) return;
  const textLower = (messageText || "").toLowerCase().trim();

  // 1. LIE-DETECTOR RESCUE OVERRIDE
  if (!isMedia && (textLower === "i am still interested" || textLower.includes("still interested"))) {
    const rescueMsg = `Thank you for confirming! We apologize for the confusion. A senior executive has been notified and will contact you immediately.`;
    await sendFonadaMessage(customerPhone, rescueMsg, fonadaUser, fonadaPass, fonadaWaba, lead.id, tenantId, bearerToken, accountId);
    
    const currentNotes = lead.notes || "";
    await supabase.from("leads").update({
      status: "new", 
      assigned_to: null, 
      notes: `${currentNotes}\n\n🚨 [SYSTEM ALERT] Customer clicked "I AM STILL INTERESTED". Lead stripped from agent.`,
      last_contacted: new Date().toISOString() 
    }).eq("id", lead.id);
    return;
  }

  // 2. CUSTOMER QUICK REPLIES / PRESET REPLIES / DOCUMENT REQUESTS
  if (!isMedia) {
    const isDocRequest = 
      textLower.includes("submit details") || 
      textLower.includes("submit") ||
      textLower.includes("detail") ||
      textLower.includes("what are required documents") || 
      textLower.includes("i want to apply personal loan") ||
      textLower.includes("required documents") ||
      textLower.includes("documents required") ||
      textLower.includes("send documents") ||
      textLower.includes("document") ||
      textLower.includes("docs") ||
      textLower.includes("apply") ||
      textLower.includes("interested") ||
      textLower.includes("share documents") ||
      textLower.includes("upload") ||
      textLower.includes("aadhar") ||
      textLower.includes("pan") ||
      textLower.includes("payslip") ||
      textLower.includes("payload") ||
      textLower.includes("button") ||
      textLower === "yes" ||
      textLower === "hi" ||
      textLower === "hello" ||
      textLower === "ok";
    
    if (isDocRequest) {
      // Enforce rate limit: Maximum 2 times per day in this chat
      const rateLimit = await checkDailyDocMessageLimit(supabase, customerPhone, lead?.id);
      if (rateLimit.allowed) {
        console.log(`[WA Quick Reply] Sending Personal Loan docs message to ${customerPhone} (Today count: ${rateLimit.countToday + 1})`);
        await sendFonadaMessage(customerPhone, PERSONAL_LOAN_DOCS_MESSAGE, fonadaUser, fonadaPass, fonadaWaba, lead?.id, tenantId, bearerToken, accountId);
      } else {
        console.log(`[WA Quick Reply] Suppressed for ${customerPhone}: ${rateLimit.reason}`);
      }
      return;
    }

    const isInterestRequest = 
      textLower.includes("what's the interest rate") || 
      textLower.includes("whats the interest rate") || 
      textLower.includes("what is the interest rate");

    if (isInterestRequest) {
      const replyMsg = `Starting From 9.99% so Kindly Share Documents`;
      await sendFonadaMessage(customerPhone, replyMsg, fonadaUser, fonadaPass, fonadaWaba, lead.id, tenantId, bearerToken, accountId);
      return;
    }
  }

  // 3. AI CHAT AGENT (if enabled)
  if (settings?.whatsapp_ai_agent_enabled) {
    try {
      const apiKey = process.env.OPENROUTER_API_KEY || "";
      if (apiKey) {
        const { data: messages } = await supabase
          .from("chat_messages")
          .select("direction, content")
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: true })
          .limit(10);

        const formattedMessages = (messages || []).map(msg => ({
          role: msg.direction === 'inbound' ? 'user' : 'assistant',
          content: msg.content
        }));

        const systemPrompt = `You are a warm and polite assistant for BanksCart. Help the customer complete their loan document verification (PAN, Aadhaar, Payslip). Keep replies under 2 sentences.`;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "google/gemma-4-31b-it:free",
            messages: [
              { role: "system", content: systemPrompt },
              ...formattedMessages
            ]
          })
        });

        if (response.ok) {
          const resData = await response.json();
          const aiReply = resData.choices?.[0]?.message?.content?.trim();
          if (aiReply) {
            await sendFonadaMessage(customerPhone, aiReply, fonadaUser, fonadaPass, fonadaWaba, lead.id, tenantId, bearerToken, accountId);
            return;
          }
        }
      }
    } catch (aiErr) {
      console.warn("AI Agent reply error:", aiErr);
    }
  }
}

// =================================================================================
// HELPER: Send Outbound Message via Fonada AI or Legacy SendMsgOld
// =================================================================================
async function sendFonadaMessage(
  mobile: string, 
  text: string, 
  userId?: string, 
  pass?: string, 
  waba?: string, 
  leadId?: string | null, 
  tenantId?: string | null,
  bearerToken?: string,
  accountId?: string
) {
  let safePhone = String(mobile || '').replace(/^\+/, '').replace(/\D/g, '');
  if (safePhone.length === 10) safePhone = `91${safePhone}`;

  const token = bearerToken || process.env.FONADA_WHATSAPP_BEARER_TOKEN || "fsk_fa674b9a167787e48b2b29f48939a4570fe02efc1a4ec012c9f60bacc76bc250";
  const accId = accountId || await resolveFonadaAccountId(token, waba);

  // 1. Try Fonada AI direct message sender
  try {
    const aiRes = await fetch("https://app.fonada.ai/functions/v1/whatsapp_message_sender", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        account_id: accId,
        to: safePhone,
        message: {
          type: "text",
          text: { body: text }
        }
      })
    });

    const aiData = await aiRes.json();
    console.log(`[sendFonadaMessage] Fonada sender response for ${safePhone}:`, JSON.stringify(aiData));
    if (aiRes.ok && !aiData.error) {
      const msgId = aiData.data?.message_id || aiData.id || aiData.message_id || `msg_${Date.now()}`;
      await supabase.from("chat_messages").insert({
        tenant_id: tenantId,
        lead_id: leadId,
        phone_number: safePhone,
        direction: 'outbound',
        message_type: 'text',
        content: text,
        fonada_message_id: msgId,
        status: 'sent'
      });

      if (leadId) {
        await supabase.from("leads").update({
          last_message_at: new Date().toISOString(),
          last_message_content: text.substring(0, 100),
          last_message_type: 'outbound'
        }).eq("id", leadId);
      }
      console.log(`✅ [WA Quick Reply] Sent docs message to ${safePhone}. Message ID: ${msgId}`);
      return;
    }
    console.warn("⚠️ [WA Sender] Fonada message sender returned error, trying fallback:", aiData);
  } catch (e: any) {
    console.warn("⚠️ Fonada AI auto-reply error, trying legacy fallback:", e?.message || e);
  }

  // 2. Legacy fallback
  if (userId && pass) {
    const apiUrl = "https://waba.fonada.com/api/SendMsgOld"; 
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const formData = new FormData();
    formData.append("userid", userId);
    formData.append("password", pass);
    formData.append("wabaNumber", waba || "918217354172");
    formData.append("mobile", safePhone); 
    formData.append("msg", text);
    formData.append("msgType", "text");
    formData.append("sendMethod", "quick");
    formData.append("output", "json");

    try {
      const res = await fetch(apiUrl, { method: "POST", body: formData });
      const data = await res.json();
      console.log(`[sendFonadaMessage] Legacy response for ${safePhone}:`, JSON.stringify(data));
      if (data.status !== "error") {
        await supabase.from("chat_messages").insert({
          tenant_id: tenantId,
          lead_id: leadId,
          phone_number: safePhone,
          direction: 'outbound',
          message_type: 'text',
          content: text,
          fonada_message_id: data.msgId || null,
          status: 'sent'
        });
      }
    } catch (err: any) {
      console.error("❌ Failed legacy auto-reply:", err?.message || err);
    }
  }
}
