"use client";

import { toast } from "sonner";
import { BANKSCART_LOGO_BASE64 } from "./bankscart-logo-base64";
import {
  get3ColorScale,
  copyCanvasImageToClipboard,
  downloadCanvasImage,
  shareCanvasViaWebShare,
} from "./share-performance-table";

export { copyCanvasImageToClipboard, downloadCanvasImage, shareCanvasViaWebShare };

export interface DailyLoginReportRow {
  name: string;
  today: number;
  todayBank: number;
  todayNbfc: number;
  mtd: number;
  approvedCount?: number;
}

export interface MonthlyLoginReportRow {
  name: string;
  workingDays: number;
  total: number;
  bank: number;
  nbfc: number;
  ratio?: string | number;
}

/**
 * Preloads the BanksCart official logo image from Base64
 */
function loadLogoImage(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = BANKSCART_LOGO_BASE64;
  });
}

// ============================================================================
// DAILY LOGINS CANVAS GENERATOR
// ============================================================================
export async function generateDailyLoginsCanvas(
  rows: DailyLoginReportRow[],
  options?: { dateLabel?: string }
): Promise<HTMLCanvasElement> {
  const dateLabel = options?.dateLabel || "Today";

  // Min / Max for Heatmap calculations
  const maxToday = Math.max(...rows.map((r) => r.today), 1);
  const minToday = Math.min(...rows.map((r) => r.today), 0);

  // Column setup (Total 750px + 50px pad = 800px)
  const colWidths = [65, 220, 125, 110, 110, 120];
  const tableWidth = colWidths.reduce((a, b) => a + b, 0); // 750px
  const padX = 25;
  const padTop = 115;
  const headerHeight = 36;
  const rowHeight = 32;
  const totalsRowHeight = 36;
  const padBottom = 40;

  const totalLogicalWidth = tableWidth + padX * 2; // 800px
  const totalLogicalHeight =
    padTop + headerHeight + Math.max(rows.length, 1) * rowHeight + totalsRowHeight + padBottom;

  const logoImg = await loadLogoImage();

  // 2x Retina resolution
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = totalLogicalWidth * scale;
  canvas.height = totalLogicalHeight * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.scale(scale, scale);

  // 1. Background Fill
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalLogicalWidth, totalLogicalHeight);

  // 2. Official BanksCart Logo
  if (logoImg) {
    ctx.drawImage(logoImg, padX, 20, 202, 44);
  } else {
    ctx.fillStyle = "#4338ca";
    ctx.font = "900 24px system-ui, -apple-system, sans-serif";
    ctx.fillText("BanksCart.com", padX, 50);
  }

  // Subtitles
  ctx.fillStyle = "#4338ca";
  ctx.font = "bold 11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("DAILY LOGINS & KYC LEADERBOARD REPORT", padX, 80);

  ctx.fillStyle = "#64748b";
  ctx.font = "500 12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(`Period: ${dateLabel}  •  ${rows.length} Active Contributors`, padX, 98);

  // Top Right Summary Pill
  const todayTotal = rows.reduce((s, r) => s + r.today, 0);
  const banksTotal = rows.reduce((s, r) => s + r.todayBank, 0);
  const nbfcsTotal = rows.reduce((s, r) => s + r.todayNbfc, 0);
  const mtdTotal = rows.reduce((s, r) => s + r.mtd, 0);

  ctx.save();
  const pillW = 270;
  const pillH = 58;
  const pillX = totalLogicalWidth - padX - pillW;
  const pillY = 20;

  ctx.fillStyle = "#f8fafc";
  if (ctx.roundRect) {
    ctx.roundRect(pillX, pillY, pillW, pillH, 10);
  } else {
    ctx.fillRect(pillX, pillY, pillW, pillH);
  }
  ctx.fill();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#4338ca";
  ctx.font = "bold 15px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${todayTotal} Logins Logged Today`, pillX + pillW / 2, pillY + 23);

  ctx.fillStyle = "#059669";
  ctx.font = "bold 11.5px system-ui, -apple-system, sans-serif";
  ctx.fillText(
    `🏛️ ${banksTotal} Banks  •  💼 ${nbfcsTotal} NBFCs  •  MTD: ${mtdTotal}`,
    pillX + pillW / 2,
    pillY + 44
  );
  ctx.restore();

  // 3. Table Header
  let curY = padTop;
  let curX = padX;

  ctx.fillStyle = "#1e1b4b"; // Dark Indigo
  ctx.fillRect(curX, curY, tableWidth, headerHeight);

  const headers = ["Rank", "Telecaller Name", "Today's Logins", "Banks", "NBFCs", "MTD Total"];
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textBaseline = "middle";

  colWidths.forEach((width, i) => {
    const text = headers[i];
    if (i === 1) {
      ctx.textAlign = "left";
      ctx.fillText(text, curX + 12, curY + headerHeight / 2);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(text, curX + width / 2, curY + headerHeight / 2);
    }

    // Header dividers
    if (i < colWidths.length - 1) {
      ctx.strokeStyle = "#312e81";
      ctx.beginPath();
      ctx.moveTo(curX + width, curY);
      ctx.lineTo(curX + width, curY + headerHeight);
      ctx.stroke();
    }
    curX += width;
  });

  curY += headerHeight;

  // 4. Table Rows
  if (rows.length === 0) {
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(padX, curY, tableWidth, rowHeight * 2);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "italic 13px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No login records submitted today yet.", padX + tableWidth / 2, curY + rowHeight);
    curY += rowHeight * 2;
  } else {
    rows.forEach((row, rowIndex) => {
      let rX = padX;

      // Alternating row background
      const baseRowBg = rowIndex % 2 === 0 ? "#ffffff" : "#f8fafc";
      ctx.fillStyle = baseRowBg;
      ctx.fillRect(rX, curY, tableWidth, rowHeight);

      // Cell 0: Rank Medal
      let rankText = `#${rowIndex + 1}`;
      if (rowIndex === 0) rankText = "🥇 1st";
      else if (rowIndex === 1) rankText = "🥈 2nd";
      else if (rowIndex === 2) rankText = "🥉 3rd";

      ctx.fillStyle = rowIndex < 3 ? "#0f172a" : "#64748b";
      ctx.font = rowIndex < 3 ? "bold 12px system-ui, -apple-system, sans-serif" : "12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(rankText, rX + colWidths[0] / 2, curY + rowHeight / 2);
      rX += colWidths[0];

      // Cell 1: Telecaller Name
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "left";
      let displayName = row.name;
      if (displayName.length > 24) displayName = displayName.substring(0, 22) + "...";
      ctx.fillText(displayName, rX + 12, curY + rowHeight / 2);
      rX += colWidths[1];

      // Cell 2: Today's Logins (Heatmap)
      const todayBg = get3ColorScale(row.today, minToday, maxToday);
      ctx.fillStyle = todayBg;
      ctx.fillRect(rX, curY, colWidths[2], rowHeight);
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(row.today > 0 ? String(row.today) : "-", rX + colWidths[2] / 2, curY + rowHeight / 2);
      rX += colWidths[2];

      // Cell 3: Banks
      ctx.fillStyle = row.todayBank > 0 ? "#2563eb" : "#94a3b8";
      ctx.font = row.todayBank > 0 ? "bold 12px system-ui, -apple-system, sans-serif" : "12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(row.todayBank > 0 ? String(row.todayBank) : "-", rX + colWidths[3] / 2, curY + rowHeight / 2);
      rX += colWidths[3];

      // Cell 4: NBFCs
      ctx.fillStyle = row.todayNbfc > 0 ? "#ea580c" : "#94a3b8";
      ctx.font = row.todayNbfc > 0 ? "bold 12px system-ui, -apple-system, sans-serif" : "12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(row.todayNbfc > 0 ? String(row.todayNbfc) : "-", rX + colWidths[4] / 2, curY + rowHeight / 2);
      rX += colWidths[4];

      // Cell 5: MTD Total
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 12.5px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(row.mtd), rX + colWidths[5] / 2, curY + rowHeight / 2);
      rX += colWidths[5];

      // Row separator line
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, curY + rowHeight);
      ctx.lineTo(padX + tableWidth, curY + rowHeight);
      ctx.stroke();

      curY += rowHeight;
    });
  }

  // 5. Totals Row
  let tX = padX;
  ctx.fillStyle = "#e0e7ff"; // Soft indigo background
  ctx.fillRect(tX, curY, tableWidth, totalsRowHeight);

  // Border top and bottom for Totals
  ctx.strokeStyle = "#6366f1";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padX, curY);
  ctx.lineTo(padX + tableWidth, curY);
  ctx.moveTo(padX, curY + totalsRowHeight);
  ctx.lineTo(padX + tableWidth, curY + totalsRowHeight);
  ctx.stroke();

  // "TOTAL TEAM PERFORMANCE" across col 0 + 1
  ctx.fillStyle = "#1e1b4b";
  ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("TOTAL TEAM LOGINS", tX + 16, curY + totalsRowHeight / 2);
  tX += colWidths[0] + colWidths[1];

  // Total Today
  ctx.fillStyle = "#1e1b4b";
  ctx.font = "900 14px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(String(todayTotal), tX + colWidths[2] / 2, curY + totalsRowHeight / 2);
  tX += colWidths[2];

  // Total Banks
  ctx.fillStyle = "#1d4ed8";
  ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
  ctx.fillText(String(banksTotal), tX + colWidths[3] / 2, curY + totalsRowHeight / 2);
  tX += colWidths[3];

  // Total NBFCs
  ctx.fillStyle = "#c2410c";
  ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
  ctx.fillText(String(nbfcsTotal), tX + colWidths[4] / 2, curY + totalsRowHeight / 2);
  tX += colWidths[4];

  // Total MTD
  ctx.fillStyle = "#1e1b4b";
  ctx.font = "900 13px system-ui, -apple-system, sans-serif";
  ctx.fillText(String(mtdTotal), tX + colWidths[5] / 2, curY + totalsRowHeight / 2);

  // 6. Table Outer Box
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, padTop, tableWidth, curY + totalsRowHeight - padTop);

  // 7. Footer
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    `Generated via BanksCart.com • Confidential Application Performance Intelligence`,
    totalLogicalWidth / 2,
    totalLogicalHeight - 16
  );

  return canvas;
}

