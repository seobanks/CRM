"use server"

import { createClient } from "@supabase/supabase-js"
import { invalidateDidCache } from "@/lib/did-registry-cache"

const getSupabaseAdmin = () => {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

export async function getAllDids() {
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin.from('tenant_did_registry').select('*').order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return data
}

export async function getAllOrganizations() {
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin.from('organizations').select('id, name').order('name')
    if (error) throw new Error(error.message)
    return data
}

export async function addDid(tenant_id: string, did_number: string, label: string, is_active: boolean) {
    const supabaseAdmin = getSupabaseAdmin()
    const { error } = await supabaseAdmin.from('tenant_did_registry').insert({
        tenant_id,
        did_number,
        label,
        is_active
    })
    if (error) throw new Error(error.message)
    invalidateDidCache()
    return true
}

export async function toggleDidStatus(id: string, is_active: boolean) {
    const supabaseAdmin = getSupabaseAdmin()
    const { error } = await supabaseAdmin.from('tenant_did_registry').update({ is_active }).eq('id', id)
    if (error) throw new Error(error.message)
    invalidateDidCache()
    return true
}

export async function deleteDid(id: string) {
    const supabaseAdmin = getSupabaseAdmin()
    const { error } = await supabaseAdmin.from('tenant_did_registry').delete().eq('id', id)
    if (error) throw new Error(error.message)
    invalidateDidCache()
    return true
}
