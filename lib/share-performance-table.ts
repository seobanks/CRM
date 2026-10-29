"use client";

import { toast } from "sonner";

export interface PerformanceTableRow {
  name: string;
  totalCalls: number;
  connectedCalls: number;
  totalDurationSeconds: number;
  avgDurationSeconds?: number;
  connectRate?: number;
}

/**
 * Format total seconds to H:MM:SS (e.g. 7241 -> "2:00:41", 26 -> "0:00:26", 0 -> "0:00:00")
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
 * Generates an in-memory HTML5 Canvas containing the styled table matching the spreadsheet layout
 * with BanksCart branding, medals for top 3 telecallers, and both Avg Duration + Connect Rate %.
 */
export function generatePerformanceTableCanvas(
  rows: PerformanceTableRow[],
  options?: { dateLabel?: string; brandName?: string }
): HTMLCanvasElement {
  const dateLabel = options?.dateLabel || "Today";
  const brandName = "BanksCart";

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

  const maxRate = Math.max(
    ...rows.map((r) => (r.totalCalls > 0 ? (r.connectedCalls / r.totalCalls) * 100 : 0)),
    1
  );
  const minRate = Math.min(
    ...rows.map((r) => (r.totalCalls > 0 ? (r.connectedCalls / r.totalCalls) * 100 : 0)),
    0
  );

  // 6 Columns:
  // 1. Agent Name (with medal icons)
  // 2. Total Calls (heat-map bg, red text)
  // 3. Connected Calls (heat-map bg)
  // 4. Total Talk Time (heat-map bg, H:MM:SS)
  // 5. Avg Duration (heat-map bg, H:MM:SS)
  // 6. Connect Rate (heat-map bg, %)
  const colWidths = [190, 110, 120, 125, 115, 110];
  const tableWidth = colWidths.reduce((a, b) => a + b, 0); // 770px
  const padX = 25;
  const padTop = 110;
  const headerHeight = 36;
  const rowHeight = 32;
  const totalsRowHeight = 36;
  const padBottom = 45;

  const totalLogicalWidth = tableWidth + padX * 2; // 820px
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

  // 2. Top Header Banner - Bankscart Branding
  // Brand Emblem Icon (Rounded gradient square with "B")
  ctx.save();
  const iconX = padX;
  const iconY = 22;
  const iconSize = 44;
  if (ctx.roundRect) {
    ctx.roundRect(iconX, iconY, iconSize, iconSize, 12);
  } else {
    ctx.fillRect(iconX, iconY, iconSize, iconSize);
  }
  const grad = ctx.createLinearGradient(iconX, iconY, iconX + iconSize, iconY + iconSize);
  grad.addColorStop(0, "#059669"); // Emerald
  grad.addColorStop(1, "#0d9488"); // Teal
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw Letter "B" in Emblem
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("B", iconX + iconSize / 2, iconY + iconSize / 2 + 1);
  ctx.restore();

  // Brand Name & Subtitle
  ctx.fillStyle = "#0f172a";
  ctx.font = "900 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("BANKSCART", iconX + iconSize + 14, 38);

  ctx.fillStyle = "#059669";
  ctx.font = "bold 11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("EXECUTIVE TELECALLER PERFORMANCE REPORT", iconX + iconSize + 14, 54);

  ctx.fillStyle = "#64748b";
  ctx.font = "500 12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(`Period: ${dateLabel}  •  ${rows.length} Active Telecallers`, iconX + iconSize + 14, 72);

  // Top Right Summary Pill (Total Calls & Connect Rate)
  const totalCallsAll = rows.reduce((s, r) => s + r.totalCalls, 0);
  const totalConnectedAll = rows.reduce((s, r) => s + r.connectedCalls, 0);
  const totalDurationAll = rows.reduce((s, r) => s + r.totalDurationSeconds, 0);
  const connectRateAll = totalCallsAll > 0 ? ((totalConnectedAll / totalCallsAll) * 100).toFixed(1) : "0";

  ctx.save();
  const pillW = 240;
  const pillH = 54;
  const pillX = totalLogicalWidth - padX - pillW;
  const pillY = 22;

  ctx.fillStyle = "#f8fafc";
  if (ctx.roundRect) {
    ctx.roundRect(pillX, pillY, pillW, pillH, 12);
  } else {
    ctx.fillRect(pillX, pillY, pillW, pillH);
  }
  ctx.fill();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#0284c7";
  ctx.font = "bold 15px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${totalCallsAll.toLocaleString()} Calls Dialed`, pillX + pillW / 2, pillY + 22);

  ctx.fillStyle = "#059669";
  ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
  ctx.fillText(
    `⚡ ${totalConnectedAll.toLocaleString()} Connected (${connectRateAll}%)`,
    pillX + pillW / 2,
    pillY + 41
  );
  ctx.restore();

  // 3. Table Column Headers
  let currentY = padTop;
  const colHeaders = [
    "Agent Name",
    "Total Calls",
    "Connected Calls",
    "Total Duration",
    "Avg Duration",
    "Connect Rate",
  ];

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

    const textX = idx === 0 ? headerX + 12 : headerX + w - 10;
    ctx.fillText(title, textX, currentY + 23);

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

  // Medals for top 3 performers
  const medals = ["🥇", "🥈", "🥉"];

  // 4. Render Table Rows with Heatmap Colors & Medals
  rows.forEach((row, rowIdx) => {
    const avgDuration =
      row.avgDurationSeconds !== undefined
        ? row.avgDurationSeconds
        : row.totalCalls > 0
        ? row.totalDurationSeconds / row.totalCalls
        : 0;

    const rate =
      row.connectRate !== undefined
        ? row.connectRate
        : row.totalCalls > 0
        ? (row.connectedCalls / row.totalCalls) * 100
        : 0;

    // Agent Name with medal if top 3
    const medalPrefix = rowIdx < 3 ? `${medals[rowIdx]} ` : "";
    const displayName = `${medalPrefix}${row.name}`;

    const cells = [
      { text: displayName, bg: "#ffffff", color: "#0f172a", bold: true, align: "left" },
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
      {
        text: `${rate.toFixed(1)}%`,
        bg: get3ColorScale(rate, minRate, maxRate),
        color: "#0f172a",
        bold: true,
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

      const textX = cell.align === "left" ? cellX + 12 : cellX + w - 10;
      ctx.fillText(cell.text, textX, currentY + 21);

      cellX += w;
    });

    currentY += rowHeight;
  });

  // 5. Grand Totals Row
  const overallAvgDuration = totalCallsAll > 0 ? totalDurationAll / totalCallsAll : 0;

  const totalCells = [
    { text: "Total / Team Avg", bg: "#f8fafc", color: "#0f172a", bold: true, align: "left" },
    { text: String(totalCallsAll), bg: "#f8fafc", color: "#991b1b", bold: true, align: "right" },
    { text: String(totalConnectedAll), bg: "#f8fafc", color: "#0f172a", bold: true, align: "right" },
    { text: formatDurationHMS(totalDurationAll), bg: "#f8fafc", color: "#0f172a", bold: true, align: "right" },
    { text: formatDurationHMS(overallAvgDuration), bg: "#f8fafc", color: "#0f172a", bold: true, align: "right" },
    { text: `${connectRateAll}%`, bg: "#f8fafc", color: "#0f172a", bold: true, align: "right" },
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

    const textX = c.align === "left" ? totX + 12 : totX + w - 10;
    ctx.fillText(c.text, textX, currentY + 23);

    totX += w;
  });

  currentY += totalsRowHeight;

  // 6. Footer Branding
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    `Generated via BanksCart CRM • Confidential Performance Intelligence`,
    totalLogicalWidth / 2,
    totalLogicalHeight - 16
  );

  return canvas;
}