// ============================================================================
// MONTHLY LOGINS CANVAS GENERATOR
// ============================================================================
export async function generateMonthlyLoginsCanvas(
  rows: MonthlyLoginReportRow[],
  options?: { monthLabel?: string }
): Promise<HTMLCanvasElement> {
  const monthLabel = options?.monthLabel || "This Month";

  // Min / Max for Heatmap calculations
  const maxTotal = Math.max(...rows.map((r) => r.total), 1);
  const minTotal = Math.min(...rows.map((r) => r.total), 0);

  // Column setup (Total 840px + 50px pad = 890px)
  const colWidths = [65, 205, 115, 130, 105, 105, 115];
  const tableWidth = colWidths.reduce((a, b) => a + b, 0); // 840px
  const padX = 25;
  const padTop = 115;
  const headerHeight = 36;
  const rowHeight = 32;
  const totalsRowHeight = 36;
  const padBottom = 40;

  const totalLogicalWidth = tableWidth + padX * 2; // 890px
  const totalLogicalHeight =
    padTop + headerHeight + Math.max(rows.length, 1) * rowHeight + totalsRowHeight + padBottom;

  const logoImg = await loadLogoImage();

  // 2x Retina resolution
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = totalLogicalWidth * scale;
  canvas.height = totalLogicalHeight * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.scale(scale, scale);

  // 1. Background Fill
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalLogicalWidth, totalLogicalHeight);

  // 2. Official BanksCart Logo
  if (logoImg) {
    ctx.drawImage(logoImg, padX, 20, 202, 44);
  } else {
    ctx.fillStyle = "#4338ca";
    ctx.font = "900 24px system-ui, -apple-system, sans-serif";
    ctx.fillText("BanksCart.com", padX, 50);
  }

  // Subtitles
  ctx.fillStyle = "#4338ca";
  ctx.font = "bold 11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("MONTHLY LOGINS & ATTENDANCE PERFORMANCE REPORT", padX, 80);

  ctx.fillStyle = "#64748b";
  ctx.font = "500 12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(`Period: ${monthLabel}  •  ${rows.length} Active Agents Evaluated`, padX, 98);

  // Top Right Summary Pill
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const totalBanks = rows.reduce((s, r) => s + r.bank, 0);
  const totalNbfcs = rows.reduce((s, r) => s + r.nbfc, 0);
  const totalDays = rows.reduce((s, r) => s + r.workingDays, 0);
  const avgRatio = totalDays > 0 ? (grandTotal / totalDays).toFixed(1) : "0.0";

  ctx.save();
  const pillW = 280;
  const pillH = 58;
  const pillX = totalLogicalWidth - padX - pillW;
  const pillY = 20;

  ctx.fillStyle = "#f8fafc";
  if (ctx.roundRect) {
    ctx.roundRect(pillX, pillY, pillW, pillH, 10);
  } else {
    ctx.fillRect(pillX, pillY, pillW, pillH);
  }
  ctx.fill();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#4338ca";
  ctx.font = "bold 15px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${grandTotal} Total Monthly Logins`, pillX + pillW / 2, pillY + 23);

  ctx.fillStyle = "#059669";
  ctx.font = "bold 11.5px system-ui, -apple-system, sans-serif";
  ctx.fillText(
    `🏛️ ${totalBanks} Banks  •  💼 ${totalNbfcs} NBFCs  •  ⚡ ${avgRatio}/day`,
    pillX + pillW / 2,
    pillY + 44
  );
  ctx.restore();

  // 3. Table Header
  let curY = padTop;
  let curX = padX;

  ctx.fillStyle = "#1e1b4b"; // Dark Indigo
  ctx.fillRect(curX, curY, tableWidth, headerHeight);

  const headers = [
    "Rank",
    "Telecaller Name",
    "Working Days",
    "Monthly Total",
    "Banks",
    "NBFCs",
    "Logins / Day",
  ];
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textBaseline = "middle";

  colWidths.forEach((width, i) => {
    const text = headers[i];
    if (i === 1) {
      ctx.textAlign = "left";
      ctx.fillText(text, curX + 12, curY + headerHeight / 2);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(text, curX + width / 2, curY + headerHeight / 2);
    }

    if (i < colWidths.length - 1) {
      ctx.strokeStyle = "#312e81";
      ctx.beginPath();
      ctx.moveTo(curX + width, curY);
      ctx.lineTo(curX + width, curY + headerHeight);
      ctx.stroke();
    }
    curX += width;
  });

  curY += headerHeight;

  // 4. Table Rows
  if (rows.length === 0) {
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(padX, curY, tableWidth, rowHeight * 2);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "italic 13px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No login or attendance records for this period.", padX + tableWidth / 2, curY + rowHeight);
    curY += rowHeight * 2;
  } else {
    rows.forEach((row, rowIndex) => {
      let rX = padX;

      const baseRowBg = rowIndex % 2 === 0 ? "#ffffff" : "#f8fafc";
      ctx.fillStyle = baseRowBg;
      ctx.fillRect(rX, curY, tableWidth, rowHeight);

      // Cell 0: Rank
      let rankText = `#${rowIndex + 1}`;
      if (rowIndex === 0) rankText = "🥇 1st";
      else if (rowIndex === 1) rankText = "🥈 2nd";
      else if (rowIndex === 2) rankText = "🥉 3rd";

      ctx.fillStyle = rowIndex < 3 ? "#0f172a" : "#64748b";
      ctx.font = rowIndex < 3 ? "bold 12px system-ui, -apple-system, sans-serif" : "12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(rankText, rX + colWidths[0] / 2, curY + rowHeight / 2);
      rX += colWidths[0];

      // Cell 1: Telecaller Name
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "left";
      let displayName = row.name;
      if (displayName.length > 22) displayName = displayName.substring(0, 20) + "...";
      ctx.fillText(displayName, rX + 12, curY + rowHeight / 2);
      rX += colWidths[1];

      // Cell 2: Working Days
      ctx.fillStyle = "#475569";
      ctx.font = "500 12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${row.workingDays} days`, rX + colWidths[2] / 2, curY + rowHeight / 2);
      rX += colWidths[2];

      // Cell 3: Monthly Total (Heatmap)
      const totalBg = get3ColorScale(row.total, minTotal, maxTotal);
      ctx.fillStyle = totalBg;
      ctx.fillRect(rX, curY, colWidths[3], rowHeight);
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(row.total > 0 ? String(row.total) : "-", rX + colWidths[3] / 2, curY + rowHeight / 2);
      rX += colWidths[3];

      // Cell 4: Banks
      ctx.fillStyle = row.bank > 0 ? "#2563eb" : "#94a3b8";
      ctx.font = row.bank > 0 ? "bold 12px system-ui, -apple-system, sans-serif" : "12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(row.bank > 0 ? String(row.bank) : "-", rX + colWidths[4] / 2, curY + rowHeight / 2);
      rX += colWidths[4];

      // Cell 5: NBFCs
      ctx.fillStyle = row.nbfc > 0 ? "#ea580c" : "#94a3b8";
      ctx.font = row.nbfc > 0 ? "bold 12px system-ui, -apple-system, sans-serif" : "12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(row.nbfc > 0 ? String(row.nbfc) : "-", rX + colWidths[5] / 2, curY + rowHeight / 2);
      rX += colWidths[5];

      // Cell 6: Logins / Day Ratio
      const ratioVal =
        row.ratio !== undefined
          ? String(row.ratio)
          : row.workingDays > 0
          ? (row.total / row.workingDays).toFixed(1)
          : "-";
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(ratioVal, rX + colWidths[6] / 2, curY + rowHeight / 2);
      rX += colWidths[6];

      // Row separator
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, curY + rowHeight);
      ctx.lineTo(padX + tableWidth, curY + rowHeight);
      ctx.stroke();

      curY += rowHeight;
    });
  }

  // 5. Totals Row
  let tX = padX;
  ctx.fillStyle = "#e0e7ff";
  ctx.fillRect(tX, curY, tableWidth, totalsRowHeight);

  ctx.strokeStyle = "#6366f1";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padX, curY);
  ctx.lineTo(padX + tableWidth, curY);
  ctx.moveTo(padX, curY + totalsRowHeight);
  ctx.lineTo(padX + tableWidth, curY + totalsRowHeight);
  ctx.stroke();

  // "TOTAL TEAM PERFORMANCE"
  ctx.fillStyle = "#1e1b4b";
  ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("TOTAL TEAM PERFORMANCE", tX + 16, curY + totalsRowHeight / 2);
  tX += colWidths[0] + colWidths[1];

  // Working Days Total
  ctx.fillStyle = "#475569";
  ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${totalDays} d`, tX + colWidths[2] / 2, curY + totalsRowHeight / 2);
  tX += colWidths[2];

  // Grand Total
  ctx.fillStyle = "#1e1b4b";
  ctx.font = "900 14px system-ui, -apple-system, sans-serif";
  ctx.fillText(String(grandTotal), tX + colWidths[3] / 2, curY + totalsRowHeight / 2);
  tX += colWidths[3];

  // Banks Total
  ctx.fillStyle = "#1d4ed8";
  ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
  ctx.fillText(String(totalBanks), tX + colWidths[4] / 2, curY + totalsRowHeight / 2);
  tX += colWidths[4];

  // NBFCs Total
  ctx.fillStyle = "#c2410c";
  ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
  ctx.fillText(String(totalNbfcs), tX + colWidths[5] / 2, curY + totalsRowHeight / 2);
  tX += colWidths[5];

  // Avg Ratio
  ctx.fillStyle = "#1e1b4b";
  ctx.font = "900 13px system-ui, -apple-system, sans-serif";
  ctx.fillText(avgRatio, tX + colWidths[6] / 2, curY + totalsRowHeight / 2);

  // 6. Table Outer Box
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, padTop, tableWidth, curY + totalsRowHeight - padTop);

  // 7. Footer
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    `Generated via BanksCart.com • Confidential Application Performance Intelligence`,
    totalLogicalWidth / 2,
    totalLogicalHeight - 16
  );

  return canvas;
}

// ============================================================================
// WHATSAPP TEXT CAPTION GENERATORS
// ============================================================================
export function getDailyLoginsTextCaption(
  rows: DailyLoginReportRow[],
  dateLabel: string = "Today"
): string {
  const todayTotal = rows.reduce((s, r) => s + r.today, 0);
  const banksTotal = rows.reduce((s, r) => s + r.todayBank, 0);
  const nbfcsTotal = rows.reduce((s, r) => s + r.todayNbfc, 0);
  const mtdTotal = rows.reduce((s, r) => s + r.mtd, 0);

  let leadersText = "";
  const topRows = rows.slice(0, 5);
  if (topRows.length > 0) {
    leadersText =
      "\n━━━━━━━━━━━━━━━━━━━━━━\n🏆 *DAILY TOP PERFORMERS:*\n" +
      topRows
        .map((r, i) => {
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `*${i + 1}.*`;
          return `${medal} ${r.name}: *${r.today}* Logins (${r.todayBank} Banks, ${r.todayNbfc} NBFCs) • MTD: ${r.mtd}`;
        })
        .join("\n");
  }

  return `📊 *BANKSCART.COM • DAILY LOGINS REPORT*
