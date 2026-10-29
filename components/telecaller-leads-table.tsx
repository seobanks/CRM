"use client"

import { useState, useTransition } from "react"
import { createClient } from "@/lib/supabase/client"
import { 
  Building, ChevronDown, ChevronUp, ArrowUpRight, 
  Copy, PhoneMissed, MessageSquare, Loader2, Phone, PhoneOutgoing,
  Sparkles, Calendar, User, Clock, CheckCircle2, ClipboardCopy, ExternalLink, MapPin, Flame
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { LeadStatusDialog } from "@/components/lead-status-dialog" 
import { QuickActions } from "@/components/quick-actions" 
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination"
import { useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"

import { initiateCloudConnectCall } from "@/app/actions/cloudconnect" 
import { initiateC2CCall } from "@/app/actions/c2c-dialer"
import { useTenant } from "@/context/tenant-provider"

interface Lead {
  id: string
  name: string
  email: string
  phone: string
  company: string
  status: string
  priority: string
  created_at: string
  last_contacted: string | null
  loan_amount: number | null
  loan_type: string | null
  source: string | null
  city: string | null
  tags?: string[]
}

interface TelecallerLeadsTableProps {
  leads: Lead[]
  totalCount: number
  currentPage: number
  pageSize: number
  sortBy: string
  sortOrder: string
}

export function TelecallerLeadsTable({ 
  leads = [], 
  totalCount = 0, 
  currentPage = 1, 
  pageSize = 20,
  sortBy,
  sortOrder
}: TelecallerLeadsTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [isPending, startTransition] = useTransition()
  const org = useTenant()

  // State
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false)
  const [isCallInitiated, setIsCallInitiated] = useState(false)
  const [isDialingC2C, setIsDialingC2C] = useState<string | null>(null) // Tracks which lead is currently connecting

  const isToday = (dateString: string) => {
    if (!dateString) return false
    const d = new Date(dateString)
    const now = new Date()
    return d.getDate() === now.getDate() &&
           d.getMonth() === now.getMonth() &&
           d.getFullYear() === now.getFullYear()
  }

  const sortedLeads = leads; // Use server-side sorted leads directly

  // --- 1. HANDLE SORTING ---
  const handleSort = (field: string) => {
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (sortBy === field) {
        params.set('sort_order', sortOrder === 'asc' ? 'desc' : 'asc')
      } else {
        params.set('sort_by', field)
        params.set('sort_order', 'desc')
      }
      router.push(`?${params.toString()}`)
    })
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return <ChevronDown className="ml-1 h-3 w-3 opacity-20" />
    return sortOrder === 'asc' 
      ? <ChevronUp className="ml-1 h-3 w-3 text-indigo-600" /> 
      : <ChevronDown className="ml-1 h-3 w-3 text-indigo-600" />
  }

  // --- 2. ACTIONS ---
  
  // Standard Call (tel: link)
  const handleStandardCallInitiated = (lead: Lead) => {
    setSelectedLead(lead)
    setIsStatusDialogOpen(true)
    setIsCallInitiated(true)
    setTimeout(() => {
      window.location.href = `tel:${lead.phone}`
    }, 100)
  }

  // C2C Cloud Call
  const handleC2CCallInitiated = async (leadId: string, customerPhone: string) => {
      const lead = leads.find(l => l.id === leadId);
      if (!lead) return;

      setIsDialingC2C(leadId); // Show loading spinner
      
      try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Agent session not found. Please log in.");

          const { data: userData } = await supabase.from('users').select('cloudconnect_enabled').eq('id', user.id).single();
          const isCloudConnectEnabled = org?.enabled_modules?.includes('cloudconnect_telephony') && userData?.cloudconnect_enabled;
          
          if (isCloudConnectEnabled) {
              toast.info("Initiating cloud call...", { description: "Please wait for your phone to ring." });
              
              const sessionId = localStorage.getItem("cc_session_id");
              if (!sessionId) throw new Error("Softphone not initialized. Ensure the dialer is connected.");

              const result = await initiateCloudConnectCall(customerPhone, user.id, sessionId);
              
              if (result.success) {
                  toast.success(result.message);
                  setSelectedLead(lead);
                  setIsCallInitiated(true);
                  setIsStatusDialogOpen(true);
              } else {
                  toast.error(result.error || "Failed to initiate call");
              }
          } else {
              toast.info("Initiating call...", { description: "Dialing through legacy system..." });
              const result = await initiateC2CCall(leadId, customerPhone);
              
              if (result.success) {
                  toast.success("Call Successful", { description: "Your phone should be ringing now!" });
                  setSelectedLead(lead);
                  setIsCallInitiated(true);
                  setIsStatusDialogOpen(true);
              } else {
                  toast.error("Call Failed", { description: result.error || "Could not connect call." });
              }
          }
      } catch (error: any) {
          toast.error("Call failed", { description: error.message });
      } finally {
          setIsDialingC2C(null);
      }
  }

  const handleCallLogged = (callLogId: string) => {
    setIsCallInitiated(false)
    router.refresh()
  }

  const handleNextLead = () => {
    if (!selectedLead) return;
    
    // If the status update was not part of an active call flow,
    // just close the dialog and do not auto-advance to the next lead.
    if (!isCallInitiated) {
        setIsStatusDialogOpen(false);
        setSelectedLead(null);
        return;
    }
    
    const currentIndex = sortedLeads.findIndex(l => l.id === selectedLead.id);
    let nextIndex = -1;

    if (currentIndex !== -1 && currentIndex < sortedLeads.length - 1) {
        nextIndex = currentIndex + 1;
    } else if (currentIndex === -1 && sortedLeads.length > 0) {
        nextIndex = 0;
    }

    if (nextIndex !== -1 && sortedLeads[nextIndex]) {
        const nextLead = sortedLeads[nextIndex];
        
        setTimeout(() => {
            setSelectedLead(nextLead);
            setIsCallInitiated(true); 
            setIsStatusDialogOpen(true);
        }, 50); 
    } else {
        setIsStatusDialogOpen(false);
        setSelectedLead(null);
        toast.success("List completed! No more leads to call.");
    }
  }

  const handleQuickNR = async (e: React.MouseEvent, lead: Lead) => {
    e.stopPropagation();
    toast.message("Marking No Response...", { description: "Scheduling callback for tomorrow." });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(11, 0, 0, 0);

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");
        
        const { data: profile } = await supabase.from('users').select('tenant_id').eq('id', user.id).single();
        const tenantId = profile?.tenant_id;

        const followUpPayload: any = {
            lead_id: lead.id,
            user_id: user.id,
            scheduled_at: tomorrow.toISOString(),
            status: "pending",
            title: `Retry: ${lead.name}`,
            notes: "Auto-scheduled: No Response"
        };
        if (tenantId) followUpPayload.tenant_id = tenantId;

        await Promise.all([
             supabase.from("leads").update({ 
                 status: 'nr', 
                 last_contacted: new Date().toISOString() 
             }).eq('id', lead.id),
             supabase.from("follow_ups").insert(followUpPayload)
        ]);
        
        router.refresh();
        toast.success("Marked NR");
    } catch (error) {
        toast.error("Failed to update");
    }
  }

  const getWhatsAppLink = (phone: string, name: string) => {
    if (!phone) return "#"
    const cleanedPhone = phone.replace(/\D/g, '')
    const message = `Hi ${name || "there"}, this is from ICICI Bank regarding your loan inquiry.`
    return `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(message)}`
  }

  const copyToClipboard = (text: string) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    toast.success("Copied to clipboard")
  }

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '-'
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
  }

  const handleStatusUpdate = async (newStatus: string, note?: string, callbackDate?: string) => {
    const isAutoNext = typeof window !== 'undefined' && localStorage.getItem("crm_auto_next") !== "false";
    
    if (isCallInitiated && isAutoNext) {
        // Do not close the dialog immediately, handleNextLead will transition it smoothly.
    } else {
        setIsStatusDialogOpen(false)
        setSelectedLead(null)
    }
    router.refresh()
  }

  const totalPages = Math.ceil(totalCount / pageSize)

  if (sortedLeads.length === 0) {
    return <div className="p-12 text-center text-slate-500 border border-dashed rounded-lg">No leads found.</div>
  }

  return (
    <div className="space-y-4">
      
      {/* 💻 DESKTOP DENSE VIEW (hidden md:block) */}
      <div className={cn(
        "hidden md:block rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden relative transition-opacity duration-200", 
        isPending ? "opacity-50 pointer-events-none" : "opacity-100"
      )}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50 dark:bg-slate-950 sticky top-0 z-10 shadow-sm border-b border-slate-200 dark:border-slate-800">
              <TableRow>
                <TableHead className="w-[240px] font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3.5 pl-4">Quick Dialer</TableHead>
                <TableHead className="w-[180px] cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3.5" onClick={() => handleSort('name')}>
                    <div className="flex items-center">Customer Name <SortIcon field="name"/></div>
                </TableHead>
                <TableHead className="w-[140px] cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3.5" onClick={() => handleSort('created_at')}>
                    <div className="flex items-center">Created Date <SortIcon field="created_at"/></div>
                </TableHead>
                <TableHead className="w-[120px] font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3.5">Status</TableHead>
                <TableHead className="w-[140px] cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3.5" onClick={() => handleSort('loan_amount')}>
                    <div className="flex items-center">Amount <SortIcon field="loan_amount"/></div>
                </TableHead>
                <TableHead className="w-[130px] cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3.5" onClick={() => handleSort('priority')}>
                    <div className="flex items-center text-center justify-center">Priority <SortIcon field="priority"/></div>
                </TableHead>
                <TableHead className="w-[150px] font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3.5">Last Contacted</TableHead>
                <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3.5 pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
               {sortedLeads.map((lead) => {
                const isHighPriority = lead.priority === 'high';
                const neverContacted = !lead.last_contacted;
                const isDialing = isDialingC2C === lead.id;
                const isHot = Array.isArray(lead.tags) && lead.tags.some(t => t.includes("Hot Prospect"));
                const isDNC = Array.isArray(lead.tags) && lead.tags.some(t => t.includes("Do Not Call"));
                
                return (
                  <TableRow key={lead.id} className={cn(
                    "group transition-all duration-200 border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/50 dark:hover:bg-slate-800/30", 
                    neverContacted ? "border-l-4 border-l-red-500 bg-red-50/30 dark:bg-red-950/10" :
                    isHighPriority ? "border-l-4 border-l-red-500 bg-red-500/[0.01]" : "",
                    isHot ? "bg-orange-500/[0.02] hover:bg-orange-500/[0.04] border-l-4 border-l-orange-500 font-medium" : "",
                    isDNC ? "opacity-60 bg-red-50/5 hover:bg-red-50/10 border-l-4 border-l-red-400" : ""
                  )}>
                    {/* Quick Dialer */}
                    <TableCell className="py-3 pl-4">
                        <div className="flex items-center gap-1.5">
                            {isDialing ? (
                                <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1.5 rounded-lg border border-indigo-100 dark:border-indigo-900/50 text-xs font-semibold w-[180px]">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting...
                                </div>
                            ) : (
                                <QuickActions 
                                    phone={lead.phone || ""} 
                                    email={lead.email || ""} 
                                    leadId={lead.id} 
                                    onCallInitiated={() => handleStandardCallInitiated(lead)} 
                                    onC2CCallInitiated={handleC2CCallInitiated}
                                />
                            )}

                            {!isDialing && (
                              <div className="flex items-center gap-1">
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button onClick={() => copyToClipboard(lead.phone || '')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors border border-slate-100 dark:border-slate-800/80 bg-slate-50/30 dark:bg-slate-900">
                                                <Copy className="h-3.5 w-3.5" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent>Copy Number</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <a href={getWhatsAppLink(lead.phone || '', lead.name)} target="_blank" className="p-2 rounded-lg bg-emerald-50/50 hover:bg-emerald-100/80 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400 transition-colors border border-emerald-100/50 dark:border-emerald-900/30">
                                                <MessageSquare className="h-3.5 w-3.5" />
                                            </a>
                                        </TooltipTrigger>
                                        <TooltipContent>WhatsApp Conversation</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                              </div>
                            )}
                        </div>
                    </TableCell>
                    
                    {/* Customer Info */}
                    <TableCell className="py-3">
                      <div className="flex flex-col">
                        <Link href={`/telecaller/leads/${lead.id}`} className="font-bold text-slate-800 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1.5 group/link text-[13px]">
                            {lead.name}
                            {neverContacted && (
                                <Badge className="text-[9px] px-1.5 py-0 rounded-md font-extrabold bg-red-600 hover:bg-red-600 text-white shadow-sm animate-pulse shrink-0">
                                    HIGH
                                </Badge>
                            )}
                            {isToday(lead.created_at) && lead.last_contacted && (
                                <Badge className="text-[9px] px-1.5 py-0 rounded-md font-semibold bg-emerald-500/10 hover:bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                                    TODAY
                                </Badge>
                            )}
                            <ArrowUpRight className="h-3 w-3 opacity-0 group-hover/link:opacity-100 transition-opacity text-indigo-500" />
                        </Link>
                        {lead.company && (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5 truncate max-w-[170px]">
                                <Building className="h-3 w-3 text-slate-400" /> {lead.company}
                            </span>
                        )}
                        
                        {/* Custom tags in visual lists */}
                        {Array.isArray(lead.tags) && lead.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5 max-w-[200px]">
                                {lead.tags.map((tag) => {
                                  let tagStyle = "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
                                  if (tag.includes("Hot Prospect")) tagStyle = "bg-orange-500/10 text-orange-600 border-orange-500/20 font-bold shadow-sm dark:bg-orange-500/20 dark:text-orange-400";
                                  if (tag.includes("Do Not Call")) tagStyle = "bg-red-500/10 text-red-600 border-red-500/20 font-bold dark:bg-red-500/20 dark:text-red-400";
                                  if (tag.includes("Cold Lead")) tagStyle = "bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400";
                                  
                                  return (
                                    <Badge key={tag} variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4.5 font-medium tracking-wide", tagStyle)}>
                                        {tag}
                                    </Badge>
                                  );
                                })}
                            </div>
                        )}
                      </div>
                    </TableCell>

                    {/* Created Date */}
                    <TableCell className="text-slate-600 dark:text-slate-400 text-xs py-3 font-medium whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          <Calendar className="h-3 w-3 text-indigo-500" />
                          {new Date(lead.created_at).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono pl-4">
                          {new Date(lead.created_at).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    </TableCell>

                    {/* Status Pill */}
                    <TableCell className="py-3">
                        <Badge variant="outline" className={cn(
                           "capitalize font-bold border-0 px-2.5 py-1 text-[11px] rounded-full shadow-sm w-fit", 
                           lead.status === 'new' || lead.status === 'New Lead' ? 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400' :
                           lead.status === 'Interested' || lead.status === 'Interested' ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400' :
                           lead.status === 'Disbursed' || lead.status === 'converted' ? 'bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400' :
                           lead.status === 'follow_up' || lead.status === 'follow-up' ? 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400' :
                           'bg-slate-500/10 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400'
                        )}>
                         {lead.status?.replace(/_/g, " ")}
                        </Badge>
                    </TableCell>

                    {/* Amount */}
                    <TableCell className="font-mono text-[13px] font-semibold text-slate-700 dark:text-slate-300 py-3">
                        {formatCurrency(lead.loan_amount)}
                    </TableCell>

                    {/* Priority Accent */}
                    <TableCell className="py-3 text-center">
                        <div className="flex justify-center">
                          {lead.priority === 'high' && <Badge className="text-[9px] px-2 py-0.5 rounded-full font-extrabold bg-gradient-to-r from-rose-500 to-red-500 text-white shadow-sm">HIGH</Badge>}
                          {lead.priority === 'medium' && <Badge className="text-[9px] px-2 py-0.5 rounded-full font-extrabold bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">MED</Badge>}
                          {lead.priority === 'low' && <Badge variant="outline" className="text-[9px] px-2 py-0.5 rounded-full font-medium text-slate-500 border-slate-300 dark:border-slate-700 dark:text-slate-400">LOW</Badge>}
                        </div>
                    </TableCell>

                    {/* Last Contacted */}
                    <TableCell className="text-slate-500 dark:text-slate-400 text-xs py-3 font-medium">
                      {lead.last_contacted ? (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(lead.last_contacted).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-600 italic">Never Contacted</span>
                      )}
                    </TableCell>

                    {/* Action Set */}
                    <TableCell className="text-right py-3 pr-4">
                        <div className="flex justify-end gap-1.5">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            className="h-8 w-8 p-0 text-slate-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/20 rounded-lg"
                                            onClick={(e) => handleQuickNR(e, lead)}
                                        >
                                            <PhoneMissed className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Log No-Response</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 rounded-lg px-2.5 border border-transparent hover:border-indigo-100 dark:hover:border-indigo-900/50" 
                              onClick={() => { setSelectedLead(lead); setIsStatusDialogOpen(true); }}
                            >
                                Update Status
                            </Button>
                        </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* 📱 MOBILE PREMIUM CRM CARDS FEED (block md:hidden) */}
      <div className={cn(
        "block md:hidden space-y-3.5 relative",
        isPending ? "opacity-50 pointer-events-none" : "opacity-100"
      )}>
        {sortedLeads.map((lead, index) => {
          const isHighPriority = lead.priority === 'high';
          const neverContacted = !lead.last_contacted;
          const isDialing = isDialingC2C === lead.id;
          const isHot = Array.isArray(lead.tags) && lead.tags.some(t => t.includes("Hot Prospect"));
          const isDNC = Array.isArray(lead.tags) && lead.tags.some(t => t.includes("Do Not Call"));
          
          // Generate simulated AI Lead Score & Conversion Probabilities
          const score = isHighPriority ? 94 : lead.priority === 'medium' ? 76 : 38;
          const statusColors = {
            high: "bg-red-500",
            medium: "bg-amber-500",
            low: "bg-slate-400",
          };

          return (
            <div 
              key={lead.id} 
              className={cn(
                "relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 transition-all duration-300 active:scale-[0.99] flex flex-col gap-3.5",
                neverContacted ? "border-red-300 dark:border-red-900/50 bg-red-50/20 dark:bg-red-950/10" : "",
                isHot ? "shadow-orange-500/5 shadow-md border-orange-200 dark:border-orange-950/30" : "",
                isDNC ? "opacity-60 bg-red-50/5 border-red-200 dark:border-red-950/30" : ""
              )}
            >
              {/* Left Edge Priority Indicator Ribbon */}
              <div className={cn(
                "absolute top-4 bottom-4 left-0 w-[4px] rounded-r-lg",
                neverContacted ? "bg-red-500" :
                isHighPriority ? "bg-red-500" : lead.priority === 'medium' ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-700"
              )} />

              {/* Top Row: Info and Status Badge */}
              <div className="flex items-start justify-between gap-2 pl-2">
                <div className="space-y-0.5">
                  <Link 
                    href={`/telecaller/leads/${lead.id}`} 
                    className="font-extrabold text-[15px] text-slate-900 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1.5 flex-wrap"
                  >
                    <span>{lead.name}</span>
                    {lead.score && lead.score >= 50 && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center text-orange-500 bg-orange-100 dark:bg-orange-900/30 px-1.5 py-0.5 rounded-md shadow-sm border border-orange-200 dark:border-orange-800">
                                        <Flame className="h-3.5 w-3.5 animate-pulse mr-1" />
                                        <span className="text-[10px] font-bold">{lead.score}</span>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>Hot Prospect!</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                    {neverContacted && (
                        <Badge className="text-[9px] px-1.5 py-0 rounded-md font-extrabold bg-red-600 hover:bg-red-600 text-white shadow-sm animate-pulse shrink-0">
                            HIGH
                        </Badge>
                    )}
                    {isToday(lead.created_at) && lead.last_contacted && (
                        <Badge className="text-[9px] px-1.5 py-0 rounded-md font-semibold bg-emerald-500/10 hover:bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                            TODAY
                        </Badge>
                    )}
                    <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                    {lead.company && (
                      <span className="flex items-center gap-1">
                        <Building className="h-3 w-3 text-slate-400" /> {lead.company}
                      </span>
                    )}
                    <span className="text-slate-300 dark:text-slate-700">•</span>
                    <span className="flex items-center gap-1 font-mono text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                      <Calendar className="h-3 w-3" />
                      {new Date(lead.created_at).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </span>
                  </div>
                </div>

                <Badge variant="outline" className={cn(
                   "capitalize font-bold border-0 px-2.5 py-0.5 text-[10px] rounded-full", 
                   lead.status === 'new' || lead.status === 'New Lead' ? 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400' :
                   lead.status === 'Interested' || lead.status === 'Interested' ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400' :
                   lead.status === 'Disbursed' || lead.status === 'converted' ? 'bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400' :
                   lead.status === 'follow_up' || lead.status === 'follow-up' ? 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400' :
                   'bg-slate-500/10 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400'
                )}>
                  {lead.status?.replace(/_/g, " ")}
                </Badge>
              </div>

              {/* Middle Section: AI scores, amounts, callbacks (Compact flex wrap Grid) */}
              <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-950 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 text-[11px] font-medium text-slate-600 dark:text-slate-400 pl-4">
                
                {/* AI Lead Quality Score */}
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500 animate-pulse fill-indigo-500/10" />
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">AI Lead Score</p>
                    <p className="font-extrabold text-slate-800 dark:text-slate-200">
                      {score}% ({isHighPriority ? "🔥 Hot" : lead.priority === 'medium' ? "🟡 Warm" : "❄ Cold"})
                    </p>
                  </div>
                </div>

                {/* Amount Requested */}
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">Loan Amount</p>
                    <p className="font-extrabold text-slate-800 dark:text-slate-200 font-mono">
                      {formatCurrency(lead.loan_amount)}
                    </p>
                  </div>
                </div>

                {/* Best Time to Call */}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Calendar className="h-3.5 w-3.5 text-indigo-500" />
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">Best Time To Call</p>
                    <p className="font-extrabold text-slate-800 dark:text-slate-200">
                      {isHighPriority ? "2:30 PM - 4:00 PM" : "Anytime Office Hrs"}
                    </p>
                  </div>
                </div>

                {/* Conversion Probability */}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">Conv. Prob.</p>
                    <p className={cn(
                      "font-extrabold",
                      isHighPriority ? "text-emerald-600 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300"
                    )}>
                      {score}% Probability
                    </p>
                  </div>
                </div>

              </div>

              {/* Tag Badges */}
              {Array.isArray(lead.tags) && lead.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-2">
                  {lead.tags.map((tag) => {
                    let tagStyle = "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
                    if (tag.includes("Hot Prospect")) tagStyle = "bg-orange-500/10 text-orange-600 border-orange-500/20 font-bold dark:bg-orange-500/20 dark:text-orange-400";
                    if (tag.includes("Do Not Call")) tagStyle = "bg-red-500/10 text-red-600 border-red-500/20 font-bold dark:bg-red-500/20 dark:text-red-400";
                    if (tag.includes("Cold Lead")) tagStyle = "bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400";
                    
                    return (
                      <Badge key={tag} variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4.5 font-medium tracking-wide", tagStyle)}>
                          {tag}
                      </Badge>
                    );
                  })}
                </div>
              )}

              {/* Divider */}
              <div className="h-[1px] bg-slate-100 dark:bg-slate-800/80 w-full" />

              {/* Bottom Row: Quick Thumb Actions Group */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full pl-2">
                <div className="flex items-center gap-2 justify-start">
                  {/* WhatsApp trigger */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a 
                          href={getWhatsAppLink(lead.phone || '', lead.name)} 
                          target="_blank" 
                          className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-900/30 active:scale-95 transition-transform"
                        >
                          <MessageSquare className="h-4.5 w-4.5" />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent>WhatsApp customer</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {/* Cloud C2C Call (Icon Button next to WhatsApp) */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button 
                          onClick={() => handleC2CCallInitiated(lead.id, lead.phone)} 
                          className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100/50 dark:border-indigo-900/30 active:scale-95 transition-transform flex items-center justify-center"
                          title="Cloud C2C Call"
                          disabled={isDialingC2C !== null}
                        >
                          {isDialing ? (
                            <Loader2 className="h-4.5 w-4.5 animate-spin" />
                          ) : (
                            <PhoneOutgoing className="h-4.5 w-4.5" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Cloud C2C Call</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {/* Copy Number */}
                  <button 
                    onClick={() => copyToClipboard(lead.phone || '')} 
                    className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-400 hover:text-slate-700 active:scale-95 transition-transform"
                    title="Copy Customer Number"
                  >
                    <Copy className="h-4.5 w-4.5" />
                  </button>

                  {/* Log Dialer No Response */}
                  <button 
                    onClick={(e) => handleQuickNR(e, lead)} 
                    className="p-2.5 rounded-xl border border-rose-200 dark:border-rose-950/30 bg-rose-50/30 dark:bg-rose-950/10 text-rose-500 active:scale-95 transition-transform"
                    title="Log No Response"
                  >
                    <PhoneMissed className="h-4.5 w-4.5" />
                  </button>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  {/* Update Status Button */}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-xs font-bold text-slate-600 dark:text-slate-400 h-9 rounded-xl active:scale-95 px-3 flex-1 sm:flex-none bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                    onClick={() => { setSelectedLead(lead); setIsStatusDialogOpen(true); }}
                  >
                    Update
                  </Button>

                  {/* PRIMARY DIAL ACTION - Manual Call (visually strongest) */}
                  <Button 
                    size="sm" 
                    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-9 px-4 text-xs font-extrabold shadow-sm flex items-center justify-center gap-1.5 active:scale-95 transition-transform flex-1 sm:flex-none"
                    onClick={() => handleStandardCallInitiated(lead)}
                  >
                    <Phone className="h-3.5 w-3.5 fill-indigo-200/20" /> Call Now
                  </Button>
                </div>
              </div>

            </div>
          );
        })}
      </div>

      {/* Pagination View */}
      <div className="py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
        {totalPages > 1 && (
            <Pagination>
            <PaginationContent>
                <PaginationItem>
                <PaginationPrevious href={`?page=${Math.max(1, currentPage - 1)}`} className={currentPage === 1 ? 'pointer-events-none opacity-50' : ''}/>
                </PaginationItem>
                <PaginationItem><div className="px-4 text-sm font-semibold text-slate-500">Page {currentPage} of {totalPages}</div></PaginationItem>
                <PaginationItem>
                <PaginationNext href={`?page=${Math.min(totalPages, currentPage + 1)}`} className={currentPage >= totalPages ? 'pointer-events-none opacity-50' : ''}/>
                </PaginationItem>
            </PaginationContent>
            </Pagination>
        )}
      </div>

      {selectedLead && (
        <LeadStatusDialog
          key={selectedLead.id} 
          leadId={selectedLead.id}
          currentStatus={selectedLead.status}
          open={isStatusDialogOpen}
          onOpenChange={(open) => {
            setIsStatusDialogOpen(open)
            if (!open) { setIsCallInitiated(false); setSelectedLead(null); }
          }}
          onStatusUpdate={handleStatusUpdate}
          isCallInitiated={isCallInitiated}
          onCallLogged={handleCallLogged}
          leadPhoneNumber={selectedLead.phone}
          telecallerName="Agent"
          onNextLead={handleNextLead}
        />
      )}
    </div>
  )
}