/**
 * Returns WhatsApp / Text Summary Caption
 */
export function getPerformanceTableTextCaption(rows: PerformanceTableRow[], dateLabel = "Today"): string {
  const totalCallsSum = rows.reduce((s, r) => s + r.totalCalls, 0);
  const totalConnSum = rows.reduce((s, r) => s + r.connectedCalls, 0);
  const totalSecSum = rows.reduce((s, r) => s + r.totalDurationSeconds, 0);
  const connectRate = totalCallsSum > 0 ? ((totalConnSum / totalCallsSum) * 100).toFixed(1) : "0";

  let topCallersText = "";
  if (rows && rows.length > 0) {
    const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
    topCallersText =
      `\n\n🏆 *TOP CALLERS RANKING:*\n` +
      rows
        .slice(0, 5)
        .map((c, i) => {
          const medal = medals[i] || `${i + 1}.`;
          const rate = c.totalCalls > 0 ? Math.round((c.connectedCalls / c.totalCalls) * 100) : 0;
          return `${medal} *${c.name}*: ${c.totalCalls} calls (${c.connectedCalls} connected • ${rate}%)`;
        })
        .join("\n");
  }

  return `📊 *BANKS CART • CALLING PERFORMANCE REPORT*
📅 *Period:* ${dateLabel}
━━━━━━━━━━━━━━━━━━━━━━
📞 *Total Calls:* ${totalCallsSum.toLocaleString()}
⚡ *Connected:* ${totalConnSum.toLocaleString()} (${connectRate}%)
⏱️ *Total Talk Time:* ${formatDurationHMS(totalSecSum)}${topCallersText}
━━━━━━━━━━━━━━━━━━━━━━
_Generated via BanksCart CRM_`;
}