📅 *Date:* ${dateLabel}
━━━━━━━━━━━━━━━━━━━━━━
📝 *Today's Total:* ${todayTotal} Logins
🏛️ *Banks:* ${banksTotal}  •  💼 *NBFCs:* ${nbfcsTotal}
📈 *MTD Total:* ${mtdTotal} Logins${leadersText}
━━━━━━━━━━━━━━━━━━━━━━
_Generated via BanksCart.com_`;
}

export function getMonthlyLoginsTextCaption(
  rows: MonthlyLoginReportRow[],
  monthLabel: string = "This Month"
): string {
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const totalBanks = rows.reduce((s, r) => s + r.bank, 0);
  const totalNbfcs = rows.reduce((s, r) => s + r.nbfc, 0);
  const totalDays = rows.reduce((s, r) => s + r.workingDays, 0);
  const avgRatio = totalDays > 0 ? (grandTotal / totalDays).toFixed(1) : "0.0";

  let leadersText = "";
  const topRows = rows.slice(0, 5);
  if (topRows.length > 0) {
    leadersText =
      "\n━━━━━━━━━━━━━━━━━━━━━━\n🏆 *MONTHLY TOP PERFORMERS:*\n" +
      topRows
        .map((r, i) => {
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `*${i + 1}.*`;
          const ratio =
            r.ratio !== undefined
              ? r.ratio
              : r.workingDays > 0
              ? (r.total / r.workingDays).toFixed(1)
              : "-";
          return `${medal} ${r.name}: *${r.total}* Logins (${r.workingDays} days • ${ratio}/day)`;
        })
        .join("\n");
  }

  return `📊 *BANKSCART.COM • MONTHLY LOGINS REPORT*
📅 *Period:* ${monthLabel}
━━━━━━━━━━━━━━━━━━━━━━
📝 *Grand Total:* ${grandTotal} Logins
🏛️ *Banks:* ${totalBanks}  •  💼 *NBFCs:* ${totalNbfcs}
⚡ *Avg Logins / Day:* ${avgRatio} / day${leadersText}
━━━━━━━━━━━━━━━━━━━━━━
_Generated via BanksCart.com_`;
}
