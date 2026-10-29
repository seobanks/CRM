"use client";

import { useState, useEffect, useMemo, useRef, useCallback, useTransition } from "react"
import Link from "next/link"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { 
  User, Building, Calendar, Clock, Eye, Phone, Mail, 
  Search, Filter, ChevronDown, ChevronUp, Download, 
  MoreHorizontal, Check, X, AlertCircle, Star,
  TrendingUp, TrendingDown, Activity, MessageSquare,
  FileText, PhoneCall, Send, Tag, Plus, Trash2,
  BarChart3, Users, DollarSign, Target, Zap,
  Layout, Table as TableIcon, Settings, Save,
  AlertTriangle, CheckCircle2, XCircle, Sparkles, Upload,
  Pencil, RefreshCw, Skull, Loader2, Flame
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { LeadStatusDialog } from "@/components/lead-status-dialog"
import { classifySentiment } from "@/components/lead-status-updater"
import { sendBulkCampaign } from "@/app/actions/campaigns"
import { toast } from "sonner"
import { QuickActions } from "@/components/quick-actions"
import { PowerDialer } from "@/components/power-dialer"
import { 
  Dialog, DialogContent, DialogDescription, DialogFooter, 
  DialogHeader, DialogTitle, DialogTrigger 
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useTenant, useMasterStatuses } from "@/context/tenant-provider"
import { MASTER_STATUSES } from "@/lib/lead-statuses"

const MAX_LEAD_CAP = 450; 

const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

const isStale = (lastContacted: string | null, status: string) => {
  if (['Disbursed', 'not_eligible', 'Not_Interested', 'nr', 'dead_bucket', 'recycle_pool'].includes(status)) return false; 
  if (!lastContacted) return true; 
  const diffHours = (new Date().getTime() - new Date(lastContacted).getTime()) / (1000 * 60 * 60);
  return diffHours > 48; 
};

interface KanbanColumn {
  id: string
  title: string
  color: string
}

const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'new', title: 'New Leads', color: 'bg-blue-500' },
  { id: 'contacted', title: 'Contacted', color: 'bg-yellow-500' },
  { id: 'Interested', title: 'Interested', color: 'bg-orange-500' },
  { id: 'Documents_Sent', title: 'Docs Sent', color: 'bg-purple-500' },
  { id: 'Login', title: 'Login', color: 'bg-indigo-500' },
  { id: 'follow_up', title: 'Follow Up', color: 'bg-pink-500' },
  { id: 'Disbursed', title: 'Disbursed', color: 'bg-green-600' },
  { id: 'nr', title: 'Not Reachable', color: 'bg-gray-400' },
  { id: 'Not_Interested', title: 'Not Interested', color: 'bg-red-500' },
  { id: 'recycle_pool', title: 'Recycle Pool', color: 'bg-cyan-500' },
  { id: 'dead_bucket', title: 'Dead Bucket', color: 'bg-slate-700' },
  { id: 'self_employed', title: 'Self Employed', color: 'bg-amber-500' },
  { id: 'not_eligible', title: 'Not Eligible', color: 'bg-red-900' },
]

const parseCSV = (text: string) => {
  const lines = text.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
  
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
    const entry: any = {};
    headers.forEach((h, i) => {
      if (h.includes('name')) entry.name = values[i];
      else if (h.includes('email')) entry.email = values[i];
      else if (h.includes('phone') || h.includes('contact')) entry.phone = values[i];
      else if (h.includes('amount')) entry.loan_amount = parseFloat(values[i]) || 0;
      else if (h.includes('type')) entry.loan_type = values[i];
      else if (h.includes('company')) entry.company = values[i];
      else if (h.includes('source')) entry.source = values[i];
      else if (h.includes('city')) entry.city = values[i];
      else if (h.includes('notes')) entry.notes = values[i];
    });
    entry.status = entry.status || 'new';
    entry.priority = entry.priority || 'medium';
    entry.created_at = new Date().toISOString();
    return entry;
  });
};

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
  assigned_to: string | null
  assigned_user: {
    id: string
    full_name: string
  } | null
  city: string | null
  follow_up_date: string | null
  lead_score?: number
  tags?: string[]
  notes?: string
}

interface SavedFilter {
  id: string
  name: string
  filters: any
}

interface LeadsTableProps {
  leads: Lead[]
  telecallers: Array<{ id: string; full_name: string }>
  telecallerStatus?: Record<string, boolean>
  totalLeads: number
  currentPage: number
  pageSize: number
}

interface InlineEditableCellProps {
    value: string | number | null;
    onSave: (newValue: string) => Promise<void>;
    type?: "text" | "number" | "email" | "tel";
    className?: string;
    suffix?: React.ReactNode;
}