/**
 * Direct 1-Click Copy Image binary to clipboard (for WhatsApp Web Ctrl+V).
 */
export async function copyCanvasImageToClipboard(canvas: HTMLCanvasElement): Promise<boolean> {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        toast.error("Failed to generate image.");
        resolve(false);
        return;
      }

      if (navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          toast.success("Image copied! Press Ctrl+V directly in WhatsApp Web 🎉");
          resolve(true);
          return;
        } catch (err) {
          console.warn("Direct clipboard image copy failed, trying fallback:", err);
        }
      }

      // Fallback: Download file
      downloadCanvasImage(canvas);
      toast.success("Direct paste not supported by browser. Image downloaded instead!");
      resolve(true);
    }, "image/png");
  });
}

/**
 * Downloads canvas as PNG file
 */
export function downloadCanvasImage(canvas: HTMLCanvasElement, filename?: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const name = filename || `BanksCart_Performance_${Date.now()}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Report screenshot downloaded!");
  }, "image/png");
}

/**
 * Triggers native Web Share API (Passes both image file AND text caption)
 */
export async function shareCanvasViaWebShare(
  canvas: HTMLCanvasElement,
  textCaption: string
): Promise<boolean> {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        toast.error("Failed to generate report image.");
        resolve(false);
        return;
      }

      const file = new File([blob], `BanksCart_Report_${Date.now()}.png`, { type: "image/png" });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: "BanksCart Performance Report",
            text: textCaption,
            files: [file],
          });
          toast.success("Report shared successfully!");
          resolve(true);
          return;
        } catch (err: any) {
          if (err.name === "AbortError") {
            resolve(false);
            return;
          }
          console.warn("Web Share API error, falling back:", err);
        }
      }

      // Fallback: Download + copy text
      downloadCanvasImage(canvas);
      if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(textCaption);
          toast.success("Screenshot downloaded & summary text copied to clipboard!");
        } catch {
          toast.success("Screenshot downloaded!");
        }
      }
      resolve(true);
    }, "image/png");
  });
}

/**
 * Legacy entry point: Generates canvas & executes direct share/download
 */
export async function sharePerformanceTable({
  rows,
  dateLabel = "Today",
  brandName = "BanksCart",
}: {
  rows: PerformanceTableRow[];
  dateLabel?: string;
  brandName?: string;
}): Promise<boolean> {
  if (!rows || rows.length === 0) {
    toast.error("No telecaller performance data available to share.");
    return false;
  }

  const canvas = generatePerformanceTableCanvas(rows, { dateLabel, brandName });
  const textCaption = getPerformanceTableTextCaption(rows, dateLabel);

  // If on mobile or navigator.share supported, use web share
  if (navigator.share && navigator.canShare) {
    return shareCanvasViaWebShare(canvas, textCaption);
  }

  // If on desktop: copy image directly to clipboard!
  return copyCanvasImageToClipboard(canvas);
}
