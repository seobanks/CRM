"use client"
import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Trophy, Medal, IndianRupee, Target } from "lucide-react"

export function LiveLeaderboard() {
    const [leaders, setLeaders] = useState<{name: string, revenue: number, deals: number}[]>([])
    const supabase = createClient()
    const { useTenant } = require("@/context/tenant-provider")
    const org = useTenant()

    const isRealEstate = org?.industry === 'real_estate'
    const title = isRealEstate ? "Top Deal Makers" : "Top Closers"
    const unit = isRealEstate ? "Deals" : "Disbursed"
    const emptyText = isRealEstate ? "No closed deals yet. Be the first!" : "No disbursed leads yet. Be the first!"

    useEffect(() => {
        const fetchLeaders = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            let tenantId = org?.id;
            if (!tenantId) {
                const { data: profile } = await supabase
                    .from('users')
                    .select('tenant_id')
                    .eq('id', user.id)
                    .single();
                tenantId = profile?.tenant_id;
            }

            if (!tenantId) return;

            if (isRealEstate) {
                // Real Estate uses deals table
                const { data, error } = await supabase
                    .from('agent_leaderboard_view')
                    .select('*')
                    .eq('tenant_id', tenantId)
                    .order('total_revenue', { ascending: false })
                    .order('deals_closed', { ascending: false })
                    .limit(5);

                if (!error && data) {
                    setLeaders(data.map((d: any) => ({
                        name: d.agent_name,
                        revenue: d.total_revenue,
                        deals: d.deals_closed
                    })));
                }
            } else {
                // General CRM uses leads table with disbursed amount
                const { data: leadsData, error } = await supabase
                    .from('leads')
                    .select('assigned_to, disbursed_amount, users!leads_assigned_to_fkey(full_name)')
                    .eq('tenant_id', tenantId)
                    .eq('status', 'Disbursed');

                if (!error && leadsData) {
                    const agentStats: Record<string, { name: string, revenue: number, deals: number }> = {};
                    leadsData.forEach(lead => {
                        const agentId = lead.assigned_to;
                        if (!agentId) return;
                        
                        if (!agentStats[agentId]) {
                            agentStats[agentId] = {
                                name: (lead.users as any)?.full_name || 'Unknown Agent',
                                revenue: 0,
                                deals: 0
                            };
                        }
                        agentStats[agentId].revenue += Number(lead.disbursed_amount || 0);
                        agentStats[agentId].deals += 1;
                    });

                    const sortedLeaders = Object.values(agentStats)
                        .sort((a, b) => b.revenue - a.revenue || b.deals - a.deals)
                        .slice(0, 5);
                    
                    setLeaders(sortedLeaders);
                }
            }
        }
        
        fetchLeaders();
        
        // Optimize: Poll every 60 seconds instead of listening to all database changes
        const intervalId = setInterval(() => {
            fetchLeaders();
        }, 5 * 60 * 1000);
            
        return () => { 
            clearInterval(intervalId);
        }
    }, [supabase, isRealEstate])

    return (
        <Card className="border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm rounded-2xl overflow-hidden relative group">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                <Trophy className="h-24 w-24 text-yellow-500" />
            </div>
            <CardHeader className="bg-gradient-to-r from-slate-900 to-slate-800 dark:from-slate-950 dark:to-slate-900 text-white pb-3 rounded-t-2xl">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Trophy className="h-4.5 w-4.5 text-yellow-500" /> {title}
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-3 p-2 space-y-2 relative z-10">
                {leaders.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-4">{emptyText}</p>
                ) : null}
                
                {leaders.map((leader, index) => (
                    <div key={index} className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <div className="flex items-center gap-2.5">
                            {index === 0 && <Medal className="h-4.5 w-4.5 text-yellow-500" />}
                            {index === 1 && <Medal className="h-4.5 w-4.5 text-slate-400" />}
                            {index === 2 && <Medal className="h-4.5 w-4.5 text-amber-600" />}
                            {index > 2 && <span className="w-4.5 text-center font-bold text-slate-400 text-xs">{index + 1}</span>}
                            
                            <div>
                                <span className="font-bold text-slate-800 dark:text-slate-200 text-sm leading-tight block">{leader.name}</span>
                                <span className="text-[10px] text-slate-500 font-semibold">{leader.deals} {unit}</span>
                            </div>
                        </div>
                        <div className="flex items-center text-emerald-600 dark:text-emerald-400 font-black text-sm">
                            <IndianRupee className="h-3 w-3 mr-0.5" />
                            {leader.revenue.toLocaleString('en-IN')}
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}
