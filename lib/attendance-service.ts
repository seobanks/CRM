import { createClient } from "./supabase/client"
import { differenceInMinutes } from "date-fns"

export interface AttendanceRecord {
  id: string
  user_id: string
  date: string
  check_in: string | null
  check_out: string | null
  lunch_start: string | null
  lunch_end: string | null
  total_hours: string | null
  break_hours: string | null
  status: string
  notes: string | null
  location_check_in?: any 
  location_check_out?: any 
  ip_check_in?: string | null 
  ip_check_out?: string | null 
  device_info_check_in?: string | null
  device_info_check_out?: string | null
  selfie_url_check_in?: string | null
  selfie_url_check_out?: string | null
}

export class AttendanceService {
  private static instance: AttendanceService

  private constructor() {}

  static getInstance(): AttendanceService {
    if (!AttendanceService.instance) {
      AttendanceService.instance = new AttendanceService()
    }
    return AttendanceService.instance
  }

  async checkIn(userId: string, notes?: string, location?: string): Promise<AttendanceRecord> {
    const supabase = createClient()
    const now = new Date().toISOString()
    
    // Optional: Try to get IP address
    let ipAddress = null;
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        ipAddress = data.ip;
    } catch (e) {
        console.warn("Could not fetch IP", e);
    }

    const { data: userProfile } = await supabase.from('users').select('tenant_id').eq('id', userId).maybeSingle();
    const tenantId = userProfile?.tenant_id;

    const upsertPayload: any = {
      user_id: userId,
      date: new Date().toISOString().split("T")[0],
      check_in: now,
      status: "present",
      notes: notes || null,
      updated_at: now,
      location_check_in: location ? { coordinates: location } : null,
      ip_check_in: ipAddress
    };
    if (tenantId) {
      upsertPayload.tenant_id = tenantId;
    }

    const { data, error } = await supabase
      .from("attendance")
      .upsert(
        upsertPayload,
        {
          onConflict: "user_id, date",
        },
      )
      .select()
      .single()

    if (error) throw error
    return data
  }

  async checkOut(userId: string, notes?: string): Promise<AttendanceRecord> {
    const supabase = await createClient()
    const now = new Date().toISOString()

    const { data: attendance } = await supabase
      .from("attendance")
      .select()
      .eq("user_id", userId)
      .eq("date", new Date().toISOString().split("T")[0])
      .maybeSingle() // Use maybeSingle to avoid 406 error if checking out without checkin (rare edge case)

    if (!attendance) {
      throw new Error("No check-in record found for today")
    }

    const checkInTime = new Date(attendance.check_in!)
    const checkOutTime = new Date(now)
    const totalMinutes = differenceInMinutes(checkOutTime, checkInTime)

    let breakMinutes = 0
    if (attendance.lunch_start && attendance.lunch_end) {
      breakMinutes = differenceInMinutes(new Date(attendance.lunch_end), new Date(attendance.lunch_start))
    }

    const workingMinutes = totalMinutes - breakMinutes
    const totalHours = `${Math.floor(workingMinutes / 60)}:${(workingMinutes % 60).toString().padStart(2, "0")}`

    const { data, error } = await supabase
      .from("attendance")
      .update({
        check_out: now,
        total_hours: totalHours,
        break_hours:
          breakMinutes > 0
            ? `${Math.floor(breakMinutes / 60)}:${(breakMinutes % 60).toString().padStart(2, "0")}`
            : null,
        notes: notes || attendance.notes,
        updated_at: now,
      })
      .eq("id", attendance.id)
      .select()
      .single()

    if (error) throw error
    return data
  }

  async startLunchBreak(userId: string): Promise<AttendanceRecord> {
    const supabase = await createClient()
    const now = new Date().toISOString()

    const { data: attendance } = await supabase
      .from("attendance")
      .select()
      .eq("user_id", userId)
      .eq("date", new Date().toISOString().split("T")[0])
      .maybeSingle()

    if (!attendance) {
      throw new Error("Please check in first")
    }

    if (attendance.lunch_start) {
      throw new Error("Lunch break already started")
    }

    const { data, error } = await supabase
      .from("attendance")
      .update({
        lunch_start: now,
        updated_at: now,
      })
      .eq("id", attendance.id)
      .select()
      .single()

    if (error) throw error
    return data
  }

  async endLunchBreak(userId: string): Promise<AttendanceRecord> {
    const supabase = await createClient()
    const now = new Date().toISOString()

    const { data: attendance } = await supabase
      .from("attendance")
      .select()
      .eq("user_id", userId)
      .eq("date", new Date().toISOString().split("T")[0])
      .maybeSingle()

    if (!attendance) {
      throw new Error("No attendance record found")
    }

    if (!attendance.lunch_start) {
      throw new Error("Lunch break not started")
    }

    const { data, error } = await supabase
      .from("attendance")
      .update({
        lunch_end: now,
        updated_at: now,
      })
      .eq("id", attendance.id)
      .select()
      .single()

    if (error) throw error
    return data
  }

  // --- FIX IS HERE ---
  async getTodayAttendance(userId: string): Promise<AttendanceRecord | null> {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("attendance")
      .select()
      .eq("user_id", userId)
      .eq("date", new Date().toISOString().split("T")[0])
      .maybeSingle() // <--- CHANGED FROM .single() TO .maybeSingle()

    if (error) {
      throw error
    }

    return data // This will be null if no rows, which is what we want
  }

  async getAttendanceHistory(userId: string, startDate: string, endDate: string): Promise<AttendanceRecord[]> {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("attendance")
      .select()
      .eq("user_id", userId)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: false })

    if (error) throw error
    return data || []
  }

  async getTeamAttendance(date: string): Promise<any[]> {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("attendance")
      .select(`*
        user:users(full_name, email, role)
      `)
      .eq("date", date)
      .order("check_in", { ascending: false })

    if (error) throw error
    return data || []
  }
}

export const attendanceService = AttendanceService.getInstance()
