"use server"

import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

function getAdminClient() {
    return createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        }
    )
}

async function resolveUserTenantId(supabaseAdmin: any, userId: string): Promise<string> {
    // 1. Check user profile first
    const { data: profile } = await supabaseAdmin
        .from('users')
        .select('tenant_id, role')
        .eq('id', userId)
        .single();

    if (profile?.tenant_id) {
        return profile.tenant_id;
    }

    // 2. If user owns an organization
    const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .eq('owner_id', userId)
        .maybeSingle();

    if (org?.id) {
        await supabaseAdmin.from('users').update({ tenant_id: org.id }).eq('id', userId);
        return org.id;
    }

    // 3. If there is any organization, pick the first one
    const { data: firstOrg } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .limit(1)
        .maybeSingle();

    if (firstOrg?.id) {
        await supabaseAdmin.from('users').update({ tenant_id: firstOrg.id }).eq('id', userId);
        return firstOrg.id;
    }

    return "default_tenant";
}

export async function getWorkspaceSettings() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        const supabaseAdmin = getAdminClient();
        const tenantId = await resolveUserTenantId(supabaseAdmin, user.id);

        const { data, error } = await supabaseAdmin
            .from('tenant_settings')
            .select(`
                fonada_client_id, fonada_secret, fonada_waba_number, whatsapp_api_key, whatsapp_ai_agent_enabled,
                cron_auto_checkout, cron_auto_refill, cron_daily_report, 
                cron_kyc, cron_sla, cron_smart_notifications, unicorn_api_key,
                ivr_digit_auto_assign
            `)
            .eq('tenant_id', tenantId)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') {
            console.error("Error fetching workspace settings:", error);
            throw error;
        }

        // Fetch workflow_triggers from organizations for IVR DTMF automation settings
        const { data: orgData } = await supabaseAdmin
            .from('organizations')
            .select('workflow_triggers')
            .eq('id', tenantId)
            .maybeSingle();

        const workflowTriggers = orgData?.workflow_triggers || {};

        return {
            success: true,
            tenantId,
            data: {
                ...(data || {}),
                ivr_dtmf_template: workflowTriggers.ivr_dtmf_template || 'application_status_update',
                ivr_dtmf_campaign: workflowTriggers.ivr_dtmf_campaign || 'StatusUpdateAlert',
                ivr_dtmf_digit: workflowTriggers.ivr_dtmf_digit || 'any',
            }
        };
    } catch (error: any) {
        console.error("Get Settings Error:", error);
        return {
            success: false,
            error: error.message || "Failed to load settings",
            data: null
        };
    }
}

export async function updateWorkspaceSettings(formData: {
    fonada_client_id: string;
    fonada_secret: string;
    fonada_waba_number?: string;
    whatsapp_api_key: string;
    whatsapp_ai_agent_enabled: boolean;
    cron_auto_checkout: boolean;
    cron_auto_refill: boolean;
    cron_daily_report: boolean;
    cron_kyc: boolean;
    cron_sla: boolean;
    cron_smart_notifications: boolean;
    unicorn_api_key: string;
    ivr_digit_auto_assign: boolean;
    ivr_dtmf_template?: string;
    ivr_dtmf_campaign?: string;
    ivr_dtmf_digit?: string;
}) {
    try {
        const supabase = await createClient()
        
        // 1. Ensure user is authenticated
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error("Unauthorized")

        const supabaseAdmin = getAdminClient()
        const tenantId = await resolveUserTenantId(supabaseAdmin, user.id)

        // 2. UPSERT settings using Admin Client (handles both insert if new & bypasses RLS blocks)
        const payload = {
            tenant_id: tenantId,
            fonada_client_id: formData.fonada_client_id || "",
            fonada_secret: formData.fonada_secret || "",
            fonada_waba_number: formData.fonada_waba_number ? String(formData.fonada_waba_number).replace(/\D/g, '') : null,
            whatsapp_api_key: formData.whatsapp_api_key || "",
            whatsapp_ai_agent_enabled: Boolean(formData.whatsapp_ai_agent_enabled),
            cron_auto_checkout: Boolean(formData.cron_auto_checkout),
            cron_auto_refill: Boolean(formData.cron_auto_refill),
            cron_daily_report: Boolean(formData.cron_daily_report),
            cron_kyc: Boolean(formData.cron_kyc),
            cron_sla: Boolean(formData.cron_sla),
            cron_smart_notifications: Boolean(formData.cron_smart_notifications),
            unicorn_api_key: formData.unicorn_api_key || "",
            ivr_digit_auto_assign: Boolean(formData.ivr_digit_auto_assign),
            updated_at: new Date().toISOString()
        };

        const { error, data } = await supabaseAdmin
            .from('tenant_settings')
            .upsert(payload, { onConflict: 'tenant_id' })
            .select()
            .single();

        if (error) {
            console.error("Supabase upsert error in updateWorkspaceSettings:", error);
            throw error;
        }

        // 3. Save IVR DTMF workflow configuration into organizations.workflow_triggers
        const { data: orgData } = await supabaseAdmin
            .from('organizations')
            .select('workflow_triggers')
            .eq('id', tenantId)
            .maybeSingle();

        const currentTriggers = orgData?.workflow_triggers || {};
        const updatedTriggers = {
            ...currentTriggers,
            ivr_dtmf_template: formData.ivr_dtmf_template || 'application_status_update',
            ivr_dtmf_campaign: formData.ivr_dtmf_campaign || 'StatusUpdateAlert',
            ivr_dtmf_digit: formData.ivr_dtmf_digit || 'any'
        };

        const { error: orgError } = await supabaseAdmin
            .from('organizations')
            .update({ workflow_triggers: updatedTriggers })
            .eq('id', tenantId);

        if (orgError) {
            console.error("Error saving workflow_triggers in organizations:", orgError);
        }

        return { 
            success: true, 
            message: "Workspace settings updated successfully!", 
            data: {
                ...data,
                ivr_dtmf_template: updatedTriggers.ivr_dtmf_template,
                ivr_dtmf_campaign: updatedTriggers.ivr_dtmf_campaign,
                ivr_dtmf_digit: updatedTriggers.ivr_dtmf_digit
            } 
        }

    } catch (error: any) {
        console.error("Settings Update Error:", error)
        return { success: false, error: error.message || "Failed to update settings" }
    }
}
