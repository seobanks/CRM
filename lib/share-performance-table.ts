"use client";

import { toast } from "sonner";

export interface PerformanceTableRow {
  name: string;
  totalCalls: number;
  connectedCalls: number;
  totalDurationSeconds: number;
  avgDurationSeconds?: number;
}

/**
 * Format total seconds to H:MM:SS (e.g. 7241 -> "2:00:41", 26 -> "0:00:26")
 */
export function formatDurationHMS(totalSeconds: number): string {
  if (!totalSeconds || isNaN(totalSeconds) || totalSeconds <= 0) return "0:00:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * 3-Color Excel Heatmap Gradient (Red -> Yellow -> Green)
 * 0.0 -> Red rgb(248, 105, 107) #f8696b
 * 0.5 -> Yellow rgb(255, 235, 132) #ffeb84
 * 1.0 -> Green rgb(99, 190, 123) #63be7b
 */
export function get3ColorScale(value: number, min: number, max: number): string {
  if (max === min) return "#ffffff";
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));

  let r: number, g: number, b: number;
  if (ratio <= 0.5) {
    const t = ratio / 0.5;
    r = Math.round(248 + (255 - 248) * t);
    g = Math.round(105 + (235 - 105) * t);
    b = Math.round(107 + (132 - 107) * t);
  } else {
    const t = (ratio - 0.5) / 0.5;
    r = Math.round(255 + (99 - 255) * t);
    g = Math.round(235 + (190 - 235) * t);
    b = Math.round(132 + (123 - 132) * t);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Generates an in-memory HTML5 Canvas containing the styled table matching the spreadsheet layout.
 */
export function generatePerformanceTableCanvas(
  rows: PerformanceTableRow[],
  options?: { dateLabel?: string; brandName?: string }
): HTMLCanvasElement {
  const dateLabel = options?.dateLabel || "Today";
  const brandName = options?.brandName || "Hanva CRM";

  // Min / Max for Heatmap calculations
  const maxCalls = Math.max(...rows.map((r) => r.totalCalls), 1);
  const minCalls = Math.min(...rows.map((r) => r.totalCalls), 0);

  const maxConnected = Math.max(...rows.map((r) => r.connectedCalls), 1);
  const minConnected = Math.min(...rows.map((r) => r.connectedCalls), 0);

  const maxDuration = Math.max(...rows.map((r) => r.totalDurationSeconds), 1);
  const minDuration = Math.min(...rows.map((r) => r.totalDurationSeconds), 0);

  const maxAvgDur = Math.max(
    ...rows.map((r) => (r.totalCalls > 0 ? r.totalDurationSeconds / r.totalCalls : 0)),
    1
  );
  const minAvgDur = Math.min(
    ...rows.map((r) => (r.totalCalls > 0 ? r.totalDurationSeconds / r.totalCalls : 0)),
    0
  );

  // Column widths matching spreadsheet:
  // Agent Name, Total Calls, Connected Calls, Total Duration, Connect Rate (Avg Duration)
  const colWidths = [180, 115, 130, 130, 125];
  const tableWidth = colWidths.reduce((a, b) => a + b, 0); // 680px
  const padX = 25;
  const padTop = 95;
  const headerHeight = 36;
  const rowHeight = 32;
  const totalsRowHeight = 34;
  const padBottom = 45;

  const totalLogicalWidth = tableWidth + padX * 2;
  const totalLogicalHeight =
    padTop + headerHeight + rows.length * rowHeight + totalsRowHeight + padBottom;

  // Use 2x pixel ratio for crystal clear high-DPI screenshot
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = totalLogicalWidth * scale;
  canvas.height = totalLogicalHeight * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.scale(scale, scale);

  // 1. Clean Canvas Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalLogicalWidth, totalLogicalHeight);

  // 2. Top Header Banner
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 20px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Agent Calling Performance Report", padX, 40);

  ctx.fillStyle = "#64748b";
  ctx.font = "500 13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(`Period: ${dateLabel}  •  ${rows.length} Active Telecallers`, padX, 64);

  // Top Right Summary Pill
  const totalCallsAll = rows.reduce((s, r) => s + r.totalCalls, 0);
  const totalConnectedAll = rows.reduce((s, r) => s + r.connectedCalls, 0);
  const connectRateAll = totalCallsAll > 0 ? Math.round((totalConnectedAll / totalCallsAll) * 100) : 0;

  ctx.fillStyle = "#f8fafc";
  if (ctx.roundRect) {
    ctx.roundRect(totalLogicalWidth - padX - 220, 24, 220, 48, 10);
  } else {
    ctx.fillRect(totalLogicalWidth - padX - 220, 24, 220, 48);
  }
  ctx.fill();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#0284c7";
  ctx.font = "bold 15px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${totalCallsAll.toLocaleString()} Calls Dialed`, totalLogicalWidth - padX - 110, 44);

  ctx.fillStyle = "#10b981";
  ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
  ctx.fillText(`${totalConnectedAll} Connected (${connectRateAll}%)`, totalLogicalWidth - padX - 110, 62);

  // 3. Table Column Headers
  let currentY = padTop;
  const colHeaders = ["Agent Name", "Total Calls", "Connected Calls", "Total Duration", "Connect Rate"];

  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(padX, currentY, tableWidth, headerHeight);

  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, currentY, tableWidth, headerHeight);

  let headerX = padX;
  colHeaders.forEach((title, idx) => {
    const w = colWidths[idx];
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
    ctx.textAlign = idx === 0 ? "left" : "right";

    const textX = idx === 0 ? headerX + 10 : headerX + w - 10;
    ctx.fillText(title, textX, currentY + 22);

    // Draw vertical column divider
    if (idx > 0) {
      ctx.strokeStyle = "#cbd5e1";
      ctx.beginPath();
      ctx.moveTo(headerX, currentY);
      ctx.lineTo(headerX, currentY + headerHeight);
      ctx.stroke();
    }
    headerX += w;
  });

  currentY += headerHeight;

  // 4. Render Table Rows with Heatmap Colors
  rows.forEach((row) => {
    const avgDuration =
      row.avgDurationSeconds !== undefined
        ? row.avgDurationSeconds
        : row.totalCalls > 0
        ? row.totalDurationSeconds / row.totalCalls
        : 0;

    const cells = [
      { text: row.name, bg: "#ffffff", color: "#0f172a", bold: true, align: "left" },
      {
        text: String(row.totalCalls),
        bg: get3ColorScale(row.totalCalls, minCalls, maxCalls),
        color: "#991b1b", // Red text for calls matching spreadsheet
        bold: true,
        align: "right",
      },
      {
        text: String(row.connectedCalls),
        bg: get3ColorScale(row.connectedCalls, minConnected, maxConnected),
        color: "#0f172a",
        bold: false,
        align: "right",
      },
      {
        text: formatDurationHMS(row.totalDurationSeconds),
        bg: get3ColorScale(row.totalDurationSeconds, minDuration, maxDuration),
        color: "#0f172a",
        bold: false,
        align: "right",
      },
      {
        text: formatDurationHMS(avgDuration),
        bg: get3ColorScale(avgDuration, minAvgDur, maxAvgDur),
        color: "#0f172a",
        bold: false,
        align: "right",
      },
    ];

    let cellX = padX;
    cells.forEach((cell, idx) => {
      const w = colWidths[idx];

      // Draw Cell Background with Heatmap Color
      ctx.fillStyle = cell.bg;
      ctx.fillRect(cellX, currentY, w, rowHeight);

      // Draw Grid Border
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX, currentY, w, rowHeight);

      // Draw Cell Text
      ctx.fillStyle = cell.color;
      ctx.font = `${cell.bold ? "bold " : "500 "}12px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = cell.align as CanvasTextAlign;

      const textX = cell.align === "left" ? cellX + 10 : cellX + w - 10;
      ctx.fillText(cell.text, textX, currentY + 21);

      cellX += w;
    });

    currentY += rowHeight;
  });

  // 5. Grand Totals Row
  const totalDurationSum = rows.reduce((s, r) => s + r.totalDurationSeconds, 0);
  const overallAvgDuration = totalCallsAll > 0 ? totalDurationSum / totalCallsAll : 0;

  const totalCells = [
    { text: "Total / Team Avg", bg: "#f8fafc", color: "#0f172a", bold: true, align: "left" },
    { text: String(totalCallsAll), bg: "#f8fafc", color: "#991b1b", bold: true, align: "right" },
    { text: String(totalConnectedAll), bg: "#f8fafc", color: "#0f172a", bold: true, align: "right" },
    { text: formatDurationHMS(totalDurationSum), bg: "#f8fafc", color: "#0f172a", bold: true, align: "right" },
    { text: formatDurationHMS(overallAvgDuration), bg: "#f8fafc", color: "#0f172a", bold: true, align: "right" },
  ];

  let totX = padX;
  totalCells.forEach((c, idx) => {
    const w = colWidths[idx];
    ctx.fillStyle = c.bg;
    ctx.fillRect(totX, currentY, w, totalsRowHeight);

    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(totX, currentY, w, totalsRowHeight);

    ctx.fillStyle = c.color;
    ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
    ctx.textAlign = c.align as CanvasTextAlign;

    const textX = c.align === "left" ? totX + 10 : totX + w - 10;
    ctx.fillText(c.text, textX, currentY + 22);

    totX += w;
  });

  currentY += totalsRowHeight;

  // 6. Footer Branding
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    `Generated by ${brandName} • Executive Performance Report`,
    totalLogicalWidth / 2,
    totalLogicalHeight - 16
  );

  return canvas;
}

/**
 * Triggers native share on mobile/supported browsers with both image + text caption,
 * or downloads image and copies text to clipboard on desktop.
 */
export async function sharePerformanceTable({
  rows,
  dateLabel = "Today",
  brandName = "Hanva CRM",
}: {
  rows: PerformanceTableRow[];
  dateLabel?: string;
  brandName?: string;
}): Promise<boolean> {
  if (!rows || rows.length === 0) {
    toast.error("No telecaller performance data available to share.");
    return false;
  }

  try {
    const canvas = generatePerformanceTableCanvas(rows, { dateLabel, brandName });

    // Format text caption for WhatsApp / sharing
    const totalCallsSum = rows.reduce((s, r) => s + r.totalCalls, 0);
    const totalConnSum = rows.reduce((s, r) => s + r.connectedCalls, 0);
    const totalSecSum = rows.reduce((s, r) => s + r.totalDurationSeconds, 0);
    const connectRate = totalCallsSum > 0 ? Math.round((totalConnSum / totalCallsSum) * 100) : 0;
    const topAgent = rows[0];

    const textCaption = `📊 *${brandName.toUpperCase()} • CALLING PERFORMANCE REPORT*
📅 *Period:* ${dateLabel}
━━━━━━━━━━━━━━━━━━━━━━
📞 *Total Calls:* ${totalCallsSum.toLocaleString()}
⚡ *Connected:* ${totalConnSum.toLocaleString()} (${connectRate}%)
⏱️ *Total Talk Time:* ${formatDurationHMS(totalSecSum)}
👑 *Top Performer:* ${topAgent?.name || "N/A"} (${topAgent?.totalCalls || 0} calls)
━━━━━━━━━━━━━━━━━━━━━━
_Generated via ${brandName}_`;

    return new Promise((resolve) => {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          toast.error("Failed to generate report image.");
          resolve(false);
          return;
        }

        const filename = `Calling_Report_${Date.now()}.png`;
        const file = new File([blob], filename, { type: "image/png" });

        // 1. Try Native Web Share API (Passes both screenshot file AND text data!)
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              title: "Calling Performance Report",
              text: textCaption, // Passes data text alongside the screenshot file!
              files: [file],
            });
            toast.success("Report shared successfully!");
            resolve(true);
            return;
          } catch (err: any) {
            if (err.name === "AbortError") {
              // User dismissed the share dialog
              resolve(false);
              return;
            }
            console.warn("Share API fallback triggering:", err);
          }
        }

        // 2. Fallback for Desktop: Download PNG & Copy Text to Clipboard
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (navigator.clipboard) {
          try {
            await navigator.clipboard.writeText(textCaption);
            toast.success("Screenshot downloaded & summary text copied to clipboard!");
          } catch {
            toast.success("Screenshot downloaded!");
          }
        } else {
          toast.success("Screenshot downloaded!");
        }

        resolve(true);
      }, "image/png");
    });
  } catch (error) {
    console.error("Error generating/sharing performance report:", error);
    toast.error("Could not capture report screenshot.");
    return false;
  }
}
