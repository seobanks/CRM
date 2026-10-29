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
  PerformanceTableRow,
  generatePerformanceTableCanvas,
  copyCanvasImageToClipboard,
  downloadCanvasImage,
  shareCanvasViaWebShare,
  getPerformanceTableTextCaption,
} from "@/lib/share-performance-table";

interface PerformanceTableModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  rows: PerformanceTableRow[];
  dateLabel?: string;
}

export function PerformanceTableModal({
  isOpen,
  onOpenChange,
  rows,
  dateLabel = "Today",
}: PerformanceTableModalProps) {
  const [copiedImage, setCopiedImage] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Generate canvas when modal opens
  useEffect(() => {
    let isMounted = true;
    if (isOpen && rows.length > 0) {
      generatePerformanceTableCanvas(rows, {
        dateLabel,
        brandName: "BanksCart",
      })
        .then((canvas) => {
          if (!isMounted) return;
          canvasRef.current = canvas;
          setPreviewDataUrl(canvas.toDataURL("image/png"));
        })
        .catch((err) => {
          console.error("Error generating canvas preview:", err);
        });
    } else {
      setPreviewDataUrl(null);
      canvasRef.current = null;
    }
    return () => {
      isMounted = false;
    };
  }, [isOpen, rows, dateLabel]);

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
    downloadCanvasImage(canvasRef.current, `BanksCart_Performance_${Date.now()}.png`);
  };

  const handleShare = async () => {
    if (!canvasRef.current) return;
    setIsSharing(true);
    try {
      const text = getPerformanceTableTextCaption(rows, dateLabel);
      await shareCanvasViaWebShare(canvasRef.current, text);
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyText = async () => {
    const text = getPerformanceTableTextCaption(rows, dateLabel);
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopiedText(true);
      toast.success("Summary text copied to clipboard!");
      setTimeout(() => setCopiedText(false), 3000);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col p-4 sm:p-6 bg-slate-900 text-slate-100 border-slate-800">
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
                  Calling Performance Screenshot
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-slate-400">
                Live rendered table with Excel heatmaps and medals. Click <b className="text-emerald-400">Copy Image</b> to paste directly into WhatsApp Web (<kbd className="px-1 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">Ctrl + V</kbd>).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2 py-3 border-b border-slate-800/80">
          {/* 1. Copy Image (Primary Action for WhatsApp Web) */}
          <Button
            onClick={handleCopyImage}
            className={`font-bold flex-1 sm:flex-initial gap-2 text-white shadow-lg transition-all ${
              copiedImage
                ? "bg-emerald-700 hover:bg-emerald-800"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {copiedImage ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiedImage ? "Copied! Press Ctrl+V in WhatsApp 🎉" : "Copy Image for WhatsApp"}
          </Button>

          {/* 2. Download PNG */}
          <Button
            onClick={handleDownload}
            variant="outline"
            className="border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold gap-1.5 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            Download PNG
          </Button>

          {/* 3. Share via Web Share */}
          <Button
            onClick={handleShare}
            disabled={isSharing}
            variant="outline"
            className="border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold gap-1.5 text-xs"
          >
            {isSharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5 text-emerald-400" />}
            Share to WhatsApp / Native
          </Button>

          {/* 4. Copy Text Caption */}
          <Button
            onClick={handleCopyText}
            variant="ghost"
            className="text-slate-400 hover:text-slate-200 hover:bg-slate-800 font-medium gap-1.5 text-xs ml-auto"
          >
            {copiedText ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <FileText className="h-3.5 w-3.5" />}
            {copiedText ? "Text Copied!" : "Copy Summary Text"}
          </Button>
        </div>

        {/* Image Preview Area */}
        <div className="flex-1 overflow-y-auto py-3 px-1">
          {previewDataUrl ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:p-4 flex justify-center shadow-inner">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewDataUrl}
                alt="BanksCart Performance Report"
                className="max-w-full h-auto rounded-lg shadow-2xl border border-slate-700/50"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="h-6 w-6 text-emerald-500 animate-spin" />
              <p className="text-xs font-semibold text-slate-400">Rendering high-resolution BanksCart report...</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
