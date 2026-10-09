import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// 🔴 KILL ALL CACHING DEAD
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(request: Request) {
  // 1. CRON SECURITY
  const authHeader = request.headers.get('authorization');
  const { searchParams } = new URL(request.url);
  const queryKey = searchParams.get('key');
  const secret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV !== 'development' && authHeader !== `Bearer ${secret}` && queryKey !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log("\n=======================================================");
  console.log("⛽ [CRON START] Running Multi-Tenant Auto-Refill Engine...");
  console.log("=======================================================");

  try {
    // Admin client to bypass RLS for background multi-tenant operations
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        global: { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } }
      }
    );

    // 🔴 1. FETCH TENANTS WITH AUTO-REFILL ENABLED
    const { data: activeTenants, error: tenantError } = await supabaseAdmin
      .from("tenant_settings")
      .select("tenant_id")
      .eq("cron_auto_refill", true);

    if (tenantError) throw tenantError;

    if (!activeTenants || activeTenants.length === 0) {
        console.log("⏸️ [REFILL] No workspaces have auto-refill enabled. Skipping.");
        return NextResponse.json({ status: "skipped", message: "No opted-in tenants" });
    }

    let globalTotalRefilled = 0;
    let globalStarvedAgents = 0;

    // 🔴 2. LOOP THROUGH EACH ISOLATED TENANT
    for (const tenant of activeTenants) {
        const tenantId = tenant.tenant_id;
        console.log(`\n🏢 Processing Tenant ID: ${tenantId}`);

        // GET ALL CHECKED-IN AGENTS FOR THIS TENANT
        const maxShiftStart = new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString();
        const { data: attendanceData } = await supabaseAdmin
            .from("attendance")
            .select("user_id")
            .eq("tenant_id", tenantId) // ISOLATION
            .gte("check_in", maxShiftStart)
            .is("check_out", null);            

        const checkedInUserIds = attendanceData?.map(a => a.user_id) || [];
        
        if (checkedInUserIds.length === 0) {
            console.log("   ⏭️ No agents checked in for this workspace. Skipping.");
            continue;
        }

        const { data: onlineUsers } = await supabaseAdmin
            .from("users")
            .select("id, full_name, role")
            .eq("tenant_id", tenantId) // ISOLATION
            .in("id", checkedInUserIds);

        const activeTelecallers = onlineUsers?.filter(user => 
            ["telecaller", "agent", "user"].includes((user.role || "").toLowerCase())
        ) || [];

        if (activeTelecallers.length === 0) {
            console.log("   ⏭️ No valid telecallers found online. Skipping.");
            continue;
        }

        // CHECK WHO IS STARVED (0 New Leads)
        const { data: currentNewLeads } = await supabaseAdmin
            .from("leads")
            .select("id, assigned_to, created_at, status")
            .eq("tenant_id", tenantId) // ISOLATION
            .ilike("status", "new")
            .in("assigned_to", activeTelecallers.map(a => a.id))
            .limit(10000);

        const newLeadCounts: Record<string, number> = {};
        activeTelecallers.forEach(t => newLeadCounts[t.id] = 0);
        
        const sampleGhostLeads: any[] = [];

        if (currentNewLeads) {
            currentNewLeads.forEach(lead => {
                if (lead.assigned_to && newLeadCounts[lead.assigned_to] !== undefined) {
                    newLeadCounts[lead.assigned_to]++;
                    
                    if (sampleGhostLeads.length < 5) {
                        sampleGhostLeads.push(lead);
                    }
                }
            });
        }

        console.log("   📊 Current 'New' Lead Counts:");
        activeTelecallers.forEach(agent => {
            console.log(`     - ${agent.full_name}: ${newLeadCounts[agent.id]}`);
        });

        if (sampleGhostLeads.length > 0) {
            console.log("   👻 [GHOST CHECK] 3 leads the DB says are 'new':");
            sampleGhostLeads.slice(0, 3).forEach(lead => {
                console.log(`      -> ID: ${lead.id} | Created: ${lead.created_at} | Agent: ${lead.assigned_to}`);
            });
        }

        const starvedAgents = activeTelecallers.filter(agent => newLeadCounts[agent.id] === 0);
        globalStarvedAgents += starvedAgents.length;

        console.log(`   ⚠️ Found ${starvedAgents.length} starved agents.`);

        let tenantRefilled = 0;

        // REFILL STARVED AGENTS FROM THEIR OWN POOL IN BULK
        const totalNeeded = starvedAgents.length * 10;
        
        if (totalNeeded > 0) {
            const { data: allPoolLeads, error: poolError } = await supabaseAdmin
                .from("leads")
                .select("id, notes")
                .eq("tenant_id", tenantId) // ISOLATION: Only pull leads from this company!
                .in("status", ["nr", "NR", "Not Reachable", "not_reachable", "Not_Reachable"]) 
                .order("last_contacted", { ascending: true, nullsFirst: true }) 
                .limit(totalNeeded);

            if (poolError) {
                console.error(`   ❌ [SQL ERROR]`, poolError.message);
                continue;
            }

            const updatePromises = [];

            for (let i = 0; i < starvedAgents.length; i++) {
                const agent = starvedAgents[i];
                console.log(`   🔍 Assigning from pool for: ${agent.full_name}`);

                const poolLeads = allPoolLeads ? allPoolLeads.slice(i * 10, i * 10 + 10) : [];

                if (!poolLeads || poolLeads.length === 0) {
                    console.log(`   ⚠️ No Response (NR) pool is empty/exhausted for this workspace! Cannot refill ${agent.full_name}.`);
                    continue; 
                }

                for (const lead of poolLeads) {
                    const refillNote = `⛽ [SYSTEM: AUTO-REFILL]\nLead recycled from 'No Response (NR)'. Reassigned to ${agent.full_name} as a fresh lead.`;
                    const updatedNotes = lead.notes ? `${lead.notes}\n\n${refillNote}` : refillNote;

                    const updatePromise = supabaseAdmin
                        .from("leads")
                        .update({
                            assigned_to: agent.id,
                            status: "new",
                            notes: updatedNotes,
                            last_contacted: new Date().toISOString() 
                        })
                        .eq("id", lead.id)
                        .eq("tenant_id", tenantId) // Strict match just in case
                        .then(({ error: updateError }) => {
                            if (!updateError) {
                                tenantRefilled++;
                                globalTotalRefilled++;
                            }
                        });

                    updatePromises.push(updatePromise);
                }
                
                console.log(`   ✅ Prepared ${poolLeads.length} leads for ${agent.full_name}`);
            }

            if (updatePromises.length > 0) {
                await Promise.all(updatePromises);
            }
        }
    } // End of Tenant Loop

    console.log("\n=======================================================");
    console.log(`🏁 [CRON COMPLETE] Total leads recycled globally: ${globalTotalRefilled}`);
    console.log("=======================================================");
    
    return NextResponse.json({ 
        status: "success", 
        agents_starved: globalStarvedAgents,
        leads_recycled: globalTotalRefilled 
    });

  } catch (error: any) {
    console.error("🔥 [REFILL FATAL ERROR]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
