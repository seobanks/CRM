import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Helper to lazy-load the Supabase Admin Client to bypass RLS for webhooks
// Singleton instance prevents allocating thousands of client objects under high webhook load.
let _cachedAdminClient: any = null;
const getSupabaseAdmin = () => {
  if (!_cachedAdminClient) {
    _cachedAdminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    );
  }
  return _cachedAdminClient;
};

// Safe helper for Realtime broadcast: uses httpSend and cleans up channel immediately to prevent memory leak
async function broadcastScreenPop(supabaseAdmin: any, payload: any) {
  try {
    const channel = supabaseAdmin.channel('cloudconnect_events');
    if (typeof channel.httpSend === 'function') {
      await channel.httpSend('SCREEN_POP', payload);
    } else {
      await channel.send({
        type: 'broadcast',
        event: 'SCREEN_POP',
        payload,
      });
    }
    await supabaseAdmin.removeChannel(channel);
  } catch (err) {
    console.error('[Ozonetel Sticky] Error broadcasting pre-ring popup:', err);
  }
}

export async function GET(req: Request) {
    return handleStickyRouting(req);
}

export async function POST(req: Request) {
    return handleStickyRouting(req);
}

async function handleStickyRouting(req: Request) {
    try {
        const url = new URL(req.url);
        const searchParams = url.searchParams;

        let bodyData: any = {};
        if (req.method === 'POST') {
            const contentType = req.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                try {
                    bodyData = await req.json();
                } catch (e) {
                    // ignore
                }
            } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
                try {
                    const formData = await req.formData();
                    formData.forEach((value, key) => {
                        bodyData[key] = value.toString();
                    });
                } catch (e) {
                    // ignore
                }
            }
        }

        const getParam = (key: string) => searchParams.get(key) || bodyData[key] || '';
        
        // API Key Verification
        const expectedApiKey = process.env.CLOUDCONNECT_WEBHOOK_SECRET || 'HANVA_OZT_7X9Q2P4L';
        const providedApiKey = getParam('api_key') || req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');

        if (providedApiKey !== expectedApiKey) {
            return NextResponse.json({ error: 'Unauthorized: Invalid API Key' }, { status: 401 });
        }

        // Verification ping (e.g. testing with only api_key in Postman)
        const callerNumber = getParam('caller_number') || getParam('cid') || getParam('CustomerNumber') || getParam('phone') || getParam('From') || '';
        if (!callerNumber) {
            return NextResponse.json({ 
                success: true, 
                message: 'API key verified successfully. Sticky Agent endpoint is active.' 
            });
        }

        const cleanNumber = callerNumber.replace(/^\+?\d{1,3}/, '').slice(-10);
        const supabaseAdmin = getSupabaseAdmin();

        // 1. Look up the lead to find the assigned agent (fetch all data for popup)
        const { data: leads } = await supabaseAdmin
            .from('leads')
            .select('*')
            .ilike('phone', `%${cleanNumber}%`)
            .limit(1);

        const lead = leads?.[0];
        
        if (!lead || !lead.assigned_to) {
            // No lead found or no assigned agent. Return empty so Ozonetel falls back to common skill
            return NextResponse.json({ phone_name: "" });
        }

        // 2. Look up the agent's mobile number and status (use maybeSingle to avoid 406 on missing/deleted user)
        const { data: user } = await supabaseAdmin
            .from('users')
            .select('phone, current_status') 
            .eq('id', lead.assigned_to)
            .maybeSingle();

        if (user && user.phone) {
            // Check if agent is actually available to take calls
            if (user.current_status === 'offline' || user.current_status === 'break') {
                console.warn(`[Ozonetel Sticky] Agent ${lead.assigned_to} is currently '${user.current_status}'. Refusing sticky route so Ozonetel sends call to General Queue.`);
                return NextResponse.json({ phone_name: "" });
            }

            // Broadcast pre-ring screen pop cleanly without channel leak
            console.warn(`[Ozonetel Sticky] Broadcasting pre-ring SCREEN_POP for agent: ${lead.assigned_to}`);
            await broadcastScreenPop(supabaseAdmin, {
                call_uuid: getParam('uuid') || getParam('monitorUCID') || `sticky-${Date.now()}`,
                extension: user.phone,
                target_agent_id: lead.assigned_to,
                caller_number: callerNumber,
                direction: 'Inbound',
                lead: lead
            });

            // Return the agent's phone number as 'phone_name' for Ozonetel's skill-based routing
            return NextResponse.json({ phone_name: user.phone });
        }

        // Fallback
        return NextResponse.json({ phone_name: "" });

    } catch (error: any) {
        console.error('Ozonetel Sticky API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
