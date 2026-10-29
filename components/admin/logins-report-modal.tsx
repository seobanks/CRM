"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Download, Share2, Check, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  DailyLoginReportRow,
  MonthlyLoginReportRow,
  generateDailyLoginsCanvas,
  generateMonthlyLoginsCanvas,
  getDailyLoginsTextCaption,
  getMonthlyLoginsTextCaption,
  copyCanvasImageToClipboard,
  downloadCanvasImage,
  shareCanvasViaWebShare,
} from "@/lib/share-logins-report";

interface LoginsReportModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "daily" | "monthly";
  dailyRows?: DailyLoginReportRow[];
  monthlyRows?: MonthlyLoginReportRow[];
  titleLabel?: string;
}

export function LoginsReportModal({
  isOpen,
  onOpenChange,
  mode,
  dailyRows = [],
  monthlyRows = [],
  titleLabel,
}: LoginsReportModalProps) {
  const [copiedImage, setCopiedImage] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const effectiveLabel =
    titleLabel || (mode === "daily" ? "Today" : "This Month");

  useEffect(() => {
    let isMounted = true;

    if (isOpen) {
      const renderCanvas = async () => {
        try {
          let canvas: HTMLCanvasElement;
          if (mode === "daily") {
            canvas = await generateDailyLoginsCanvas(dailyRows, {
              dateLabel: effectiveLabel,
            });
          } else {
            canvas = await generateMonthlyLoginsCanvas(monthlyRows, {
              monthLabel: effectiveLabel,
            });
          }

          if (!isMounted) return;
          canvasRef.current = canvas;
          setPreviewDataUrl(canvas.toDataURL("image/png"));
        } catch (err) {
          console.error("Error generating logins canvas preview:", err);
        }
      };

      renderCanvas();
    } else {
      setPreviewDataUrl(null);
      canvasRef.current = null;
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen, mode, dailyRows, monthlyRows, effectiveLabel]);

  const getTextCaption = () => {
    if (mode === "daily") {
      return getDailyLoginsTextCaption(dailyRows, effectiveLabel);
    } else {
      return getMonthlyLoginsTextCaption(monthlyRows, effectiveLabel);
    }
  };

  const handleCopyImage = async () => {
    if (!canvasRef.current) return;
    const ok = await copyCanvasImageToClipboard(canvasRef.current);
    if (ok) {
      setCopiedImage(true);
      setTimeout(() => setCopiedImage(false), 3000);
    }
  };

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const filename = `BanksCart_${mode === "daily" ? "Daily" : "Monthly"}_Logins_${Date.now()}.png`;
    downloadCanvasImage(canvasRef.current, filename);
  };

  const handleShare = async () => {
    if (!canvasRef.current) return;
    setIsSharing(true);
    try {
      const text = getTextCaption();
      await shareCanvasViaWebShare(
        canvasRef.current,
        text,
        `BanksCart ${mode === "daily" ? "Daily" : "Monthly"} Logins Report`
      );
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyText = async () => {
    const text = getTextCaption();
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopiedText(true);
      toast.success("Summary text copied to clipboard!");
      setTimeout(() => setCopiedText(false), 3000);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto bg-slate-900 border-slate-800 text-white p-6 rounded-2xl shadow-2xl">
        <DialogHeader className="pb-3 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/bankscart-logo.png"
                  alt="BanksCart.com"
                  className="h-7 w-auto object-contain bg-white px-2 py-0.5 rounded shadow-xs"
                />
                <DialogTitle className="text-lg font-black text-white">
                  {mode === "daily" ? "Daily Logins" : "Monthly Logins"} Performance Screenshot
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-slate-400">
                Live rendered table with Excel heatmaps and medals. Click{" "}
                <b className="text-emerald-400">Copy Image</b> to paste directly into WhatsApp Web (
                <kbd className="px-1 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">
                  Ctrl + V
                </kbd>
                ).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Action Buttons Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2">
          <Button
            onClick={handleCopyImage}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs h-9 px-4 gap-2 rounded-xl shadow-lg shadow-emerald-950/40"
          >
            {copiedImage ? (
              <>
                <Check className="h-4 w-4 text-white" />
                <span>Image Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                <span>Copy Image (Ctrl + V in WhatsApp)</span>
              </>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={handleDownload}
            className="border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-bold text-xs h-9 px-3.5 gap-2 rounded-xl"
          >
            <Download className="h-4 w-4 text-slate-300" />
            <span>Download PNG</span>
          </Button>

          <Button
            variant="outline"
            onClick={handleShare}
            disabled={isSharing}
            className="border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-bold text-xs h-9 px-3.5 gap-2 rounded-xl"
          >
            {isSharing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="h-4 w-4 text-emerald-400" />
            )}
            <span>Share to WhatsApp / Native</span>
          </Button>

          <Button
            variant="ghost"
            onClick={handleCopyText}
            className="text-slate-400 hover:text-white hover:bg-slate-800/60 font-semibold text-xs h-9 px-3 gap-1.5 rounded-xl ml-auto"
          >
            {copiedText ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            <span>{copiedText ? "Text Copied" : "Copy Summary Text"}</span>
          </Button>
        </div>

        {/* Live Canvas Preview */}
        <div className="bg-slate-950 rounded-xl p-3 border border-slate-800/80 flex items-center justify-center min-h-[300px] overflow-auto">
          {previewDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewDataUrl}
              alt="BanksCart Logins Report Preview"
              className="max-w-full h-auto rounded-lg shadow-2xl border border-slate-800"
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="h-6 w-6 text-indigo-500 animate-spin" />
              <p className="text-xs font-semibold text-slate-400">
                Rendering high-resolution BanksCart report...
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
