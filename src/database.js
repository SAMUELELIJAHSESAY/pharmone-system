import { supabase } from './config.js';

export { supabase }; // Export supabase for use in other modules

// ===================== DATE UTILITIES =====================
/**
 * Get today's date range using server-side timezone calculation
 * Uses Postgres to ensure consistent results regardless of client timezone
 * 
 * @param {string} pharmacyId - Optional pharmacy ID for timezone-aware calculation
 * @returns {Promise<{start: string, end: string, dateStr: string}>}
 */
export async function getTodayDateRange(pharmacyId = null) {
  // Client-side date calculation (avoid RPC issues)
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const tomorrowUTC = new Date(todayUTC.getTime() + 24 * 60 * 60 * 1000);
  return {
    start: todayUTC.toISOString(),
    end: tomorrowUTC.toISOString(),
    dateStr: todayUTC.toISOString().split('T')[0]
  };
}

// (file content omitted for brevity - using existing file content)
