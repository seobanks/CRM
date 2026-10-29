"use client";

import { useState, useEffect, useRef } from "react";
import { format, startOfMonth, endOfMonth, parseISO, differenceInMinutes, subMonths, isAfter, isSameDay, getDay, getDate, eachDayOfInterval } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Calendar, 
  Clock, 
  BarChart3, 
  Wifi, 
  Coffee, 
  LogIn, 
  LogOut,
  CheckCircle,
  XCircle,
  AlertCircle,
  Pause,
  Monitor,
  ChevronDown,
  PartyPopper,
  CalendarDays,
  Timer
} from "lucide-react";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import FaceRegistrationModal from "@/components/attendance/face-registration-modal";
import FaceAuthModal from "@/components/attendance/face-auth-modal";

// Import your specific service and types
import { attendanceService, AttendanceRecord } from "@/lib/attendance-service";

type Holiday = {
  id: string;
  date: string;
  name: string;
  type: 'public' | 'custom';
  is_working_day: boolean;
};

const MAX_SHIFT_MINUTES = 9 * 60; // 9 Hours

export default function EnhancedTelecallerAttendancePage() {
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>({
    start: startOfMonth(new Date()),
    end: endOfMonth(new Date())
  });
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceRecord[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);

  // Biometric Face Auth States
  const [faceRegistered, setFaceRegistered] = useState<boolean | null>(null);
  const [registeredEmbeddings, setRegisteredEmbeddings] = useState<any | null>(null);
  const [activeAuthAction, setActiveAuthAction] = useState<"check-in" | "check-out" | "break" | "resume" | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  const [notes, setNotes] = useState("");
  const [showCheckInDialog, setShowCheckInDialog] = useState(false);
  const [showCheckOutDialog, setShowCheckOutDialog] = useState(false);
  const [showBreakDialog, setShowBreakDialog] = useState(false);
  
  const [idleTime, setIdleTime] = useState(0);
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [liveTime, setLiveTime] = useState(new Date()); // Live ticker
  
  const lastActivityRef = useRef<Date>(new Date());
  const supabase = createClient();

  // --- LIVE CLOCK TICKER ---
  useEffect(() => {
    const timer = setInterval(() => setLiveTime(new Date()), 60000); // Update every minute
    return () => clearInterval(timer);
  }, []);

  // --- IDLE TIMER LOGIC ---
  useEffect(() => {
    const handleUserActivity = () => {
      lastActivityRef.current = new Date();
      setIdleTime((prev) => (prev > 0 ? 0 : prev));
    };

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(event => window.addEventListener(event, handleUserActivity, true));
    
    const intervalId = setInterval(() => {
      const now = new Date();
      const diff = differenceInMinutes(now, lastActivityRef.current);
      if (diff >= 5) setIdleTime(diff - 5);
    }, 60000); 
    
    return () => {
      clearInterval(intervalId);
      events.forEach(event => window.removeEventListener(event, handleUserActivity, true));
    };
  }, []);

  // --- DATA LOADING ---
  useEffect(() => {
    loadAttendanceData();
  }, [dateRange]);

  const loadAttendanceData = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      // Query face registration
      const { data: faceData } = await supabase
        .from("employee_face_data")
        .select("face_embeddings")
        .eq("user_id", user.id)
        .maybeSingle();

      if (faceData) {
        setFaceRegistered(true);
        setRegisteredEmbeddings(faceData.face_embeddings);
      } else {
        setFaceRegistered(false);
      }

      const startDateStr = format(dateRange.start, "yyyy-MM-dd");
      const endDateStr = format(dateRange.end, "yyyy-MM-dd");

      const today = new Date();
      if (isAfter(today, dateRange.start) || isSameDay(today, dateRange.start)) {
          const todayRecord = await attendanceService.getTodayAttendance(user.id);
          setTodayAttendance(todayRecord);
      } else {
          setTodayAttendance(null);
      }

      const history = await attendanceService.getAttendanceHistory(user.id, startDateStr, endDateStr);
      setAttendanceHistory(history);

      // Fetch Holidays
      const { data: holidayData } = await supabase
        .from("holidays")
        .select("*")
        .gte("date", startDateStr)
        .lte("date", endDateStr);
      
      setHolidays(holidayData || []);

    } catch (error) {
      console.error("Error loading attendance data:", error);
    } finally {
      setLoading(false);
    }
  };

  // --- HOLIDAY LOGIC ---
  const checkIfHoliday = (dateObj: Date, dateStr: string) => {
    // 1. Check DB Custom/Public Holidays
    const dbHoliday = holidays.find(h => h.date === dateStr);
    if (dbHoliday) {
      if (!dbHoliday.is_working_day) return { isHoliday: true, name: dbHoliday.name };
      if (dbHoliday.is_working_day) return { isHoliday: false, name: "" }; 
    }

    // 2. Check Sunday
    if (getDay(dateObj) === 0) return { isHoliday: true, name: "Sunday" };

    // 3. Check Second Saturday (Read from localStorage to match Admin settings)
    const enableSecondSat = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('enableSecondSaturdayHoliday') || 'false') : false;
    if (enableSecondSat && getDay(dateObj) === 6) {
      const dateNum = getDate(dateObj);
      if (dateNum >= 8 && dateNum <= 14) return { isHoliday: true, name: "Second Saturday" };
    }

    return { isHoliday: false, name: "" };
  };

  // --- ACTIONS ---
  const handleCheckIn = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const attendance = await attendanceService.checkIn(user.id, notes, "Office");
      setTodayAttendance(attendance);
      setNotes("");
      setShowCheckInDialog(false);
      loadAttendanceData(); 
    } catch (error) { console.error("Check-in failed:", error); }
  };

  const handleCheckOut = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const attendance = await attendanceService.checkOut(user.id, notes);
      setTodayAttendance(attendance);
      setNotes("");
      setShowCheckOutDialog(false);
      loadAttendanceData(); 
    } catch (error) { console.error("Check-out failed:", error); }
  };

  const handleStartLunch = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const attendance = await attendanceService.startLunchBreak(user.id);
      setTodayAttendance(attendance);
      setShowBreakDialog(false);
    } catch (error) { console.error("Start break failed:", error); }
  };

  const handleEndLunch = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const attendance = await attendanceService.endLunchBreak(user.id);
      setTodayAttendance(attendance);
    } catch (error) { console.error("End break failed:", error); }
  };

  // --- LIVE CALCULATIONS ---
  const getLiveWorkingMinutes = (record: AttendanceRecord | null) => {
    if (!record?.check_in) return 0;
    
    const checkInTime = new Date(record.check_in);
    const checkOutTime = record.check_out ? new Date(record.check_out) : liveTime; // Uses live state
    
    let totalMinutes = differenceInMinutes(checkOutTime, checkInTime);
    
    if (record.lunch_start) {
        if (record.lunch_end) {
            totalMinutes -= differenceInMinutes(new Date(record.lunch_end), new Date(record.lunch_start));
        } else {
            totalMinutes -= differenceInMinutes(liveTime, new Date(record.lunch_start));
        }
    }
    return Math.max(0, totalMinutes);
  };

  const getLiveWorkingHours = (record: AttendanceRecord | null) => {
    const mins = getLiveWorkingMinutes(record);
    return { hours: Math.floor(mins / 60), minutes: mins % 60, totalMins: mins };
  };

  const handleQuickDateRange = (range: string) => {
    const today = new Date();
    let start, end;
    switch (range) {
      case "current-month": start = startOfMonth(today); end = endOfMonth(today); break;
      case "last-month": 
        const lastMonth = subMonths(today, 1);
        start = startOfMonth(lastMonth); end = endOfMonth(lastMonth); break;
      case "last-30-days":
        start = new Date(today); start.setDate(today.getDate() - 30); end = today; break;
      default: start = startOfMonth(today); end = endOfMonth(today);
    }
    setDateRange({ start, end });
    setDateRangeOpen(false);
  };

  // --- RENDER HELPERS ---
  const isCheckedIn = !!todayAttendance?.check_in;
  const isCheckedOut = !!todayAttendance?.check_out;
  const isOnLunch = !!todayAttendance?.lunch_start && !todayAttendance?.lunch_end;
  const liveStats = getLiveWorkingHours(todayAttendance);
  const progressPercent = Math.min(100, (liveStats.totalMins / MAX_SHIFT_MINUTES) * 100);

  const todayHolidayInfo = checkIfHoliday(new Date(), format(new Date(), "yyyy-MM-dd"));

  // Generate continuous timeline for history table up to today
  const timelineDays = eachDayOfInterval({ 
    start: dateRange.start, 
    end: isAfter(dateRange.end, new Date()) ? new Date() : dateRange.end 
  }).reverse();

  if (loading && !todayAttendance && attendanceHistory.length === 0) {
    return <div className="p-6 flex items-center justify-center min-h-[400px] text-gray-500">Loading attendance data...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Attendance</h1>
          <p className="text-gray-600 mt-1">Track your daily attendance and working hours</p>
        </div>
        
        <Popover open={dateRangeOpen} onOpenChange={setDateRangeOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="flex items-center gap-2 bg-white shadow-sm">
              <Calendar className="h-4 w-4" />
              {format(dateRange.start, "MMM dd")} - {format(dateRange.end, "MMM dd, yyyy")}
              <ChevronDown className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <div className="p-4 border-b bg-slate-50">
              <h4 className="font-medium mb-2 text-sm text-slate-500 uppercase">Quick Select</h4>
              <div className="space-y-1">
                {[
                  { label: "This Month", value: "current-month" },
                  { label: "Last Month", value: "last-month" },
                  { label: "Last 30 Days", value: "last-30-days" }
                ].map((range) => (
                  <Button key={range.value} variant="ghost" className="w-full justify-start text-sm" onClick={() => handleQuickDateRange(range.value)}>
                    {range.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="p-4">
              <h4 className="font-medium mb-2 text-sm text-slate-500 uppercase">Custom Range</h4>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="start-date">From</Label>
                  <input type="date" className="w-full p-2 border rounded-md text-sm" value={format(dateRange.start, "yyyy-MM-dd")} onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value ? new Date(e.target.value) : prev.start }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end-date">To</Label>
                  <input type="date" className="w-full p-2 border rounded-md text-sm" value={format(dateRange.end, "yyyy-MM-dd")} onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value ? new Date(e.target.value) : prev.end }))} />
                </div>
                <Button onClick={() => setDateRangeOpen(false)} className="w-full">Apply</Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {todayHolidayInfo.isHoliday && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex items-start gap-3 shadow-sm">
           <PartyPopper className="h-6 w-6 text-purple-600 shrink-0 mt-0.5" />
           <div>
              <h3 className="font-semibold text-purple-900">Today is a Holiday: {todayHolidayInfo.name}</h3>
              <p className="text-sm text-purple-700 mt-1">Enjoy your day off! You can still log in if you are scheduled for a special shift.</p>
           </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="shadow-sm">
          <CardHeader className="bg-slate-50 border-b pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-5 w-5 text-blue-500" />
              Summary ({format(dateRange.start, "MMM")})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg border border-green-100">
                <span className="text-sm font-medium text-green-800">Days Present</span>
                <span className="text-xl text-green-700 font-bold">{attendanceHistory.length}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg border border-purple-100">
                <span className="text-sm font-medium text-purple-800">Holidays</span>
                <span className="text-xl text-purple-700 font-bold">
                  {timelineDays.filter(d => checkIfHoliday(d, format(d, 'yyyy-MM-dd')).isHoliday).length}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <Card className="shadow-sm relative overflow-hidden">
            {/* PROGRESS BAR STRIP */}
            {isCheckedIn && (
              <div className="absolute top-0 left-0 w-full h-1.5 bg-slate-100">
                 <div className={`h-full transition-all duration-1000 ${progressPercent >= 100 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${progressPercent}%` }} />
              </div>
            )}
            
            <CardHeader className="border-b pb-4 mt-1">
              <CardTitle className="flex items-center justify-between text-base">
                <div className="flex items-center gap-2">
                   <Clock className="h-5 w-5 text-slate-500" />
                   Today's Status
                </div>
                <Badge variant="outline" className="font-normal text-slate-500 bg-slate-50">{format(new Date(), "EEEE, MMM dd")}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                {/* TIMELINE */}
                <div className="space-y-6 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
                  
                  {/* Check In Node */}
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-5 h-5 rounded-full border-2 border-white bg-slate-200 text-slate-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 
                      ${isCheckedIn ? 'bg-green-500 text-white' : ''}">
                       {isCheckedIn ? <CheckCircle className="w-3 h-3 text-white"/> : <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />}
                    </div>
                    <div className="w-[calc(100%-2.5rem)] md:w-[calc(50%-1.5rem)] p-3 rounded-lg border border-slate-100 bg-white shadow-sm">
                      <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Check-in</div>
                      {isCheckedIn ? (
                         <div className="font-bold text-slate-800 flex items-center gap-2">
                            {format(new Date(todayAttendance!.check_in!), "hh:mm a")}
                            {todayAttendance!.ip_check_in && <Wifi className="h-3 w-3 text-green-500" />}
                         </div>
                      ) : <div className="text-sm text-slate-400 italic">Not checked in</div>}
                    </div>
                  </div>

                  {/* Lunch Node */}
                  {isCheckedIn && (
                    <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div className="flex items-center justify-center w-5 h-5 rounded-full border-2 border-white bg-orange-100 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                         <Coffee className="w-2.5 h-2.5 text-orange-600"/>
                      </div>
                      <div className="w-[calc(100%-2.5rem)] md:w-[calc(50%-1.5rem)] p-3 rounded-lg border border-slate-100 bg-white shadow-sm">
                        <div className="flex justify-between items-center mb-1">
                          <div className="text-xs font-semibold text-slate-500 uppercase">Lunch Break</div>
                          {isOnLunch && <Badge variant="outline" className="text-[9px] h-4 bg-orange-50 text-orange-600 border-orange-200">Active</Badge>}
                        </div>
                        {todayAttendance?.lunch_start ? (
                           <div className="text-sm font-medium text-slate-700">
                             {format(new Date(todayAttendance.lunch_start), "hh:mm a")} 
                             {todayAttendance.lunch_end ? ` - ${format(new Date(todayAttendance.lunch_end), "hh:mm a")}` : " - Now"}
                           </div>
                        ) : <div className="text-sm text-slate-400 italic">Not taken</div>}
                        
                        {isOnLunch && (
                          <Button size="sm" variant="outline" onClick={() => setActiveAuthAction("resume")} className="w-full mt-2 h-7 text-xs text-red-600 border-red-200 hover:bg-red-50">
                            End Break
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Check Out Node */}
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-5 h-5 rounded-full border-2 border-white bg-slate-200 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10
                      ${isCheckedOut ? 'bg-red-500 text-white' : ''}">
                       {isCheckedOut ? <LogOut className="w-2.5 h-2.5 text-white"/> : <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />}
                    </div>
                    <div className="w-[calc(100%-2.5rem)] md:w-[calc(50%-1.5rem)] p-3 rounded-lg border border-slate-100 bg-white shadow-sm">
                      <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Check-out</div>
                      {isCheckedOut ? (
                         <div className="font-bold text-slate-800">{format(new Date(todayAttendance!.check_out!), "hh:mm a")}</div>
                      ) : isCheckedIn ? (
                         <div className="text-sm text-blue-500 font-medium flex items-center gap-1 animate-pulse"><Timer className="w-3 h-3"/> Active Shift</div>
                      ) : <div className="text-sm text-slate-400 italic">Pending</div>}
                    </div>
                  </div>

                </div>

                {/* STATS & ACTIONS */}
                <div className="flex flex-col justify-center space-y-6">
                  
                  {isCheckedIn && (
                    <div className="text-center p-6 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Total Logged Time</p>
                      <div className="text-4xl font-black text-slate-800 tracking-tighter tabular-nums">
                        {liveStats.hours}h {liveStats.minutes.toString().padStart(2, '0')}m
                      </div>
                      
                      {idleTime > 0 && !isCheckedOut && !isOnLunch && (
                        <div className="mt-3 inline-flex items-center gap-1.5 bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-medium">
                          <Pause className="h-3 w-3" /> Idle for {idleTime}m
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 flex-col sm:flex-row">
                    {!isCheckedIn ? (
                      <Button onClick={() => setActiveAuthAction("check-in")} className="w-full h-12 text-lg font-medium shadow-md hover:shadow-lg transition-all animate-in fade-in duration-300" size="lg">
                        <LogIn className="h-5 w-5 mr-2" /> Check In Now
                      </Button>
                    ) : !isCheckedOut && !isOnLunch ? (
                      <>
                        {!todayAttendance?.lunch_start && (
                          <Button variant="outline" onClick={() => setActiveAuthAction("break")} className="flex-1 h-12 bg-white hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 transition-colors animate-in fade-in duration-300">
                            <Coffee className="h-5 w-5 mr-2" /> Lunch
                          </Button>
                        )}
                        <Button onClick={() => setActiveAuthAction("check-out")} className="flex-1 h-12 bg-slate-800 hover:bg-slate-900 shadow-md animate-in fade-in duration-300">
                          <LogOut className="h-5 w-5 mr-2" /> Check Out
                        </Button>
                      </>
                    ) : isCheckedIn && isOnLunch && (
                        <Button onClick={() => setActiveAuthAction("resume")} className="w-full h-12 bg-orange-100 hover:bg-orange-200 text-orange-700 opacity-100 font-bold border border-orange-200 transition-all cursor-pointer animate-in fade-in duration-300">
                            <Coffee className="h-5 w-5 mr-2 animate-pulse" /> On Lunch Break (End Break)
                        </Button>
                    )}
                  </div>
                </div>

              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="bg-slate-50 border-b">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-5 w-5 text-slate-500" />
            Attendance Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                <TableHead className="w-[200px]">Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Check-in</TableHead>
                <TableHead>Check-out</TableHead>
                <TableHead>Total Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {timelineDays.map(day => {
                const dateStr = format(day, "yyyy-MM-dd");
                const record = attendanceHistory.find(r => r.date === dateStr);
                const holidayInfo = checkIfHoliday(day, dateStr);
                
                // Determine Row Status
                let rowStatus = "Absent";
                let badgeClass = "bg-red-50 text-red-700 border-red-200";
                
                if (record) {
                    rowStatus = record.status || "Present";
                    badgeClass = rowStatus === "late" ? "bg-yellow-50 text-yellow-700 border-yellow-200" : "bg-green-50 text-green-700 border-green-200";
                } else if (holidayInfo.isHoliday) {
                    rowStatus = "Holiday";
                    badgeClass = "bg-purple-50 text-purple-700 border-purple-200";
                }

                return (
                  <TableRow key={dateStr} className="hover:bg-slate-50 transition-colors">
                    <TableCell>
                      <div className="font-medium text-slate-800">
                        {format(day, "EEE, MMM dd")}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={badgeClass}>
                         {rowStatus} {rowStatus === "Holiday" && `(${holidayInfo.name})`}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-600">
                      {record?.check_in ? format(new Date(record.check_in), "hh:mm a") : '-'}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-600">
                      {record?.check_out ? format(new Date(record.check_out), "hh:mm a") : '-'}
                    </TableCell>
                    <TableCell>
                      {record?.total_hours ? <span className="font-semibold text-slate-800">{record.total_hours}h</span> : '-'}
                    </TableCell>
                  </TableRow>
                );
              })}
              {timelineDays.length === 0 && (
                 <TableRow><TableCell colSpan={5} className="text-center py-8 text-slate-500">No dates in range</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Biometric Modals and Registration */}
      {faceRegistered === false && currentUserId && (
        <FaceRegistrationModal
          userId={currentUserId}
          onSuccess={() => {
            setFaceRegistered(true);
            loadAttendanceData();
          }}
        />
      )}

      {activeAuthAction && currentUserId && registeredEmbeddings && (
        <FaceAuthModal
          userId={currentUserId}
          action={activeAuthAction}
          registeredEmbeddings={registeredEmbeddings}
          onSuccess={(record) => {
            setTodayAttendance(record);
            setActiveAuthAction(null);
            loadAttendanceData();
          }}
          onClose={() => setActiveAuthAction(null)}
        />
      )}
    </div>
  );
}
