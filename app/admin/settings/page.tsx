"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"
import { toast } from "sonner"
import { 
  Building2, PhoneCall, MessageSquare, 
  Save, KeyRound, Loader2, ShieldCheck, Clock, Phone,
  Sparkles, RefreshCw, Hash, CheckCircle2, ListFilter
} from "lucide-react"

// Import our Server Actions
import { updateWorkspaceSettings, getWorkspaceSettings } from "@/app/actions/tenant-settings"
import { getApprovedWhatsAppTemplates, getWhatsAppCampaignsList, getWhatsAppAccountsList } from "@/app/actions/whatsapp"

export default function WorkspaceSettingsPage() {
  const supabase = createClient()
  
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  
  // WhatsApp Templates, Campaigns & Accounts state (fetched from WhatsApp / Fonada)
  const [approvedTemplates, setApprovedTemplates] = useState<any[]>([])
  const [whatsappCampaigns, setWhatsappCampaigns] = useState<any[]>([])
  const [whatsappAccounts, setWhatsappAccounts] = useState<any[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [customTemplateInput, setCustomTemplateInput] = useState(false)
  const [customCampaignInput, setCustomCampaignInput] = useState(false)
  const [customNumberInput, setCustomNumberInput] = useState(false)
  
  // Form State
  const [formData, setFormData] = useState({
    fonada_client_id: "",
    fonada_secret: "",
    fonada_waba_number: "",
    whatsapp_api_key: "",
    whatsapp_ai_agent_enabled: false,
    unicorn_api_key: "",
    // Cron Job States
    cron_auto_checkout: true,
    cron_auto_refill: true,
    cron_daily_report: true,
    cron_kyc: true,
    cron_sla: true,
    cron_smart_notifications: true,
    ivr_digit_auto_assign: true,
    // IVR DTMF WhatsApp Campaign State
    ivr_dtmf_template: "application_status_update",
    ivr_dtmf_campaign: "StatusUpdateAlert",
    ivr_dtmf_digit: "any",
  })

  // Fetch live templates from WhatsApp (Fonada AI)
  const fetchLiveTemplates = async () => {
    setLoadingTemplates(true)
    try {
      const res = await getApprovedWhatsAppTemplates()
      if (res.success && Array.isArray(res.templates)) {
        setApprovedTemplates(res.templates)
        toast.success(`Loaded ${res.templates.length} templates from WhatsApp`)
      } else {
        toast.info("Using default approved template library")
      }
    } catch (e: any) {
      console.warn("Could not fetch Fonada templates:", e.message)
    } finally {
      setLoadingTemplates(false)
    }
  }

  // Fetch live campaigns from WhatsApp (Fonada AI)
  const fetchLiveCampaigns = async () => {
    setLoadingCampaigns(true)
    try {
      const res = await getWhatsAppCampaignsList()
      if (res.success && Array.isArray(res.campaigns)) {
        setWhatsappCampaigns(res.campaigns)
        toast.success(`Fetched ${res.campaigns.length} campaigns directly from WhatsApp!`)
      } else {
        toast.info("No active campaigns returned from WhatsApp")
      }
    } catch (e: any) {
      console.warn("Could not fetch WhatsApp campaigns:", e.message)
    } finally {
      setLoadingCampaigns(false)
    }
  }

  // Fetch live connected accounts / numbers from WhatsApp (Fonada AI)
  const fetchLiveAccounts = async () => {
    setLoadingAccounts(true)
    try {
      const res = await getWhatsAppAccountsList()
      if (res.success && Array.isArray(res.accounts)) {
        setWhatsappAccounts(res.accounts)
      }
    } catch (e: any) {
      console.warn("Could not fetch WhatsApp accounts:", e.message)
    } finally {
      setLoadingAccounts(false)
    }
  }

  // Fetch existing settings on load
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const result = await getWorkspaceSettings()

        if (!result.success) {
          throw new Error(result.error || "Failed to load settings")
        }

        const data = result.data

        if (data) {
          setFormData({
            fonada_client_id: data.fonada_client_id || "",
            fonada_secret: data.fonada_secret || "",
            fonada_waba_number: data.fonada_waba_number || "",
            whatsapp_api_key: data.whatsapp_api_key || "",
            whatsapp_ai_agent_enabled: data.whatsapp_ai_agent_enabled ?? false,
            unicorn_api_key: data.unicorn_api_key || "",
            cron_auto_checkout: data.cron_auto_checkout ?? true,
            cron_auto_refill: data.cron_auto_refill ?? true,
            cron_daily_report: data.cron_daily_report ?? true,
            cron_kyc: data.cron_kyc ?? true,
            cron_sla: data.cron_sla ?? true,
            cron_smart_notifications: data.cron_smart_notifications ?? true,
            ivr_digit_auto_assign: data.ivr_digit_auto_assign ?? true,
            ivr_dtmf_template: data.ivr_dtmf_template || "application_status_update",
            ivr_dtmf_campaign: data.ivr_dtmf_campaign || "StatusUpdateAlert",
            ivr_dtmf_digit: data.ivr_dtmf_digit || "any",
          })
        }

        // Fetch live accounts, templates & live campaigns from WhatsApp
        fetchLiveAccounts()
        fetchLiveTemplates()
        fetchLiveCampaigns()

      } catch (err: any) {
        console.error("Error fetching settings:", err)
        toast.error("Failed to load workspace settings")
      } finally {
        setIsLoading(false)
      }
    }

    fetchSettings()
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    
    // Send the updated data to your server action
    const response = await updateWorkspaceSettings(formData)
    
    if (response.success) {
      toast.success("Settings saved successfully!")
    } else {
      toast.error(response.error || "Failed to save settings")
    }
    
    setIsSaving(false)
  }

  const handleCronToggle = (field: keyof typeof formData) => {
    setFormData(prev => ({ ...prev, [field]: !prev[field] as any }))
  }

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6 md:space-y-8 pb-20">
      
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
          <Building2 className="h-8 w-8 text-indigo-600" />
          Workspace Configuration
        </h1>
        <p className="text-slate-500 mt-1">
          Manage your API keys, integrations, IVR digit WhatsApp automations, and CRM settings.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8">

        {/* UNICORN AI CARD */}
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="border-b bg-slate-50/50 pb-4">
            <CardTitle className="text-lg flex items-center gap-2 text-slate-800">
              <PhoneCall className="h-5 w-5 text-indigo-600" />
              Unicorn AI Calling Integration
            </CardTitle>
            <CardDescription>
              Connect your Unicorn AI Solution account to enable advanced AI voice calling.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-slate-700 font-semibold flex items-center gap-2">
                Unicorn API Key <KeyRound className="h-3 w-3 text-slate-400" />
              </Label>
              <Input 
                type="password"
                placeholder="Paste your Unicorn AI Client API Key..." 
                value={formData.unicorn_api_key}
                onChange={(e) => setFormData(prev => ({ ...prev, unicorn_api_key: e.target.value }))}
                className="font-mono text-sm bg-slate-50"
              />
            </div>
            <div className="bg-indigo-50 border border-indigo-100 rounded-md p-3 text-xs text-indigo-800">
              <strong>Webhook Setup:</strong> Please configure your call-outcome webhook in Unicorn AI portal to point to <code>https://crm.hanva.in/api/webhooks/unicorn-call-outcomes</code>
            </div>
          </CardContent>
        </Card>

        {/* WHATSAPP CARD */}
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="border-b bg-slate-50/50 pb-4">
            <CardTitle className="text-lg flex items-center gap-2 text-slate-800">
              <MessageSquare className="h-5 w-5 text-emerald-600" />
              WhatsApp Automation
            </CardTitle>
            <CardDescription>
              Configure your Meta/Cloud API keys to send automated KYC lists and Missed Call alerts.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-slate-700 font-semibold flex items-center gap-2">
                  WhatsApp Sender Number (WABA Number) <Phone className="h-3 w-3 text-slate-400" />
                </Label>
                {whatsappAccounts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCustomNumberInput(!customNumberInput)}
                    className="text-xs text-indigo-600 hover:underline font-semibold"
                  >
                    {customNumberInput ? "Choose connected account" : "Enter custom"}
                  </button>
                )}
              </div>

              {whatsappAccounts.length > 0 && !customNumberInput ? (
                <Select
                  value={formData.fonada_waba_number ? String(formData.fonada_waba_number).replace(/^\+/, '') : ""}
                  onValueChange={(val) => {
                    setFormData(prev => ({ ...prev, fonada_waba_number: val }));
                    setTimeout(() => {
                      fetchLiveTemplates();
                      fetchLiveCampaigns();
                    }, 100);
                  }}
                >
                  <SelectTrigger className="font-mono text-sm bg-slate-50 border-slate-200 focus:bg-white font-medium">
                    <SelectValue placeholder="Select connected WhatsApp account..." />
                  </SelectTrigger>
                  <SelectContent>
                    {whatsappAccounts.map((acc: any) => {
                      const cleanPhone = (acc.business_phone_number || '').replace(/^\+/, '');
                      return (
                        <SelectItem key={acc.id} value={cleanPhone}>
                          <div className="flex items-center justify-between gap-3 w-full">
                            <span className="font-mono font-bold text-slate-800">+{cleanPhone}</span>
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline" className="text-[10px] text-purple-700 bg-purple-50">
                                {acc.display_name || 'Bankscart'}
                              </Badge>
                              <Badge variant="outline" className="text-[9px] text-emerald-700 bg-emerald-50 uppercase font-bold">
                                {acc.account_status || 'CONNECTED'}
                              </Badge>
                            </div>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <Input 
                  type="text"
                  placeholder="e.g. 918217354172" 
                  value={formData.fonada_waba_number}
                  onChange={(e) => setFormData(prev => ({ ...prev, fonada_waba_number: e.target.value }))}
                  className="font-mono text-sm bg-slate-50"
                />
              )}
              <p className="text-xs text-slate-500">The registered phone number on Fonada/Meta with country code (e.g. 918217354172).</p>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-700 font-semibold flex items-center gap-2">
                WhatsApp API Bearer Token <KeyRound className="h-3 w-3 text-slate-400" />
              </Label>
              <Input 
                type="password"
                placeholder="fsk_..." 
                value={formData.whatsapp_api_key}
                onChange={(e) => setFormData(prev => ({ ...prev, whatsapp_api_key: e.target.value }))}
                className="font-mono text-sm bg-slate-50"
              />
            </div>

            <div className="p-3.5 bg-slate-100 dark:bg-slate-800 rounded-xl space-y-2.5 border border-slate-200 dark:border-slate-700 text-xs">
              <p className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-600" /> Webhook Integration Settings
              </p>
              <div className="space-y-1">
                <span className="text-slate-500 font-medium">Callback URL:</span>
                <code className="block p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-emerald-600 dark:text-emerald-400 select-all">
                  https://crm.hanva.in/api/webhooks/whatsapp
                </code>
              </div>
              <div className="space-y-1">
                <span className="text-slate-500 font-medium">Verify Token:</span>
                <code className="block p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-slate-700 dark:text-slate-300 select-all">
                  my_secret_token
                </code>
              </div>
              <p className="text-[10px] text-slate-400">
                Configure in Meta Dashboard or Fonada AI portal. Supports GET handshake verification & inbound message/DLR events.
              </p>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <div className="space-y-0.5">
                <Label className="text-base font-semibold text-slate-800">WhatsApp AI Chat Agent</Label>
                <p className="text-sm text-slate-500">Automatically chats with customers to collect KYC documents (Aadhar Card, PAN Card, Payslips) using AI.</p>
              </div>
              <Switch 
                checked={formData.whatsapp_ai_agent_enabled} 
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, whatsapp_ai_agent_enabled: checked }))} 
              />
            </div>
          </CardContent>
        </Card>

        {/* 🚀 IVR DIGIT-PRESS WHATSAPP CAMPAIGN AUTOMATION CARD */}
        <Card className="shadow-sm border-slate-200 overflow-hidden">
          <div className="h-1.5 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500" />
          <CardHeader className="border-b bg-slate-50/50 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2 text-slate-800">
                  <PhoneCall className="h-5 w-5 text-emerald-600" />
                  IVR Digit-Press WhatsApp Dispatch
                </CardTitle>
                <CardDescription>
                  Select a live campaign and template fetched directly from WhatsApp to send on IVR digit presses.
                </CardDescription>
              </div>
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold px-2.5 py-1 text-xs">
                WhatsApp Live Sync
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            
            {/* Row 1: Campaign Selector (Fetched from WhatsApp) & Trigger Digit */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              
              {/* WhatsApp Campaign Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-700 font-semibold text-xs uppercase tracking-wider flex items-center gap-1.5">
                    <span>WhatsApp Campaign</span>
                    <Badge variant="secondary" className="text-[9px] bg-emerald-100 text-emerald-800 font-semibold px-1.5 py-0.2">
                      Fetched Live
                    </Badge>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={fetchLiveCampaigns}
                      disabled={loadingCampaigns}
                      className="h-6 px-1.5 text-[11px] text-indigo-700 hover:bg-indigo-50 font-semibold"
                    >
                      <RefreshCw className={`w-3 h-3 mr-1 ${loadingCampaigns ? 'animate-spin' : ''}`} />
                      Fetch from WhatsApp
                    </Button>
                    <button
                      type="button"
                      onClick={() => setCustomCampaignInput(!customCampaignInput)}
                      className="text-[11px] text-slate-500 hover:text-slate-800 hover:underline font-medium"
                    >
                      {customCampaignInput ? "Select list" : "Custom"}
                    </button>
                  </div>
                </div>

                {customCampaignInput ? (
                  <Input
                    type="text"
                    placeholder="e.g. StatusUpdateAlert or Loan_IVR_Response"
                    value={formData.ivr_dtmf_campaign}
                    onChange={(e) => setFormData(prev => ({ ...prev, ivr_dtmf_campaign: e.target.value }))}
                    className="font-mono text-sm bg-slate-50 border-slate-200 focus:bg-white"
                  />
                ) : (
                  <Select
                    value={formData.ivr_dtmf_campaign}
                    onValueChange={(val) => {
                      const matched = whatsappCampaigns.find(c => c.campaign_name === val);
                      setFormData(prev => ({
                        ...prev,
                        ivr_dtmf_campaign: val,
                        ivr_dtmf_template: matched?.template_name || prev.ivr_dtmf_template
                      }));
                    }}
                  >
                    <SelectTrigger className="bg-slate-50 border-slate-200 focus:bg-white text-sm font-semibold">
                      <SelectValue placeholder="Select campaign from WhatsApp..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="StatusUpdateAlert">
                        <div className="flex items-center justify-between gap-3 w-full">
                          <span className="font-mono font-bold text-slate-800">StatusUpdateAlert</span>
                          <Badge className="bg-slate-100 text-slate-700 text-[10px] border-0">Default</Badge>
                        </div>
                      </SelectItem>
                      {whatsappCampaigns.map((c: any) => (
                        <SelectItem key={c.id || c.campaign_name} value={c.campaign_name}>
                          <div className="flex items-center justify-between gap-3 w-full">
                            <span className="font-mono font-medium text-slate-800">{c.campaign_name}</span>
                            <div className="flex items-center gap-1.5">
                              {c.template_name && (
                                <Badge variant="outline" className="text-[9px] text-purple-700 bg-purple-50 font-mono">
                                  {c.template_name}
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-[9px] text-emerald-700 bg-emerald-50 font-bold uppercase">
                                {c.status || 'ACTIVE'}
                              </Badge>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-slate-500">Live campaign from your connected WhatsApp portal.</p>
              </div>

              {/* Trigger Digit */}
              <div className="space-y-2">
                <Label className="text-slate-700 font-semibold flex items-center justify-between text-xs uppercase tracking-wider">
                  <span>Trigger Digit (DTMF Key)</span>
                  <Hash className="h-3 w-3 text-slate-400" />
                </Label>
                <Select
                  value={formData.ivr_dtmf_digit}
                  onValueChange={(val) => setFormData(prev => ({ ...prev, ivr_dtmf_digit: val }))}
                >
                  <SelectTrigger className="bg-slate-50 border-slate-200 focus:bg-white text-sm font-medium">
                    <SelectValue placeholder="Choose trigger key..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">✨ Any Digit Pressed (1 - 9)</SelectItem>
                    <SelectItem value="1">Key 1 Only (e.g. "Press 1 for Interested")</SelectItem>
                    <SelectItem value="2">Key 2 Only</SelectItem>
                    <SelectItem value="3">Key 3 Only</SelectItem>
                    <SelectItem value="4">Key 4 Only</SelectItem>
                    <SelectItem value="5">Key 5 Only</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">Only send the message when the caller presses this specific digit.</p>
              </div>

            </div>

            {/* Row 2: WhatsApp Template Selection */}
            <div className="space-y-2.5 p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl">
              <div className="flex items-center justify-between">
                <Label className="text-slate-800 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" /> WhatsApp Template Linked to Dispatch
                </Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={fetchLiveTemplates}
                    disabled={loadingTemplates}
                    className="h-7 px-2 text-xs text-emerald-700 hover:bg-emerald-100"
                  >
                    <RefreshCw className={`w-3 h-3 mr-1 ${loadingTemplates ? 'animate-spin' : ''}`} />
                    Refresh Templates
                  </Button>
                  <button
                    type="button"
                    onClick={() => setCustomTemplateInput(!customTemplateInput)}
                    className="text-xs text-indigo-600 hover:underline font-semibold"
                  >
                    {customTemplateInput ? "Choose from list" : "Enter custom name"}
                  </button>
                </div>
              </div>

              {customTemplateInput ? (
                <div className="space-y-1">
                  <Input
                    type="text"
                    placeholder="e.g. application_status_update or my_loan_template"
                    value={formData.ivr_dtmf_template}
                    onChange={(e) => setFormData(prev => ({ ...prev, ivr_dtmf_template: e.target.value }))}
                    className="bg-white font-mono text-sm"
                  />
                  <p className="text-[11px] text-slate-500">Ensure this template is pre-approved in your Meta / Fonada AI portal.</p>
                </div>
              ) : (
                <Select
                  value={formData.ivr_dtmf_template}
                  onValueChange={(val) => setFormData(prev => ({ ...prev, ivr_dtmf_template: val }))}
                >
                  <SelectTrigger className="bg-white border-slate-200 text-sm font-semibold">
                    <SelectValue placeholder="Select an approved template..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="application_status_update">
                      <div className="flex items-center justify-between gap-3 w-full">
                        <span className="font-mono font-bold text-slate-800">application_status_update</span>
                        <Badge className="bg-purple-100 text-purple-700 text-[10px] font-semibold border-0">Loan Portal</Badge>
                      </div>
                    </SelectItem>
                    {approvedTemplates.map((t: any) => (
                      <SelectItem key={t.id || t.template_name} value={t.template_name}>
                        <div className="flex items-center justify-between gap-3 w-full">
                          <span className="font-mono font-medium text-slate-700">{t.template_name}</span>
                          <Badge variant="outline" className="text-[9px] font-mono text-slate-500 uppercase">{t.category || 'UTILITY'}</Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Dynamic Preview Banner */}
              <div className="p-3 bg-white rounded-xl border border-slate-200 text-xs space-y-1 text-slate-600 shadow-sm">
                <p className="font-bold text-slate-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Active Automation Summary:
                </p>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  When a caller presses <strong className="text-indigo-600 font-mono font-bold">{formData.ivr_dtmf_digit === 'any' ? 'Any Digit (1-9)' : `Key ${formData.ivr_dtmf_digit}`}</strong>, the WhatsApp Campaign <strong className="text-purple-700 font-mono font-bold">{formData.ivr_dtmf_campaign || 'StatusUpdateAlert'}</strong> with template <strong className="text-emerald-700 font-mono font-bold">{formData.ivr_dtmf_template || 'application_status_update'}</strong> will be automatically dispatched from <strong className="text-slate-800 font-mono">{formData.fonada_waba_number || '917965373459'}</strong> (rate-limited to max 2/day per chat).
                </p>
              </div>

            </div>

          </CardContent>
        </Card>

        {/* 🔴 AUTOMATED CRON JOBS CARD */}
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="border-b bg-slate-50/50 pb-4">
            <CardTitle className="text-lg flex items-center gap-2 text-slate-800">
              <Clock className="h-5 w-5 text-orange-500" />
              Automated Background Tasks (Cron)
            </CardTitle>
            <CardDescription>
              Enable or disable automated system tasks. If paused, the external cron job will safely skip execution for your workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100">
              
              {/* SLA Cron */}
              <div className="flex items-center justify-between p-4 sm:p-6 hover:bg-slate-50 transition-colors">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold text-slate-800">SLA & Lead Recycling</Label>
                  <p className="text-sm text-slate-500">Automatically reassigns neglected (SLA breach) and stuck No-Response (NR) leads.</p>
                </div>
                <Switch checked={formData.cron_sla} onCheckedChange={() => handleCronToggle('cron_sla')} />
              </div>

              {/* Auto Refill */}
              <div className="flex items-center justify-between p-4 sm:p-6 hover:bg-slate-50 transition-colors">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold text-slate-800">Auto Lead Refill</Label>
                  <p className="text-sm text-slate-500">Automatically pulls unassigned leads from the general pool and gives them to active agents.</p>
                </div>
                <Switch checked={formData.cron_auto_refill} onCheckedChange={() => handleCronToggle('cron_auto_refill')} />
              </div>

              {/* KYC */}
              <div className="flex items-center justify-between p-4 sm:p-6 hover:bg-slate-50 transition-colors">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold text-slate-800">KYC Reminders</Label>
                  <p className="text-sm text-slate-500">Scans the system and sends automated WhatsApp reminders for pending customer documents.</p>
                </div>
                <Switch checked={formData.cron_kyc} onCheckedChange={() => handleCronToggle('cron_kyc')} />
              </div>

              {/* Smart Notifications */}
              <div className="flex items-center justify-between p-4 sm:p-6 hover:bg-slate-50 transition-colors">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold text-slate-800">Smart Notifications</Label>
                  <p className="text-sm text-slate-500">Triggers follow-up alerts and CRM dashboard notifications for your telecallers.</p>
                </div>
                <Switch checked={formData.cron_smart_notifications} onCheckedChange={() => handleCronToggle('cron_smart_notifications')} />
              </div>

              {/* Daily Report */}
              <div className="flex items-center justify-between p-4 sm:p-6 hover:bg-slate-50 transition-colors">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold text-slate-800">Daily Admin Report</Label>
                  <p className="text-sm text-slate-500">Compiles and emails the end-of-day organizational performance report.</p>
                </div>
                <Switch checked={formData.cron_daily_report} onCheckedChange={() => handleCronToggle('cron_daily_report')} />
              </div>

              {/* Auto Checkout */}
              <div className="flex items-center justify-between p-4 sm:p-6 hover:bg-slate-50 transition-colors">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold text-slate-800">Auto Force Checkout</Label>
                  <p className="text-sm text-slate-500">Automatically ends the shift of any agent who forgets to check out at midnight.</p>
                </div>
                <Switch checked={formData.cron_auto_checkout} onCheckedChange={() => handleCronToggle('cron_auto_checkout')} />
              </div>

              {/* IVR Digit Auto-Assign */}
              <div className="flex items-center justify-between p-4 sm:p-6 hover:bg-slate-50 transition-colors">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold text-slate-800">IVR Digit-Press Auto Assign</Label>
                  <p className="text-sm text-slate-500">When a customer presses any digit on the IVR call, instantly create a lead and assign it to the most available logged-in agent.</p>
                </div>
                <Switch checked={formData.ivr_digit_auto_assign} onCheckedChange={() => handleCronToggle('ivr_digit_auto_assign')} />
              </div>

            </div>
          </CardContent>
        </Card>

      </div>

      {/* SAVE ACTIONS - Sticky Footer */}
      <div className="sticky bottom-6 z-10 flex justify-end bg-white/80 backdrop-blur-md p-4 rounded-xl border border-slate-200 shadow-lg">
        <Button 
          onClick={handleSave} 
          disabled={isSaving} 
          className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md w-full sm:w-auto px-8"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Workspace Settings
        </Button>
      </div>

    </div>
  )
}