const InlineEditableCell = ({ value, onSave, type = "text", className, suffix }: InlineEditableCellProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [currentValue, setCurrentValue] = useState(value?.toString() || "");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setCurrentValue(value?.toString() || "");
    }, [value]);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isEditing]);

    const handleSave = async () => {
        setIsEditing(false);
        if (currentValue !== (value?.toString() || "")) {
           await onSave(currentValue);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleSave();
        } else if (e.key === "Escape") {
            setIsEditing(false);
            setCurrentValue(value?.toString() || "");
        }
    };

    if (isEditing) {
        return (
            <div className="flex items-center gap-1">
                <Input
                    ref={inputRef}
                    type={type}
                    value={currentValue}
                    onChange={(e) => setCurrentValue(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                    className="h-7 text-xs px-2 min-w-[120px]"
                />
            </div>
        );
    }

    return (
        <div 
            onClick={() => setIsEditing(true)} 
            className={cn(
                "cursor-pointer hover:bg-muted/50 rounded px-1.5 py-0.5 -ml-1.5 border border-transparent hover:border-border transition-colors group flex items-center gap-2",
                !value && "text-muted-foreground italic",
                className
            )}
            title="Click to edit"
        >
            <span className="truncate">{value || "Empty"}</span>
            {suffix}
            <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-30 transition-opacity flex-shrink-0" />
        </div>
    );
};

const triggerButtonClass = "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3";
const triggerGhostClass = "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 px-3";

export function LeadsTable({ leads = [], telecallers = [], telecallerStatus = {}, totalLeads, currentPage, pageSize }: LeadsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = createClient()
  const [isPending, startTransition] = useTransition();

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [viewMode, setViewMode] = useState<'table' | 'board'>('table')
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false)
  const [isCallInitiated, setIsCallInitiated] = useState(false)
  const [isPowerDialerOpen, setIsPowerDialerOpen] = useState(false)

  const org = useTenant()
  const masterStatuses = useMasterStatuses()
  const currentMasterStatuses = masterStatuses.length > 0 ? masterStatuses : MASTER_STATUSES
  const enabledStatusValues = org?.enabled_statuses || currentMasterStatuses.map(s => s.value)
  const availableStatuses = currentMasterStatuses.filter(s => enabledStatusValues.includes(s.value))

  const kanbanColumns = useMemo(() => {
    return availableStatuses.map(s => {
      const color = s.btnColor.split(' ')[0] || 'bg-slate-500'
      return { id: s.value, title: s.label, color: color }
    })
  }, [availableStatuses])

  const handleExportAll = (status: string) => {
    window.location.href = `/api/admin/leads/export?status=${status}`;
  }

  // 1. Protected Debounce Sync state
  const [inputValue, setInputValue] = useState(searchParams.get("search") || "")
  const lastPushedValue = useRef(searchParams.get("search") || "")
  
  // 2. Sync from URL to input (ONLY if updated by the top search bar)
  useEffect(() => {
    const currentUrlSearch = searchParams.get("search") || "";
    if (currentUrlSearch !== lastPushedValue.current) {
      setInputValue(currentUrlSearch);
      lastPushedValue.current = currentUrlSearch;
    }
  }, [searchParams]);

  // 3. Debounce local state to URL
  useEffect(() => {
    if (inputValue === lastPushedValue.current) return;

    const timer = setTimeout(() => {
      lastPushedValue.current = inputValue;
      
      const params = new URLSearchParams(window.location.search);
      if (inputValue) params.set("search", inputValue);
      else params.delete("search");
      
      params.set("page", "1");

      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [inputValue, pathname, router]);

  const createQueryString = useCallback((name: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== 'all') {
      params.set(name, value)
    } else {
      params.delete(name)
    }
    if (name !== 'page') params.set('page', '1');
    return params.toString()
  }, [searchParams])

  const handleFilterChange = (key: string, value: string) => {
    startTransition(() => {
      router.push(`${pathname}?${createQueryString(key, value)}`, { scroll: false });
    });
  }

  // Read current filters from URL
  const statusFilter = searchParams.get('status') || 'all'
  const priorityFilter = searchParams.get('priority') || 'all'
  const assignedToFilter = searchParams.get('assigned_to') || 'all'
  const sourceFilter = searchParams.get('source') || 'all'
  const sortField = searchParams.get('sort') || 'created_at'
  const sortDirection = searchParams.get('dir') || 'desc'
  
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    name: true, contact: false, company: false, status: true,
    notes: true, priority: false, score: true, created: true,
    lastContacted: true, loanAmount: true, loanType: false, 
    source: false, tags: true, assignedTo: true, actions: false
  })

  const [selectedLeads, setSelectedLeads] = useState<string[]>([])
  const [bulkAssignTo, setBulkAssignTo] = useState<string[]>([])
  const [bulkStatus, setBulkStatus] = useState<string>("")
  const [bulkTagInput, setBulkTagInput] = useState("") 
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])
  const [filterName, setFilterName] = useState("")
  const [showSaveFilterDialog, setShowSaveFilterDialog] = useState(false)
  const [availableTags, setAvailableTags] = useState<string[]>([
    "VIP", "Hot Lead", "Referral", "Event", "Follow Up", "High Value"
  ])
  const [newTag, setNewTag] = useState("")
  const [selectedLeadForTags, setSelectedLeadForTags] = useState<Lead | null>(null)
  const [showEmailDialog, setShowEmailDialog] = useState(false)
  const [showSMSDialog, setShowSMSDialog] = useState(false)
  const [showWhatsAppDialog, setShowWhatsAppDialog] = useState(false)
  const [emailSubject, setEmailSubject] = useState("")
  const [emailBody, setEmailBody] = useState("")
  const [smsBody, setSmsBody] = useState("")
  const [whatsappBody, setWhatsappBody] = useState("")
  const [showAutoAssignDialog, setShowAutoAssignDialog] = useState(false)
  const [autoAssignRules, setAutoAssignRules] = useState({
    enabled: false, method: 'round-robin', criteria: '',
    reassignNR: false, reassignInterested: false 
  })
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string>("")
  const [errorMessage, setErrorMessage] = useState<string>("")
  const [duplicates, setDuplicates] = useState<any[]>([])
  const [showDuplicatesDialog, setShowDuplicatesDialog] = useState(false)

  const calculateLeadScore = (lead: Lead): number => {
    let score = 0
    if (lead.loan_amount) {
      if (lead.loan_amount >= 5000000) score += 30
      else if (lead.loan_amount >= 2000000) score += 20
      else if (lead.loan_amount >= 1000000) score += 10
    }
    if (lead.created_at) {
      const daysOld = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24))
      if (daysOld <= 1) score += 25
      else if (daysOld <= 3) score += 20
      else if (daysOld <= 7) score += 15
      else if (daysOld <= 14) score += 10
      else if (daysOld <= 30) score += 5
    }
    const statusScores: Record<string, number> = {
      'Interested': 20, 'Documents_Sent': 18, 'Login': 15, 'contacted': 12, 'follow_up': 10,
      'nr':0, 'new': 8, 'Not_Interested': 2, 'not_eligible': 1, 'self_employed': 1, 'recycle_pool': 5, 'dead_bucket': 0
    }
    score += statusScores[lead.status] || 5
    if (lead.priority === 'high') score += 15
    else if (lead.priority === 'medium') score += 10
    else score += 5
    const sourceScores: Record<string, number> = {
      'referral': 10, 'website': 8, 'social_media': 6, 'other': 3
    }
    score += sourceScores[lead.source?.toLowerCase() || 'other'] || 5
    return Math.min(score, 100)
  }

  const enrichedLeads = useMemo(() => {
    return leads.map(lead => ({
      ...lead,
      lead_score: calculateLeadScore(lead),
      tags: Array.isArray(lead.tags) ? lead.tags : [] 
    }))
  }, [leads])

  const uniqueSources = useMemo(() => {
    const sources = new Set(enrichedLeads.map(l => l.source).filter(Boolean))
    return Array.from(sources)
  }, [enrichedLeads])

  const uniqueTags = useMemo(() => {
    const tags = new Set(enrichedLeads.flatMap(l => l.tags || []))
    return Array.from(tags)
  }, [enrichedLeads])

  const totalPages = Math.ceil(totalLeads / (pageSize > 0 ? pageSize : 1))

  const handlePageSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value === "") return;
    const newSize = parseInt(value)
    if (!isNaN(newSize) && newSize > 0) {
      startTransition(() => {
        router.push(`${pathname}?${createQueryString('limit', newSize.toString())}`, { scroll: false });
      });
    }
  }

  const handlePageChange = (page: number) => {
    startTransition(() => {
      router.push(`${pathname}?${createQueryString('page', page.toString())}`, { scroll: false });
    });
  }

  const handleInlineUpdate = async (leadId: string, field: string, value: string | number) => {
    try {
        const { error } = await supabase
            .from("leads")
            .update({ [field]: value })
            .eq("id", leadId);

        if (error) throw error;
        router.refresh(); 
    } catch (error) {
        console.error("Error updating lead inline:", error);
        setErrorMessage("Failed to update field");
    }
  };

  const detectDuplicates = () => {
    const phoneMap = new Map<string, Lead[]>()
    const emailMap = new Map<string, Lead[]>()
    enrichedLeads.forEach(lead => {
      if (lead.phone) {
        if (!phoneMap.has(lead.phone)) phoneMap.set(lead.phone, [])
        phoneMap.get(lead.phone)!.push(lead)
      }
      if (lead.email) {
        if (!emailMap.has(lead.email)) emailMap.set(lead.email, [])
        emailMap.get(lead.email)!.push(lead)
      }
    })
    const dups: any[] = []
    phoneMap.forEach((leads, phone) => {
      if (leads.length > 1) dups.push({ type: 'phone', value: phone, leads })
    })
    emailMap.forEach((leads, email) => {
      if (leads.length > 1) dups.push({ type: 'email', value: email, leads })
    })
    setDuplicates(dups)
    setShowDuplicatesDialog(true)
  }

  const handleBulkResolveDuplicates = async () => {
    if (duplicates.length === 0) return;

    const idsToUpdate = new Set<string>();

    duplicates.forEach(group => {
        const sortedLeads = [...group.leads].sort((a: Lead, b: Lead) => 
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        for (let i = 1; i < sortedLeads.length; i++) {
            idsToUpdate.add(sortedLeads[i].id);
        }
    });

    if (idsToUpdate.size === 0) {
        alert("No duplicates found to update.");
        return;
    }

    if (!confirm(`This will move ${idsToUpdate.size} older duplicates to 'Dead Bucket'. The newest leads will remain active. Continue?`)) {
        return;
    }

    try {
        const { error } = await supabase
            .from('leads')
            .update({ 
                status: 'dead_bucket',
                last_contacted: new Date().toISOString(),
                notes: 'System: Auto-resolved duplicate (kept newest version).' 
            }) 
            .in('id', Array.from(idsToUpdate));

        if (error) throw error;

        setSuccessMessage(`Successfully moved ${idsToUpdate.size} duplicates to Dead Bucket.`);
        setShowDuplicatesDialog(false);
        router.refresh();
        
    } catch (error: any) {
        console.error("Error updating duplicates:", error);
        setErrorMessage(error.message || "Failed to update duplicates.");
    }
  }

  const exportToCSV = () => {
    const columnMapping: Record<string, { label: string; value: (l: Lead) => any }[]> = {
      name: [{ label: 'Name', value: l => l.name }],
      contact: [
        { label: 'Phone', value: l => l.phone },
        { label: 'Email', value: l => l.email }
      ],
      company: [{ label: 'Company', value: l => l.company }],
      status: [{ label: 'Status', value: l => l.status }],
      priority: [{ label: 'Priority', value: l => l.priority }],
      score: [{ label: 'Lead Score', value: l => l.lead_score }],
      created: [{ label: 'Created At', value: l => l.created_at }],
      lastContacted: [{ label: 'Last Contacted', value: l => l.last_contacted }],
      loanAmount: [{ label: 'Loan Amount', value: l => l.loan_amount }],
      notes: [{ label: 'Notes', value: l => l.notes }],
      loanType: [{ label: 'Loan Type', value: l => l.loan_type }],
      source: [{ label: 'Source', value: l => l.source }],
      assignedTo: [{ label: 'Assigned To', value: l => l.assigned_user?.full_name || l.assigned_to }],
      tags: [{ label: 'Tags', value: l => Array.isArray(l.tags) ? l.tags.join('; ') : l.tags }]
    }

    const activeColumns = Object.keys(visibleColumns)
      .filter(key => visibleColumns[key])
      .flatMap(key => columnMapping[key] || [])

    const csvContent = [
      activeColumns.map(col => col.label).join(','),
      ...enrichedLeads.map(lead => 
        activeColumns.map(col => {
          let val = col.value(lead)
          if (val === null || val === undefined) return ''
          if (typeof val === 'string') {
            return `"${val.replace(/"/g, '""')}"` 
          }
          return val
        }).join(',')
      )
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-export-${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }

  const saveCurrentFilter = () => {
    const filter = {
      id: Date.now().toString(),
      name: filterName,
      filters: {
        searchTerm: inputValue, statusFilter, priorityFilter, assignedToFilter,
        sourceFilter
      }
    }
    setSavedFilters([...savedFilters, filter])
    setFilterName("")
    setShowSaveFilterDialog(false)
    localStorage.setItem('savedFilters', JSON.stringify([...savedFilters, filter]))
  }

  useEffect(() => {
    const saved = localStorage.getItem('savedFilters')
    if (saved) setSavedFilters(JSON.parse(saved))
  }, [])

  const handleSort = (field: string) => {
    startTransition(() => {
      if (sortField === field) {
        const newDir = sortDirection === 'asc' ? 'desc' : 'asc'
        router.push(`${pathname}?${createQueryString('dir', newDir)}`, { scroll: false });
      } else {
        const params = new URLSearchParams(searchParams.toString())
        params.set('sort', field)
        params.set('dir', 'desc')
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      }
    });
  }

  const handleBulkEmail = async () => {
    if (selectedLeads.length === 0) return
    const res = await sendBulkCampaign(selectedLeads, 'email', emailSubject, emailBody)
    if (res.success) {
      toast.success(`Sent emails to ${res.count} leads`)
      setSelectedLeads([])
    } else {
      toast.error(`Failed to send emails: ${res.error}`)
    }
    setShowEmailDialog(false)
    setEmailSubject("")
    setEmailBody("")
  }

  const handleBulkSMS = async () => {
    if (selectedLeads.length === 0) return
    const res = await sendBulkCampaign(selectedLeads, 'sms', '', smsBody)
    if (res.success) {
      toast.success(`Sent SMS to ${res.count} leads`)
      setSelectedLeads([])
    } else {
      toast.error(`Failed to send SMS: ${res.error}`)
    }
    setShowSMSDialog(false)
    setSmsBody("")
  }

  const handleBulkWhatsApp = async () => {
    if (selectedLeads.length === 0) return
    const res = await sendBulkCampaign(selectedLeads, 'whatsapp', '', whatsappBody)
    if (res.success) {
      toast.success(`Sent WhatsApp to ${res.count} leads`)
      setSelectedLeads([])
    } else {
      toast.error(`Failed to send WhatsApp: ${res.error}`)
    }
    setShowWhatsAppDialog(false)
    setWhatsappBody("")
  }

 const handleBulkAssign = async () => {
    if (bulkAssignTo.length === 0 || selectedLeads.length === 0) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      const assignedById = user?.id

      const telecallerIds = bulkAssignTo
      
      const updates = selectedLeads.map((leadId, index) => {
        const telecallerId = telecallerIds[index % telecallerIds.length]
        
        return supabase
          .from("leads")
          .update({
            assigned_to: telecallerId,
            assigned_by: assignedById,
            assigned_at: new Date().toISOString(),
            status: 'new', 
            last_contacted: new Date().toISOString()
          })
          .eq("id", leadId)
      })

      const results = await Promise.all(updates)
      const errors = results.filter(result => result.error)
      if (errors.length > 0) {
        throw new Error(`Failed to assign ${errors.length} leads.`)
      }
      
      setSuccessMessage(`Successfully assigned ${selectedLeads.length} leads.`)
      setSelectedLeads([])
      setBulkAssignTo([]) 
      router.refresh()
      
    } catch (error: any) {
      console.error("Error bulk assigning leads:", error)
      setErrorMessage(error.message || "Failed to assign leads")
    }
  }

  const handleBulkStatusUpdate = async () => {
    if (!bulkStatus || selectedLeads.length === 0) return

    try {
      const updates = selectedLeads.map(async (leadId) => {
         let updateData: any = { status: bulkStatus, last_contacted: new Date().toISOString() };
         return supabase.from("leads").update(updateData).eq("id", leadId);
      })

      await Promise.all(updates)
      setSelectedLeads([])
      setBulkStatus("")
      router.refresh()
    } catch (error) { console.error("Error bulk updating lead status:", error) }
  }

  const handleBulkAddTag = async (tag: string) => {
    if (selectedLeads.length === 0 || !tag.trim()) return

    try {
      const updates = selectedLeads.map(async (leadId) => {
        const lead = enrichedLeads.find(l => l.id === leadId)
        const currentTags = lead?.tags || []
        
        if (!currentTags.includes(tag)) {
          return supabase
            .from("leads")
            .update({ 
              tags: [...currentTags, tag]
            })
            .eq("id", leadId)
        }
        return Promise.resolve({ error: null })
      })

      const results = await Promise.all(updates)
      const errors = results.filter(result => result.error)
      if (errors.length > 0) throw new Error(`Failed to add tag to ${errors.length} leads`)

      setSelectedLeads([])
      setBulkTagInput("")
      router.refresh()
    } catch (error) {
      console.error("Error adding tag:", error)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedLeads.length === 0) return
    
    if (!confirm(`Are you sure you want to delete ${selectedLeads.length} leads? This action cannot be undone.`)) {
        return;
    }

    try {
        const { error, count } = await supabase
            .from('leads')
            .delete({ count: 'exact' })
            .in('id', selectedLeads)

        if (error) throw error

        if (count === 0) {
            setErrorMessage("Operation successful but 0 leads were deleted. Check permissions.");
        } else {
            setSelectedLeads([])
            setSuccessMessage(`Successfully deleted ${count} leads.`)
            router.refresh()
        }
    } catch (error) {
        console.error("Error deleting leads:", error)
        setErrorMessage("Failed to delete leads")
    }
  }

  const handleAutoAssignLeads = async () => {
    if (!autoAssignRules.enabled || telecallers.length === 0) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      const now = new Date()

      const activeTelecallers = telecallers.filter(tc => {
        const isOnline = telecallerStatus[tc.id] === true
        const currentLoad = enrichedLeads.filter(l => l.assigned_to === tc.id).length
        return isOnline && currentLoad < MAX_LEAD_CAP
      })

      if (activeTelecallers.length === 0) {
        alert(`No available telecallers found (Online and <${MAX_LEAD_CAP} leads).`)
        return
      }

      const unassignedLeads = enrichedLeads.filter(l => !l.assigned_to && l.status !== 'dead_bucket')

      let leadsToReassign: Lead[] = []
      
      if (autoAssignRules.reassignNR) {
        const staleNR = enrichedLeads.filter(l => {
          if (l.status !== 'nr' || !l.assigned_to) return false 
          const lastContact = l.last_contacted
          if (!lastContact) return false 
          const diffHours = (now.getTime() - new Date(lastContact).getTime()) / (1000 * 60 * 60)
          return diffHours > 48
        })
        leadsToReassign = [...leadsToReassign, ...staleNR]
      }

      if (autoAssignRules.reassignInterested) {
        const staleInterested = enrichedLeads.filter(l => {
          if (l.status !== 'Interested' || !l.assigned_to) return false
          const lastContact = l.last_contacted
          if (!lastContact) return false
          const diffHours = (now.getTime() - new Date(lastContact).getTime()) / (1000 * 60 * 60)
          return diffHours > 72
        })
        leadsToReassign = [...leadsToReassign, ...staleInterested]
      }

      const allLeadsToProcess = [...unassignedLeads, ...leadsToReassign]
      const processedLeadIds = new Set<string>();
      const uniqueLeadsToProcess = allLeadsToProcess.filter(lead => {
          if (processedLeadIds.has(lead.id)) return false;
          processedLeadIds.add(lead.id);
          return true;
      });

      if (uniqueLeadsToProcess.length === 0) {
        alert('No leads found matching criteria (Unassigned or Stale) for processing.')
        return
      }
      
      const shuffledTelecallers = shuffleArray(activeTelecallers);
      const assignments: Record<string, string[]> = {}; 
      const reassignedLeadIds: string[] = [];

      const leadCounts = activeTelecallers.map(tc => ({
          id: tc.id,
          count: enrichedLeads.filter(l => l.assigned_to === tc.id).length
      }));
      
      let roundRobinIndex = 0; 

      uniqueLeadsToProcess.forEach((lead) => {
        let newTelecallerId: string | null = null;
        
        let attempts = 0;
        while (attempts < shuffledTelecallers.length) {
            let candidate = shuffledTelecallers[roundRobinIndex % shuffledTelecallers.length];
            const candidateStats = leadCounts.find(c => c.id === candidate.id);

            if (candidateStats && candidateStats.count < MAX_LEAD_CAP) {
                if (!lead.assigned_to || lead.assigned_to !== candidate.id) {
                    newTelecallerId = candidate.id;
                    candidateStats.count++; 
                    roundRobinIndex++;
                    break;
                }
            }
            roundRobinIndex++;
            attempts++;
        }

        if (newTelecallerId) {
            if (!assignments[newTelecallerId]) {
                assignments[newTelecallerId] = [];
            }
            assignments[newTelecallerId].push(lead.id);

            if (lead.assigned_to) {
                reassignedLeadIds.push(lead.id);
            }
        }
      });

      const assignmentPromises = Object.entries(assignments).map(async ([assigneeId, leadIds]) => {
          const response = await fetch('/api/admin/leads/bulk-assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              leadIds: leadIds,
              assignedTo: assigneeId,
              assignerName: 'Auto-Assign'
            })
          })
          if (!response.ok) {
             console.error(`Failed to auto-assign to ${assigneeId}`);
             throw new Error('Auto-assign failed');
          }
      });

      await Promise.all(assignmentPromises);

      if (reassignedLeadIds.length > 0) {
        const { error } = await supabase
            .from("leads")
            .update({
                status: 'new',
                last_contacted: new Date().toISOString()
            })
            .in("id", reassignedLeadIds);
        
        if (error) console.error("Error resetting status for reassigned leads:", error);
      }

      alert(`Auto-assign complete. Leads distributed to ${activeTelecallers.length} agents under capacity.`)
      router.refresh()
      
    } catch (error) {
      console.error("Error auto-assigning leads:", error)
      alert("Error occurred during assignment. Check console.")
    }
  }

  const handleAddTag = async (leadId: string, tag: string) => {
    try {
      const { error } = await supabase
        .from("leads")
        .update({ 
          tags: [...(enrichedLeads.find(l => l.id === leadId)?.tags || []), tag]
        })
        .eq("id", leadId)
      if (error) throw error
      router.refresh()
    } catch (error) {
      console.error("Error adding tag:", error)
    }
  }

  const handleRemoveTag = async (leadId: string, tag: string) => {
    try {
      const lead = enrichedLeads.find(l => l.id === leadId)
      const newTags = (lead?.tags || []).filter(t => t !== tag)
      const { error } = await supabase
        .from("leads")
        .update({ tags: newTags })
        .eq("id", leadId)
      if (error) throw error
      router.refresh()
    } catch (error) {
      console.error("Error removing tag:", error)
    }
  }

  const handleCallInitiated = (lead: Lead) => {
    setSelectedLead(lead)
    setIsStatusDialogOpen(true)
    setIsCallInitiated(true)
  }

  const handleCallLogged = (callLogId: string) => {
    setIsCallInitiated(false)
  }

  // --- AI CALL HANDLER ADDED ---
  const handleAICall = async (lead: Lead) => {
    try {
      alert(`Initiating AI Call to ${lead.name}...`);
      
      const response = await fetch('/api/admin/ai-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          phoneNumber: lead.phone,
          leadName: lead.name
        })
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error);
      
      alert("AI Call connected! The bot is dialing now.");
    } catch (error: any) {
      alert(`Failed to start AI call: ${error.message}`);
    }
  };

  const handleStatusUpdate = async (newStatus: string, note?: string, callbackDate?: string) => {
    try {
      if (!selectedLead?.id) return
      
      let updateData: any = { 
        status: newStatus,
        last_contacted: new Date().toISOString()
      }

      if (newStatus === "not_eligible" && note) {
        await supabase.from("notes").insert({
            lead_id: selectedLead.id,
            note: note,
            note_type: "status_change"
          })
      }

      if (newStatus === "follow_up" && callbackDate) {
        const { error: followUpError } = await supabase
          .from("follow_ups")
          .insert({
            lead_id: selectedLead.id,
            scheduled_date: callbackDate,
            status: "scheduled"
          })
        if (followUpError) throw followUpError
        updateData.follow_up_date = callbackDate
      }

      const { error } = await supabase
        .from("leads")
        .update(updateData)
        .eq("id", selectedLead.id)

      if (error) throw error
      setIsStatusDialogOpen(false)
      setSelectedLead(null)
      router.refresh()
    } catch (error) {
      console.error("Error updating lead status:", error)
    }
  }

  const handleStatusChange = async (leadId: string, newStatus: string) => {
    try {
        const lead = enrichedLeads.find(l => l.id === leadId);
        if(!lead) return;

        let updateData: any = { status: newStatus, last_contacted: new Date().toISOString() };

        // Auto tag sentiment based on status change
        const newSentimentTag = classifySentiment("", newStatus);
        const currentTags = Array.isArray(lead.tags) ? lead.tags : [];
        const cleanTags = currentTags.filter(t => !["Hot Prospect 🔥", "Do Not Call 🚫", "Cold Lead ❄️", "Callback Scheduled ⏰"].includes(t));
        if (newSentimentTag) {
          cleanTags.push(newSentimentTag);
        }
        updateData.tags = cleanTags;

      const { error } = await supabase
        .from("leads")
        .update(updateData)
        .eq("id", leadId)

      if (error) throw error
      toast.success("Lead status updated successfully")
      router.refresh()
    } catch (error) {
      console.error("Error changing lead status:", error)
      toast.error("Failed to update lead status")
    }
  }

  const handleAssignLead = async (leadId: string, telecallerId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const assignedById = user?.id

      const { error } = await supabase
        .from("leads")
        .update({ 
          assigned_to: telecallerId === "unassigned" ? null : telecallerId,
          assigned_by: assignedById,
          assigned_at: new Date().toISOString()
        })
        .eq("id", leadId)
      if (error) throw error
      setSuccessMessage("Lead assigned successfully")
      router.refresh()
    } catch (error) {
      console.error("Error assigning lead:", error)
      setErrorMessage("Failed to assign lead")
    }
  }

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    e.dataTransfer.setData("leadId", leadId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData("leadId");
    await handleStatusChange(leadId, newStatus);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const parsedLeads = parseCSV(text);
        
        if (parsedLeads.length === 0) throw new Error("No valid leads found in CSV");

        const { error } = await supabase.from('leads').insert(parsedLeads);
        if (error) throw error;

        alert(`Successfully imported ${parsedLeads.length} leads!`);
        setIsImportOpen(false);
        router.refresh()
      } catch (err: any) {
        alert("Import failed: " + err.message);
        console.error(err);
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(file);
  };

  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeads(prev => 
      prev.includes(leadId) 
        ? prev.filter(id => id !== leadId)
        : [...prev, leadId]
    )
  }

  const selectAllLeads = () => {
    if (selectedLeads.length === enrichedLeads.length) {
      setSelectedLeads([])
    } else {
      setSelectedLeads(enrichedLeads.map(lead => lead.id))
    }
  }

  const getScoreBadge = (score: number) => {
    if (score >= 80) return { color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30', label: 'Hot', icon: TrendingUp }
    if (score >= 50) return { color: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-100 dark:border-amber-900/30', label: 'Warm', icon: Activity }
    return { color: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border-blue-100 dark:border-blue-900/30', label: 'Cold', icon: TrendingDown }
  }

  const getStatusPillClasses = (status: string) => {
    const found = availableStatuses.find(s => s.value.toLowerCase() === status.toLowerCase());
    if (found) {
      // Use the pill color defined in MASTER_STATUSES, e.g. "bg-cyan-100 text-cyan-800"
      // Add border and font-semibold to match the old design
      return `${found.color} border border-current font-semibold transition-all`;
    }
    return 'bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-400 border border-slate-200 transition-all font-semibold'
  }

  const getSafeValue = (value: any, defaultValue: string = 'N/A') => {
    return value ?? defaultValue
  }

  const getPriorityVariant = (priority: string) => {
    switch (priority) {
      case "high": return "destructive"
      case "medium": return "default"
      default: return "secondary"
    }
  }

  const formatCurrency = (amount: number | null) => {
    if (!amount) return 'N/A'
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount)
  }

  if (!leads) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No leads data available</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Success/Error Messages */}
      {successMessage && (
        <Card className="border-green-500 bg-green-50 dark:bg-green-950/20 dark:border-green-900 mt-4 mx-4">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              <p className="text-sm font-medium text-green-900 dark:text-green-300">{successMessage}</p>
            </div>
          </CardContent>
        </Card>
      )}
      {errorMessage && (
        <Card className="border-red-500 bg-red-50 dark:bg-red-950/20 dark:border-red-900 mt-4 mx-4">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <p className="text-sm font-medium text-red-900 dark:text-red-300">{errorMessage}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Smart Lists (Tabs) */}
      <div className="border-b border-slate-200 dark:border-slate-800 px-4 pt-2 flex gap-6 overflow-x-auto hide-scrollbar">
        {[
          { id: 'all', label: 'All Leads' },
          { id: 'follow_ups', label: "Today's Follow-ups" },
          { id: 'hot_no_contact', label: 'Hot / No Contact' },
          { id: 'unassigned', label: 'Unassigned Pool' },
          { id: 'recycle', label: 'Recycle Bin' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              if (tab.id === 'all') {
                handleFilterChange('status', 'all')
                handleFilterChange('priority', 'all')
                handleFilterChange('assigned_to', 'all')
              } else if (tab.id === 'follow_ups') {
                handleFilterChange('status', 'follow_up')
                handleFilterChange('priority', 'all')
                handleFilterChange('assigned_to', 'all')
              } else if (tab.id === 'hot_no_contact') {
                handleFilterChange('status', 'new')
                handleFilterChange('priority', 'high')
                handleFilterChange('assigned_to', 'all')
              } else if (tab.id === 'unassigned') {
                handleFilterChange('status', 'all')
                handleFilterChange('priority', 'all')
                handleFilterChange('assigned_to', 'unassigned')
              } else if (tab.id === 'recycle') {
                handleFilterChange('status', 'recycle_pool')
                handleFilterChange('priority', 'all')
                handleFilterChange('assigned_to', 'all')
              }
            }}
            className={cn(
              "pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              (
                (tab.id === 'all' && statusFilter === 'all' && priorityFilter === 'all' && assignedToFilter === 'all') ||
                (tab.id === 'follow_ups' && statusFilter === 'follow_up') ||
                (tab.id === 'hot_no_contact' && statusFilter === 'new' && priorityFilter === 'high') ||
                (tab.id === 'unassigned' && assignedToFilter === 'unassigned') ||
                (tab.id === 'recycle' && statusFilter === 'recycle_pool')
              )
                ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between p-4 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center w-full lg:w-auto">
          <div className="relative w-full sm:w-64">
            {isPending ? (
               <Loader2 className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground animate-spin" />
            ) : (
               <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            )}
            <Input
              placeholder="Search phone number..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={(v) => handleFilterChange('status', v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {availableStatuses.map(status => (
                    <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={(v) => handleFilterChange('priority', v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={assignedToFilter} onValueChange={(v) => handleFilterChange('assigned_to', v)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Assigned To" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Assignees</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {telecallers.map((tc) => (
                  <SelectItem key={tc.id} value={tc.id}>{tc.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 w-full lg:w-auto">
            {/* View Switcher */}
            <div className="flex bg-muted rounded-md p-1 mr-2 items-center">
                <Button 
                variant={viewMode === 'table' ? 'secondary' : 'ghost'} 
                size="sm" 
                className="h-7 px-3"
                onClick={() => setViewMode('table')}
                >
                <TableIcon className="h-4 w-4 mr-1" /> List
                </Button>
                <Button 
                variant={viewMode === 'board' ? 'secondary' : 'ghost'} 
                size="sm" 
                className="h-7 px-3"
                onClick={() => setViewMode('board')}
                >
                <Layout className="h-4 w-4 mr-1" /> Board
                </Button>
            </div>

            <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)}>
                <Upload className="h-4 w-4 mr-2" /> Import
            </Button>

          {/* Fixed Dropdown Trigger */}
          <DropdownMenu>
            <DropdownMenuTrigger className={triggerButtonClass}>
              <Filter className="h-4 w-4 mr-2" />
              More Filters
              <ChevronDown className="h-4 w-4 ml-2" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Advanced Filters</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="p-2">
                <Label className="text-xs">Source</Label>
                <Select value={sourceFilter} onValueChange={(v) => handleFilterChange('source', v)}>
                  <SelectTrigger className="w-full mt-1">
                    <SelectValue placeholder="All Sources" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    {uniqueSources.map((source) => (
                      <SelectItem key={source} value={source || ''}>{source}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowSaveFilterDialog(true)}>
                <Save className="h-4 w-4 mr-2" />
                Save Current Filter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={triggerButtonClass}>
              <Layout className="h-4 w-4 mr-2" />
              Columns
              <ChevronDown className="h-4 w-4 ml-2" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {Object.entries(visibleColumns).map(([key, visible]) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={visible}
                  onCheckedChange={(checked) =>
                    setVisibleColumns(prev => ({ ...prev, [key]: checked }))
                  }
                >
                  {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={exportToCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export Page
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger className={triggerButtonClass}>
              <Download className="h-4 w-4 mr-2 text-blue-500" />
              Export All
              <ChevronDown className="h-4 w-4 ml-2" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 max-h-[300px] overflow-y-auto">
              <DropdownMenuLabel>Export by Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleExportAll("all")} className="font-semibold cursor-pointer">
                All Statuses (Full Export)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {availableStatuses.map(s => (
                <DropdownMenuItem key={s.value} onClick={() => handleExportAll(s.value)} className="cursor-pointer">
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={detectDuplicates}>
            <AlertTriangle className="h-4 w-4 mr-2" />
            Duplicates
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger className={triggerButtonClass}>
              <Zap className="h-4 w-4 mr-2" />
              Actions
              <ChevronDown className="h-4 w-4 ml-2" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowAutoAssignDialog(true)}>
                <Users className="h-4 w-4 mr-2" />
                Auto-Assign Rules
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowEmailDialog(true)}>
                <Mail className="h-4 w-4 mr-2" />
                Bulk Email
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowSMSDialog(true)}>
                <MessageSquare className="h-4 w-4 mr-2" />
                Bulk SMS
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowWhatsAppDialog(true)}>
                <MessageSquare className="h-4 w-4 mr-2 text-green-500" />
                Bulk WhatsApp
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Bulk Add Tags</DropdownMenuLabel>
              {availableTags.slice(0, 5).map((tag) => (
                <DropdownMenuItem key={tag} onClick={() => handleBulkAddTag(tag)}>
                  <Tag className="h-4 w-4 mr-2" />
                  Add "{tag}" Tag
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedLeads.length > 0 && viewMode === 'table' && (
        <Card className="border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20 mx-4">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Check className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <span className="font-medium text-blue-900 dark:text-blue-200">
                  {selectedLeads.length} lead{selectedLeads.length !== 1 ? 's' : ''} selected on this page
                </span>
              </div>
              
              <div className="flex flex-wrap gap-2">
                {/* Bulk Status Update */}
                <Select value={bulkStatus} onValueChange={setBulkStatus}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Update Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableStatuses.map(status => (
                        <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button 
                  size="sm" 
                  onClick={handleBulkStatusUpdate}
                  disabled={!bulkStatus}
                >
                  Update
                </Button>

                {/* Power Dialer Button */}
                <Button 
                  size="sm"
                  variant="default"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold tracking-tight shadow-sm"
                  onClick={() => setIsPowerDialerOpen(true)}
                >
                  <PhoneCall className="w-4 h-4 mr-2" />
                  Power Dialer ({selectedLeads.length})
                </Button>

                <Separator orientation="vertical" className="h-8 mx-2" />

                {/* Manual Bulk Assignment */}
                <DropdownMenu>
                  <DropdownMenuTrigger className={`${triggerButtonClass} w-[200px] justify-between border-dashed`}>
                      {bulkAssignTo.length === 0 ? (
                        <span className="text-muted-foreground">Select Assignees</span>
                      ) : bulkAssignTo.length === 1 ? (
                        <span className="truncate">
                          {telecallers.find(t => t.id === bulkAssignTo[0])?.full_name}
                        </span>
                      ) : (
                        <span>{bulkAssignTo.length} Assignees Selected</span>
                      )}
                      <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[200px]" align="start">
                    <DropdownMenuLabel>Select Telecallers</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {telecallers.map((tc) => {
                      const isSelected = bulkAssignTo.includes(tc.id)
                      const isOnline = telecallerStatus[tc.id] === true
                      return (
                        <DropdownMenuCheckboxItem
                          key={tc.id}
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            setBulkAssignTo(prev => {
                              if (checked) return [...prev, tc.id]
                              return prev.filter(id => id !== tc.id)
                            })
                          }}
                        >
                          <div className="flex items-center gap-2 w-full">
                            <div 
                              className={`h-2 w-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} 
                              title={isOnline ? 'Online' : 'Offline'} 
                            />
                            <span>{tc.full_name}</span>
                          </div>
                        </DropdownMenuCheckboxItem>
                      )
                    })}
                    {bulkAssignTo.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          className="justify-center text-center text-xs cursor-pointer"
                          onClick={() => setBulkAssignTo([])}
                        >
                          Clear Selection
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button 
                  size="sm" 
                  onClick={handleBulkAssign}
                  disabled={bulkAssignTo.length === 0}
                >
                  Assign {selectedLeads.length > 0 && bulkAssignTo.length > 0 
                    ? `(${Math.ceil(selectedLeads.length / bulkAssignTo.length)}/ea)` 
                    : ''}
                </Button>

                <div className="flex-1" />

                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={handleBulkDelete}
                  className="ml-auto"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>

                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setSelectedLeads([])}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Area: Table vs Kanban */}
      {viewMode === 'table' ? (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader className="bg-slate-50 dark:bg-slate-950">
                <TableRow>
                    <TableHead className="w-12 pl-4">
                    <input
                        type="checkbox"
                        checked={selectedLeads.length === enrichedLeads.length && enrichedLeads.length > 0}
                        onChange={selectAllLeads}
                        className="rounded border-gray-300"
                    />
                    </TableHead>
                    {visibleColumns.name && (
                    <TableHead className="cursor-pointer" onClick={() => handleSort('name')}>
                        <div className="flex items-center gap-1">
                        Name
                        {sortField === 'name' && (sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                        </div>
                    </TableHead>
                    )}
                    {visibleColumns.contact && <TableHead>Contact</TableHead>}
                    {visibleColumns.company && (
                    <TableHead className="cursor-pointer" onClick={() => handleSort('company')}>
                        <div className="flex items-center gap-1">
                        Company
                        {sortField === 'company' && (sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                        </div>
                    </TableHead>
                    )}
                    {visibleColumns.status && <TableHead>Status</TableHead>}
                    {visibleColumns.priority && <TableHead>Priority</TableHead>}
                    {visibleColumns.score && (
                    <TableHead className="cursor-pointer" onClick={() => handleSort('lead_score')}>
                        <div className="flex items-center gap-1">
                        Score
                        {sortField === 'lead_score' && (sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                        </div>
                    </TableHead>
                    )}
                    {visibleColumns.created && (
                    <TableHead className="cursor-pointer" onClick={() => handleSort('created_at')}>
                        <div className="flex items-center gap-1">
                        Created
                        {sortField === 'created_at' && (sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                        </div>
                    </TableHead>
                    )}
                    {visibleColumns.lastContacted && (
                    <TableHead className="cursor-pointer" onClick={() => handleSort('last_contacted')}>
                        <div className="flex items-center gap-1">
                        Last Call
                        {sortField === 'last_contacted' && (sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                        </div>
                    </TableHead>
                    )}
                    {visibleColumns.loanAmount && (
                    <TableHead className="cursor-pointer" onClick={() => handleSort('loan_amount')}>
                        <div className="flex items-center gap-1">
                        Loan Amount
                        {sortField === 'loan_amount' && (sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                        </div>
                    </TableHead>
                    )}
                    {visibleColumns.notes && <TableHead>Notes</TableHead>}                  
                    {visibleColumns.loanType && <TableHead>Loan Type</TableHead>}
                    {visibleColumns.source && <TableHead>Source</TableHead>}
                    {visibleColumns.assignedTo && <TableHead>Assigned To</TableHead>}
                    {visibleColumns.tags && <TableHead>Tags</TableHead>}
                    {visibleColumns.actions && <TableHead className="w-20">Actions</TableHead>}
                </TableRow>
                </TableHeader>
                <TableBody>
                {enrichedLeads.length === 0 ? (
                    <TableRow>
                    <TableCell colSpan={Object.values(visibleColumns).filter(Boolean).length + 1} className="text-center py-8">
                        <div className="text-gray-500">No leads found on this page</div>
                    </TableCell>
                    </TableRow>
                ) : (
                    enrichedLeads.map((lead) => (
                    <TableRow key={lead.id} className={`group hover:bg-slate-50 dark:hover:bg-slate-800/50 ${lead.status === 'dead_bucket' ? 'bg-gray-50 dark:bg-slate-950/50 opacity-60' : ''}`}>
                        <TableCell className="pl-4">
                        <input
                            type="checkbox"
                            checked={selectedLeads.includes(lead.id)}
                            onChange={() => toggleLeadSelection(lead.id)}
                            className="rounded border-gray-300"
                        />
                        </TableCell>
                        {visibleColumns.name && (
                        <TableCell>
                             <div className="font-medium flex items-center gap-2">
                                <InlineEditableCell 
                                    value={lead.name} 
                                    onSave={(val) => handleInlineUpdate(lead.id, 'name', val)} 
                                />
                                {lead.score && lead.score >= 50 && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger>
                                                <Flame className="h-4 w-4 text-orange-500 animate-pulse" />
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>Hot Prospect (Score: {lead.score})</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                                {lead.status === 'dead_bucket' && (
                                    <Badge variant="outline" className="text-[10px] bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-800 px-1 py-0 h-5">
                                        <Skull className="h-3 w-3 mr-1" /> Dead
                                    </Badge>
                                )}
                             </div>
                            <div className="text-xs text-muted-foreground">ID: {lead.id.slice(-8)}</div>
                        </TableCell>
                        )}
                        {visibleColumns.contact && (
                        <TableCell>
                            <div className="space-y-1">
                            <div className="flex items-center gap-1">
                                <Phone className="h-3 w-3 text-muted-foreground" />
                                <InlineEditableCell 
                                    value={lead.phone} 
                                    type="tel"
                                    onSave={(val) => handleInlineUpdate(lead.id, 'phone', val)} 
                                    className="text-sm"
                                />
                            </div>
                            <div className="flex items-center gap-1">
                                <Mail className="h-3 w-3 text-muted-foreground" />
                                <InlineEditableCell 
                                    value={lead.email} 
                                    type="email"
                                    onSave={(val) => handleInlineUpdate(lead.id, 'email', val)} 
                                    className="text-sm"
                                />
                            </div>
                            </div>
                        </TableCell>
                        )}
                        {visibleColumns.company && (
                        <TableCell>
                            <div className="flex items-center gap-2">
                            <Building className="h-4 w-4 text-muted-foreground" />
                            <InlineEditableCell 
                                value={lead.company} 
                                onSave={(val) => handleInlineUpdate(lead.id, 'company', val)} 
                            />
                            </div>
                        </TableCell>
                        )}
                        {visibleColumns.status && (
                        <TableCell>
                            <Select value={lead.status} onValueChange={(value) => handleStatusChange(lead.id, value)}>
                            <SelectTrigger className={cn("w-32 h-7 text-[11px] font-semibold rounded-full border shadow-none focus:ring-0 cursor-pointer", getStatusPillClasses(lead.status))}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                                {availableStatuses.map(status => (
                                    <SelectItem key={status.value} value={status.value} className="rounded-lg text-xs">{status.label}</SelectItem>
                                ))}
                            </SelectContent>
                            </Select>
                        </TableCell>
                        )}
                        {visibleColumns.priority && (
                        <TableCell>
                            <Badge variant={getPriorityVariant(lead.priority) as any} className="text-[10px] py-0.5 px-2 rounded-full font-semibold">{lead.priority}</Badge>
                        </TableCell>
                        )}
                        {visibleColumns.score && (
                        <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex flex-col gap-0.5 w-16">
                                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-0.5">
                                  <Sparkles className="h-3 w-3 text-indigo-500 animate-pulse" />
                                  {lead.lead_score || 0}
                                </span>
                                <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 rounded-full" 
                                    style={{ width: `${lead.lead_score || 0}%` }}
                                  />
                                </div>
                              </div>
                              {lead.lead_score && (
                                  <Badge variant="outline" className={cn("text-[10px] py-0 px-1.5 h-5 rounded-full font-bold shadow-none", getScoreBadge(lead.lead_score).color)}>
                                    {getScoreBadge(lead.lead_score).label}
                                  </Badge>
                              )}
                            </div>
                        </TableCell>
                        )}
                        {visibleColumns.created && (
                        <TableCell>
                            <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                            <Calendar className="h-3 w-3 text-slate-400" />
                            <span className="text-xs">{new Date(lead.created_at).toLocaleDateString()}</span>
                            </div>
                        </TableCell>
                        )}
                        
                        {visibleColumns.lastContacted && (
                        <TableCell>
                            {(() => {
                            const lastContactTimestamp = lead.last_contacted;
                            const stale = isStale(lastContactTimestamp, lead.status);

                            return (
                                <div className="flex flex-col items-start gap-1">
                                    {lastContactTimestamp ? (
                                        <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                                            <Clock className="h-3 w-3 text-slate-400" />
                                            <span className="text-xs">
                                            {new Date(lastContactTimestamp).toLocaleString(undefined, {
                                                year: 'numeric', month: 'numeric', day: 'numeric',
                                                hour: '2-digit', minute: '2-digit', hour12: true
                                            })}
                                            </span>
                                        </div>
                                    ) : (
                                        <span className="text-xs text-slate-400">Never</span>
                                    )}

                                    {stale && (
                                        <Badge variant="outline" className="bg-rose-50 text-rose-600 border-rose-250 text-[10px] h-5 px-1 animate-pulse">
                                            Stale
                                        </Badge>
                                    )}
                                </div>
                            );
                            })()}
                        </TableCell>
                        )}

                        {visibleColumns.loanAmount && (
                        <TableCell>
                            <InlineEditableCell 
                                value={lead.loan_amount} 
                                type="number"
                                onSave={(val) => handleInlineUpdate(lead.id, 'loan_amount', val)} 
                                className="font-semibold text-xs text-slate-900 dark:text-slate-100"
                                suffix={<span className="text-[10px] text-slate-400 ml-0.5 font-normal">INR</span>}
                            />
                        </TableCell>
                        )}

                        {visibleColumns.notes && (
                            <TableCell>
                                <InlineEditableCell 
                                    value={lead.notes || ''} 
                                    onSave={(val) => handleInlineUpdate(lead.id, 'notes', val)}
                                    className="text-xs max-w-[150px] truncate"
                                    suffix={!lead.notes && <span className="text-[10px] text-slate-400 opacity-50">Add Note</span>}
                                />
                            </TableCell>
                        )}

                        {visibleColumns.loanType && (
                        <TableCell>
                            <Badge variant="outline" className="text-xs font-medium rounded-md">{getSafeValue(lead.loan_type, 'N/A')}</Badge>
                        </TableCell>
                        )}
                        {visibleColumns.source && (
                        <TableCell>
                            <Badge variant="outline" className="text-xs font-medium rounded-md">{getSafeValue(lead.source, 'N/A')}</Badge>
                        </TableCell>
                        )}
                        {visibleColumns.assignedTo && (
                        <TableCell>
                            <Select value={lead.assigned_to || "unassigned"} onValueChange={(value) => handleAssignLead(lead.id, value)}>
                            <SelectTrigger className="w-36 h-7 text-[11px] font-semibold bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-850 hover:bg-slate-100 dark:hover:bg-slate-900 text-xs rounded-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                                <SelectItem value="unassigned" className="rounded-lg text-xs">Unassigned</SelectItem>
                                {telecallers.map((tc) => (
                                <SelectItem key={tc.id} value={tc.id} className="rounded-lg text-xs">{tc.full_name}</SelectItem>
                                ))}
                            </SelectContent>
                            </Select>
                        </TableCell>
                        )}
                        {visibleColumns.tags && (
                        <TableCell>
                            <div className="flex flex-wrap gap-1">
                            {(Array.isArray(lead.tags) ? lead.tags : []).slice(0, 2).map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-[10px] py-0 px-1.5 rounded-full">{tag}</Badge>
                            ))}
                            {(Array.isArray(lead.tags) ? lead.tags : []).length > 2 && (
                                <Badge variant="outline" className="text-[10px] py-0 px-1.5 rounded-full">
                                +{(lead.tags?.length || 0) - 2}
                                </Badge>
                            )}
                            </div>
                        </TableCell>
                        )}
                        {visibleColumns.actions && (
                        <TableCell>
                          <div className="flex items-center gap-2 justify-end">
                            {/* Hover Actions Toolbar */}
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0 mr-1">
                              <TooltipProvider delayDuration={100}>
                                {/* Call */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-7 w-7 rounded-full text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                                      onClick={() => window.open(`tel:${lead.phone}`, '_self')}
                                    >
                                      <Phone className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-[10px] py-0.5 px-2 bg-slate-900 text-white font-semibold">Call Lead</TooltipContent>
                                </Tooltip>

                                {/* WhatsApp */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-7 w-7 rounded-full text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                                      onClick={() => window.open(`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`, '_blank')}
                                    >
                                      <MessageSquare className="h-3.5 w-3.5 text-emerald-500" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-[10px] py-0.5 px-2 bg-slate-900 text-white font-semibold">WhatsApp</TooltipContent>
                                </Tooltip>

                                {/* Assign / Edit */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link href={`/admin/leads/${lead.id}`}>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-7 w-7 rounded-full text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                                      >
                                        <User className="h-3.5 w-3.5" />
                                      </Button>
                                    </Link>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-[10px] py-0.5 px-2 bg-slate-900 text-white font-semibold">Assign & Edit</TooltipContent>
                                </Tooltip>

                                {/* AI Summary */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-7 w-7 rounded-full text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                                      onClick={() => handleAICall(lead)}
                                    >
                                      <Sparkles className="h-3.5 w-3.5 text-indigo-500 animate-pulse" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-[10px] py-0.5 px-2 bg-slate-900 text-white font-semibold">AI Summary & Call</TooltipContent>
                                </Tooltip>

                                {/* Activity History */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link href={`/admin/leads/${lead.id}?tab=history`}>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-7 w-7 rounded-full text-slate-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                                      >
                                        <Activity className="h-3.5 w-3.5" />
                                      </Button>
                                    </Link>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-[10px] py-0.5 px-2 bg-slate-900 text-white font-semibold">Activity History</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>

                            {/* Actions Dropdown */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full border border-slate-200 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800 transition-colors">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="rounded-xl">
                                <DropdownMenuItem onClick={() => handleAICall(lead)} className="text-indigo-650 font-medium cursor-pointer rounded-lg">
                                    <Sparkles className="h-4 w-4 mr-2" />
                                    AI Call
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild className="rounded-lg">
                                    <Link href={`/admin/leads/${lead.id}`}>
                                    <Eye className="h-4 w-4 mr-2" />
                                    View Details
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSelectedLeadForTags(lead)} className="rounded-lg">
                                    <Tag className="h-4 w-4 mr-2" />
                                    Manage Tags
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setShowEmailDialog(true)} className="rounded-lg">
                                    <Mail className="h-4 w-4 mr-2" />
                                    Send Email
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setShowSMSDialog(true)} className="rounded-lg">
                                    <MessageSquare className="h-4 w-4 mr-2" />
                                    Send SMS
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setShowWhatsAppDialog(true)} className="rounded-lg">
                                    <MessageSquare className="h-4 w-4 mr-2 text-green-500" />
                                    Send WhatsApp
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-red-600 rounded-lg" onClick={() => { setSelectedLeads([lead.id]); handleBulkDelete(); }}>
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete Lead
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                        )}
                    </TableRow>
                    ))
                )}
                </TableBody>
            </Table>
            
            {/* Server-Side Pagination Controller */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 mt-4 rounded-b-lg">
                <div className="text-sm text-muted-foreground">
                    Showing {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, totalLeads)} of {totalLeads} results.
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-sm">
                        <Label htmlFor="page-size" className="whitespace-nowrap">Leads per page:</Label>
                        <Input
                            id="page-size"
                            type="number"
                            min="1"
                            value={pageSize === 0 ? "" : pageSize}
                            onChange={handlePageSizeChange}
                            className="w-20 h-8 text-center"
                        />
                    </div>
                    <Pagination>
                        <PaginationContent>
                            <PaginationItem>
                                <PaginationPrevious 
                                    href="#" 
                                    onClick={(e) => { e.preventDefault(); handlePageChange(Math.max(1, currentPage - 1))}} 
                                    className={currentPage <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                />
                            </PaginationItem>
                            
                            {Array.from({ length: totalPages }, (_, i) => i + 1).slice(
                                Math.max(0, currentPage - 3),
                                Math.min(totalPages, currentPage + 2)
                            ).map(page => (
                                <PaginationItem key={page}>
                                    <PaginationLink 
                                        href="#" 
                                        isActive={page === currentPage}
                                        onClick={(e) => { e.preventDefault(); handlePageChange(page)}}
                                    >
                                        {page}
                                    </PaginationLink>
                                </PaginationItem>
                            ))}
                            
                            {totalPages > 5 && currentPage < totalPages - 2 && (
                                <PaginationItem>
                                    <span className="px-2 text-muted-foreground">...</span>
                                </PaginationItem>
                            )}
                            <PaginationItem>
                                <PaginationNext 
                                    href="#" 
                                    onClick={(e) => { e.preventDefault(); handlePageChange(Math.min(totalPages, currentPage + 1))}} 
                                    className={currentPage >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                />
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                </div>
            </div>
        </div>
      ) : (
        /* KANBAN BOARD VIEW */
        <div className="h-[calc(100vh-220px)] overflow-x-auto pb-4">
          <div className="flex gap-4 h-full min-w-[1200px]">
            {kanbanColumns.map(col => {
              const colLeads = enrichedLeads.filter(l => l.status === col.id);
              const totalAmount = colLeads.reduce((sum, l) => sum + (l.loan_amount || 0), 0);
              
              return (
                <div 
                  key={col.id} 
                  className="w-80 flex-shrink-0 flex flex-col bg-slate-50 dark:bg-slate-900 rounded-lg border h-full"
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, col.id)}
                >
                  <div className={`p-3 border-b border-l-4 ${col.color.replace('bg-', 'border-')} flex justify-between items-start`}>
                    <div>
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        {col.title}
                        <Badge variant="secondary" className="text-[10px] h-5">{colLeads.length}</Badge>
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        {totalAmount > 0 ? formatCurrency(totalAmount) : '-'}
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {colLeads.map(lead => (
                      <Card 
                        key={lead.id} 
                        draggable 
                        onDragStart={(e) => handleDragStart(e, lead.id)}
                        className="cursor-move hover:shadow-md transition-shadow"
                      >
                        <CardContent className="p-3 space-y-2">
                          <div className="flex justify-between items-start">
                            <Link href={`/admin/leads/${lead.id}`} className="font-medium text-sm hover:underline hover:text-blue-600 truncate flex items-center gap-1">
                              {lead.name}
                            </Link>
                            {lead.priority === 'high' && <div className="h-2 w-2 rounded-full bg-red-500" title="High Priority" />}
                          </div>
                          
                          <div className="flex justify-between items-center text-xs text-muted-foreground">
                             <span className="truncate max-w-[120px]">{lead.company || 'Individual'}</span>
                             {lead.lead_score && (
                                <span className={getScoreBadge(lead.lead_score).color.replace('bg-', 'text-').replace('text-white', '')}>
                                  {lead.lead_score} score
                                </span>
                             )}
                          </div>

                          <div className="flex items-center gap-2 pt-2 border-t mt-1">
                             <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleCallInitiated(lead)}>
                                <Phone className="h-3 w-3" />
                             </Button>
                             {/* 🔴 Added AI Call Button Here */}
                             <Button size="icon" variant="ghost" className="h-6 w-6 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50" onClick={() => handleAICall(lead)} title="Initiate AI Call">
                                <Sparkles className="h-3 w-3" />
                             </Button>
                             <div className="text-xs ml-auto">
                               {lead.assigned_user?.full_name?.split(' ')[0] || <span className="text-gray-400 italic">Unassigned</span>}
                             </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {colLeads.length === 0 && (
                      <div className="h-24 border-2 border-dashed rounded-md flex items-center justify-center text-xs text-muted-foreground opacity-50">
                        Drop here
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Dialogs */}
      <LeadStatusDialog
        open={isStatusDialogOpen}
        onOpenChange={(open) => {
          setIsStatusDialogOpen(open)
          if (!open) {
            setIsCallInitiated(false)
            setSelectedLead(null)
          }
        }}
        leadId={selectedLead?.id || ""}
        currentStatus={selectedLead?.status || ""}
        leadPhoneNumber={selectedLead?.phone || ""}
        onStatusUpdate={handleStatusUpdate}
        onCallLogged={handleCallLogged}
        isCallInitiated={isCallInitiated}
      />

      <Dialog open={showSaveFilterDialog} onOpenChange={setShowSaveFilterDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Filter</DialogTitle>
            <DialogDescription>Save your current filter settings for quick access later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="filter-name">Filter Name</Label>
              <Input id="filter-name" value={filterName} onChange={(e) => setFilterName(e.target.value)} placeholder="Enter filter name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveFilterDialog(false)}>Cancel</Button>
            <Button onClick={saveCurrentFilter} disabled={!filterName.trim()}>Save Filter</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send Bulk Email</DialogTitle>
            <DialogDescription>Send email to {selectedLeads.length} selected lead{selectedLeads.length !== 1 ? 's' : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email-subject">Subject</Label>
              <Input id="email-subject" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Email subject" />
            </div>
            <div>
              <Label htmlFor="email-body">Message</Label>
              <Textarea id="email-body" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder="Enter your email message..." rows={8} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmailDialog(false)}>Cancel</Button>
            <Button onClick={handleBulkEmail} disabled={!emailSubject || !emailBody}>Send Email</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSMSDialog} onOpenChange={setShowSMSDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Bulk SMS</DialogTitle>
            <DialogDescription>Send SMS to {selectedLeads.length} selected lead{selectedLeads.length !== 1 ? 's' : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="sms-body">Message</Label>
              <Textarea id="sms-body" value={smsBody} onChange={(e) => setSmsBody(e.target.value)} placeholder="Enter your SMS message..." rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSMSDialog(false)}>Cancel</Button>
            <Button onClick={handleBulkSMS} disabled={!smsBody}>Send SMS</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showWhatsAppDialog} onOpenChange={setShowWhatsAppDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Bulk WhatsApp</DialogTitle>
            <DialogDescription>Send WhatsApp broadcast to {selectedLeads.length} selected lead{selectedLeads.length !== 1 ? 's' : ''}. Use {"{{name}}"} and {"{{company}}"} for personalization.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="whatsapp-body">Message</Label>
              <Textarea id="whatsapp-body" value={whatsappBody} onChange={(e) => setWhatsappBody(e.target.value)} placeholder="Enter your WhatsApp template..." rows={6} />
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-md text-xs text-slate-500">
              <p className="font-semibold mb-1">Available variables:</p>
              <div className="flex gap-2 flex-wrap">
                <code className="bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded">{"{{name}}"}</code>
                <code className="bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded">{"{{phone}}"}</code>
                <code className="bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded">{"{{email}}"}</code>
                <code className="bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded">{"{{company}}"}</code>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWhatsAppDialog(false)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={handleBulkWhatsApp} disabled={!whatsappBody}>Send WhatsApp</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV Import Dialog */}
      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Leads via CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV file. First row must contain headers: Name, Phone, Email, Amount, etc.
            </DialogDescription>
          </DialogHeader>
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="csv_upload">Select File</Label>
            <Input id="csv_upload" type="file" accept=".csv" onChange={handleFileUpload} disabled={importing} />
          </div>
          {importing && <p className="text-sm text-muted-foreground">Processing...</p>}
          <DialogFooter>
             <Button variant="outline" onClick={() => setIsImportOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAutoAssignDialog} onOpenChange={setShowAutoAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Auto-Assign Rules</DialogTitle>
            <DialogDescription>Configure automatic lead assignment rules.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-assign-enabled">Enable Auto-Assignment</Label>
              <Switch id="auto-assign-enabled" checked={autoAssignRules.enabled} onCheckedChange={(checked) => setAutoAssignRules(prev => ({ ...prev, enabled: checked }))} />
            </div>
            {autoAssignRules.enabled && (
              <>
                <div className="space-y-3 border p-3 rounded-md bg-muted/50">
                  <h4 className="font-medium text-sm">Assignment Strategy (New/Unassigned Leads)</h4>
                  <div>
                    <Label htmlFor="assignment-method">Assignment Method</Label>
                    <Select value={autoAssignRules.method} onValueChange={(value) => setAutoAssignRules(prev => ({ ...prev, method: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="round-robin">Shuffled Round Robin (Fair)</SelectItem>
                        <SelectItem value="workload">Workload Balance</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-3 border p-3 rounded-md bg-muted/50">
                   <h4 className="font-medium text-sm">Re-Assignment Rules (Stale Leads)</h4>
                   <p className="text-xs text-muted-foreground">These rules automatically re-assign and reset lead status to 'New' if contact is missed.</p>
                   <div className="flex items-center justify-between">
                    <Label htmlFor="reassign-nr" className="flex flex-col gap-1">
                      <span>Reassign "Not Reached" {'>'} 48hrs</span>
                      <span className="text-xs text-muted-foreground font-normal">If lead status is 'nr' and last call was {'>'} 48 hours ago.</span>
                    </Label>
                    <Switch id="reassign-nr" checked={autoAssignRules.reassignNR} onCheckedChange={(checked) => setAutoAssignRules(prev => ({ ...prev, reassignNR: checked }))} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="reassign-interested" className="flex flex-col gap-1">
                      <span>Reassign "Interested" {'>'} 72hrs</span>
                       <span className="text-xs text-muted-foreground font-normal">If lead status is 'Interested' and last call was {'>'} 72 hours ago.</span>
                    </Label>
                    <Switch id="reassign-interested" checked={autoAssignRules.reassignInterested} onCheckedChange={(checked) => setAutoAssignRules(prev => ({ ...prev, reassignInterested: checked }))} />
                  </div>
                </div>
                
                <Button onClick={handleAutoAssignLeads} className="w-full mt-4">
                  <Users className="h-4 w-4 mr-2" /> Run Auto-Assign / Re-Assign Now
                </Button>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAutoAssignDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDuplicatesDialog} onOpenChange={setShowDuplicatesDialog}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Duplicate Leads Detected</DialogTitle>
            <DialogDescription>Found {duplicates.length} potential duplicate groups</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {duplicates.map((dup, index) => (
              <Card key={index}>
                <CardHeader>
                  <CardTitle className="text-sm">Duplicate {dup.type}: {dup.value}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {dup.leads.map((lead: Lead) => (
                      <div key={lead.id} className="flex items-center justify-between p-2 border rounded">
                        <div>
                          <div className="font-medium">{lead.name}</div>
                          <div className="text-sm text-muted-foreground">{lead.phone} • {lead.email} • Created: {new Date(lead.created_at).toLocaleDateString()}</div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/admin/leads/${lead.id}`}><Eye className="h-4 w-4 mr-1" /> View</Link>
                          </Button>
                          <Button size="sm" variant="destructive"><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <DialogFooter className="sm:justify-between">
            <div className="text-xs text-muted-foreground self-center">
                Review carefully before processing.
            </div>
            <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowDuplicatesDialog(false)}>Close</Button>
                <Button variant="destructive" onClick={handleBulkResolveDuplicates}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Mark Duplicates (Keep Newest)
                </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedLeadForTags} onOpenChange={(open) => !open && setSelectedLeadForTags(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Tags</DialogTitle>
            <DialogDescription>Add or remove tags for {selectedLeadForTags?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Current Tags</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {(selectedLeadForTags?.tags || []).map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button onClick={() => handleRemoveTag(selectedLeadForTags!.id, tag)} className="ml-1 hover:text-red-600"><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <Label>Add New Tag</Label>
              <div className="flex gap-2 mt-2">
                <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Enter new tag" />
                <Button onClick={() => { if (newTag.trim() && selectedLeadForTags) { handleAddTag(selectedLeadForTags.id, newTag.trim()); setNewTag("") } }} disabled={!newTag.trim()}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>
            <div>
              <Label>Quick Tags</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {availableTags.map((tag) => (
                  <Button key={tag} size="sm" variant="outline" onClick={() => { if (selectedLeadForTags && !selectedLeadForTags.tags?.includes(tag)) { handleAddTag(selectedLeadForTags.id, tag) } }} disabled={selectedLeadForTags?.tags?.includes(tag)}>
                    <Tag className="h-3 w-3 mr-1" /> {tag}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedLeadForTags(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PowerDialer 
        isOpen={isPowerDialerOpen} 
        onClose={() => setIsPowerDialerOpen(false)} 
        leads={selectedLeads.map(id => leads.find(l => l.id === id)).filter(Boolean)} 
      />
    </div>
  )
}
