// lib/whatsapp-rate-limiter.ts
// Enforces: "this message should send maximum 2 times in a day in a chat."

export const PERSONAL_LOAN_DOCS_MESSAGE = `Thank you for your interest in a Personal Loan. To proceed with your application, please share the following documents:

✅ *Aadhar Card*
✅ *PAN Card*
✅ *One month's payslip*

*You can upload them here or reply to this message* with the attachments. We'll begin the verification process right away.`;

/**
 * Returns the ISO string for 00:00:00 IST of the current day.
 */
export function getStartOfTodayIST(): string {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(now.getTime() + istOffset);
  nowIST.setUTCHours(0, 0, 0, 0);
  return new Date(nowIST.getTime() - istOffset).toISOString();
}

/**
 * Checks whether the document request / status update message
 * has already been sent maximum 2 times today in this chat (phone / lead).
 */
export async function checkDailyDocMessageLimit(
  supabase: any,
  customerPhone: string,
  leadId?: string | null
): Promise<{ allowed: boolean; countToday: number; reason?: string }> {
  try {
    const cleanPhone = String(customerPhone || '').replace(/\D/g, '');
    const phone10 = cleanPhone.slice(-10);

    const startOfTodayIST = getStartOfTodayIST();

    // Query outbound messages sent today to this phone or lead
    let query = supabase
      .from("chat_messages")
      .select("id, content, created_at, message_type")
      .eq("direction", "outbound")
      .gte("created_at", startOfTodayIST)
      .order("created_at", { ascending: false });

    if (phone10.length === 10 && leadId) {
      query = query.or(`phone_number.ilike.%${phone10}%,lead_id.eq.${leadId}`);
    } else if (phone10.length === 10) {
      query = query.ilike("phone_number", `%${phone10}%`);
    } else if (leadId) {
      query = query.eq("lead_id", leadId);
    } else {
      return { allowed: true, countToday: 0 };
    }

    const { data: messages, error } = await query;
    if (error) {
      console.error("[RateLimiter] Error querying chat_messages:", error);
      return { allowed: true, countToday: 0 };
    }

    // Filter messages specifically matching THIS Personal Loan document request message
    const matchingToday = (messages || []).filter((m: any) => {
      const c = (m.content || "").toLowerCase();
      return (
        c.includes("thank you for your interest in a personal loan") ||
        (c.includes("aadhar card") && c.includes("pan card") && c.includes("payslip"))
      );
    });

    const countToday = matchingToday.length;

    // RULE 1: Maximum 2 times per day in a chat
    if (countToday >= 2) {
      return {
        allowed: false,
        countToday,
        reason: `Maximum limit of 2 document request messages per day reached (${countToday} already sent today in this chat)`
      };
    }

    // RULE 2: Short 10-second debounce to prevent identical rapid double-clicks
    if (countToday >= 1 && matchingToday[0]?.created_at) {
      const lastSentTime = new Date(matchingToday[0].created_at).getTime();
      const elapsedSeconds = (Date.now() - lastSentTime) / 1000;
      if (elapsedSeconds < 10) {
        return {
          allowed: false,
          countToday,
          reason: `Debounce active: Message was already sent ${Math.round(elapsedSeconds)}s ago`
        };
      }
    }

    return { allowed: true, countToday };
  } catch (err: any) {
    console.error("[RateLimiter] Exception:", err);
    return { allowed: true, countToday: 0 };
  }
}
