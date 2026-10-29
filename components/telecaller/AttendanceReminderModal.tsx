"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Clock,
  LogIn,
  LogOut,
  ArrowRight,
  Bell,
  CheckCircle2,
  AlertCircle,
  Timer,
  Loader2,
  CalendarDays,
} from "lucide-react"
import { attendanceService, AttendanceRecord } from "@/lib/attendance-service"
import { useToast } from "@/components/ui/use-toast"
import { format, differenceInMinutes } from "date-fns"

interface AttendanceReminderModalProps {
  userId: string
}

export function AttendanceReminderModal({ userId }: AttendanceReminderModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [modalType, setModalType] = useState<"checkin" | "checkout">("checkin")
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())

  const router = useRouter()
  const pathname = usePathname()
  const { toast } = useToast()
  const lastCheckDateRef = useRef<string>("")

  // Live seconds ticker while modal is visible
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Check attendance status logic
  const checkAttendance = useCallback(async () => {
    // If user is already on the attendance page, don't show the reminder modal
    if (pathname === "/telecaller/attendance") {
      setIsOpen(false)
      return
    }

    const now = new Date()
    const todayStr = now.toISOString().split("T")[0]
    lastCheckDateRef.current = todayStr

    // If DailyWelcomeModal is pending for today, let it show first before we display
    if (typeof window !== "undefined") {
      const seenWelcome = localStorage.getItem(`seen_welcome_${todayStr}`)
      if (!seenWelcome) {
        // Welcome modal hasn't been dismissed yet
        return
      }
    }

    try {
      setLoading(true)
      const record = await attendanceService.getTodayAttendance(userId)
      setTodayAttendance(record)

      const hours = now.getHours()
      const minutes = now.getMinutes()
      // 6:20 PM is 18:20
      const isPast620PM = hours > 18 || (hours === 18 && minutes >= 20)

      if (isPast620PM) {
        // After 6:20 PM
        if (record?.check_in && !record?.check_out) {
          // Checked in but NOT checked out -> Show checkout popup
          const snoozeUntil = sessionStorage.getItem(`attendance_snooze_checkout_${todayStr}`)
          if (!snoozeUntil || Date.now() >= parseInt(snoozeUntil, 10)) {
            setModalType("checkout")
            setIsOpen(true)
          } else {
            setIsOpen(false)
          }
        } else if (!record?.check_in) {
          // Never checked in today
          const snoozeUntil = sessionStorage.getItem(`attendance_snooze_checkin_${todayStr}`)
          if (!snoozeUntil || Date.now() >= parseInt(snoozeUntil, 10)) {
            setModalType("checkin")
            setIsOpen(true)
          } else {
            setIsOpen(false)
          }
        } else {
          // Already checked out -> No popup needed
          setIsOpen(false)
        }
      } else {
        // Before 6:20 PM
        if (!record?.check_in) {
          // Not checked in -> Show checkin popup
          const snoozeUntil = sessionStorage.getItem(`attendance_snooze_checkin_${todayStr}`)
          if (!snoozeUntil || Date.now() >= parseInt(snoozeUntil, 10)) {
            setModalType("checkin")
            setIsOpen(true)
          } else {
            setIsOpen(false)
          }
        } else {
          // Checked in and before 6:20 PM -> All good!
          setIsOpen(false)
        }
      }
    } catch (err) {
      console.error("Failed to check attendance reminder status:", err)
    } finally {
      setLoading(false)
    }
  }, [userId, pathname])

  // Periodic check (every 30 seconds) + on initial mount / route change
  useEffect(() => {
    // Initial check after short delay (let initial layout render smoothly)
    const initialTimer = setTimeout(() => {
      checkAttendance()
    }, 1500)

    const interval = setInterval(() => {
      checkAttendance()
    }, 30000)

    // Listen for custom attendance-updated events triggered from other components
    const handleAttendanceUpdated = () => {
      checkAttendance()
    }
    window.addEventListener("attendance-updated", handleAttendanceUpdated)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
      window.removeEventListener("attendance-updated", handleAttendanceUpdated)
    }
  }, [checkAttendance])

  // Handle Snooze (10 minutes)
  const handleSnooze = (minutes = 10) => {
    const todayStr = new Date().toISOString().split("T")[0]
    const snoozeUntil = Date.now() + minutes * 60 * 1000
    const key =
      modalType === "checkout"
        ? `attendance_snooze_checkout_${todayStr}`
        : `attendance_snooze_checkin_${todayStr}`

    sessionStorage.setItem(key, snoozeUntil.toString())
    setIsOpen(false)

    toast({
      title: "Reminder Snoozed",
      description: `We'll remind you again in ${minutes} minutes.`,
      duration: 3000,
    })
  }

  // Handle Quick Check-In
  const handleCheckInNow = async () => {
    setSubmitting(true)
    try {
      const record = await attendanceService.checkIn(userId, "Web Check-In", "Office")
      setTodayAttendance(record)
      setIsOpen(false)

      toast({
        title: "Checked In Successfully! 🌅",
        description: `Welcome! Checked in at ${format(new Date(), "hh:mm a")}. Have a productive day!`,
        duration: 4000,
      })

      window.dispatchEvent(new CustomEvent("attendance-updated", { detail: record }))
    } catch (err: any) {
      console.error("Check-in failed:", err)
      toast({
        title: "Check-In Failed",
        description: err.message || "Failed to mark check-in. Please try again.",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Quick Check-Out
  const handleCheckOutNow = async () => {
    setSubmitting(true)
    try {
      const record = await attendanceService.checkOut(userId, "Shift Completed")
      setTodayAttendance(record)
      setIsOpen(false)

      toast({
        title: "Checked Out Successfully! 🌙",
        description: `Shift ended at ${format(new Date(), "hh:mm a")}. Total time: ${
          record.total_hours || "Logged"
        }h. Great work today!`,
        duration: 4000,
      })

      window.dispatchEvent(new CustomEvent("attendance-updated", { detail: record }))
    } catch (err: any) {
      console.error("Check-out failed:", err)
      toast({
        title: "Check-Out Failed",
        description: err.message || "Failed to mark check-out. Please try again.",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  // Navigate to full attendance page
  const handleGoToAttendance = () => {
    setIsOpen(false)
    router.push("/telecaller/attendance")
  }

  // Calculate elapsed time if checked in
  const getElapsedHoursText = () => {
    if (!todayAttendance?.check_in) return null
    try {
      const diffMins = differenceInMinutes(new Date(), new Date(todayAttendance.check_in))
      const h = Math.floor(diffMins / 60)
      const m = diffMins % 60
      return `${h}h ${m.toString().padStart(2, "0")}m`
    } catch {
      return null
    }
  }

  if (!isOpen) return null

  const isCheckInModal = modalType === "checkin"

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleSnooze(10)
        }
      }}
    >
      <DialogContent className="sm:max-w-md p-0 overflow-hidden border-2 border-slate-200 dark:border-slate-800 shadow-2xl bg-white dark:bg-slate-900">
        {/* Top Decorative Banner */}
        <div
          className={`h-2.5 w-full ${
            isCheckInModal
              ? "bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500"
              : "bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500"
          }`}
        />

        <div className="p-6">
          <DialogHeader className="text-center sm:text-center space-y-3">
            {/* Header Icon */}
            <div className="mx-auto">
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg transition-transform hover:scale-105 ${
                  isCheckInModal
                    ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                    : "bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                }`}
              >
                {isCheckInModal ? (
                  <LogIn className="w-8 h-8 animate-pulse" />
                ) : (
                  <LogOut className="w-8 h-8 animate-bounce" />
                )}
              </div>
            </div>

            <div className="flex justify-center">
              <Badge
                variant="outline"
                className={`text-xs font-semibold px-2.5 py-0.5 tracking-wider uppercase ${
                  isCheckInModal
                    ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700"
                    : "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                }`}
              >
                {isCheckInModal ? "Attendance Required" : "Shift End Reminder • 6:20 PM"}
              </Badge>
            </div>

            <DialogTitle className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {isCheckInModal ? "Check-In Reminder" : "Time to Check Out"}
            </DialogTitle>

            <DialogDescription className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed max-w-sm mx-auto">
              {isCheckInModal
                ? "You haven't checked in yet today. Please mark your attendance to log your shift and start receiving calls."
                : "It is past 6:20 PM and your workday shift has ended. Please check out to record your total hours for today."}
            </DialogDescription>
          </DialogHeader>

          {/* Info Card / Live Clock */}
          <div className="mt-5 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 pb-2">
              <div className="flex items-center gap-1.5 font-medium">
                <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                <span>{format(currentTime, "EEEE, dd MMM yyyy")}</span>
              </div>
              <div className="flex items-center gap-1 font-mono font-semibold text-slate-700 dark:text-slate-300">
                <Clock className="w-3.5 h-3.5 text-blue-500" />
                <span>{format(currentTime, "hh:mm:ss a")}</span>
              </div>
            </div>

            {/* If checkout modal, show shift details */}
            {!isCheckInModal && todayAttendance?.check_in && (
              <div className="grid grid-cols-2 gap-2 pt-1 text-center">
                <div className="bg-white dark:bg-slate-900/80 p-2.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                    Checked In At
                  </div>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {format(new Date(todayAttendance.check_in), "hh:mm a")}
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900/80 p-2.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                    Total Time
                  </div>
                  <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {getElapsedHoursText() || "Calculating..."}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-6 space-y-2.5">
            {isCheckInModal ? (
              <Button
                onClick={handleCheckInNow}
                disabled={submitting}
                className="w-full h-11 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg transition-all"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Recording Check-In...
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4 mr-2" />
                    Check In Now
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={handleCheckOutNow}
                disabled={submitting}
                className="w-full h-11 text-base font-semibold bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-700 hover:to-rose-700 text-white shadow-md hover:shadow-lg transition-all"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Recording Check-Out...
                  </>
                ) : (
                  <>
                    <LogOut className="w-4 h-4 mr-2" />
                    Check Out Now
                  </>
                )}
              </Button>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleGoToAttendance}
                className="flex-1 h-10 text-xs font-medium border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Attendance Page
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>

              <Button
                type="button"
                variant="ghost"
                onClick={() => handleSnooze(10)}
                className="flex-1 h-10 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Timer className="w-3.5 h-3.5 mr-1" />
                Remind in 10m
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
