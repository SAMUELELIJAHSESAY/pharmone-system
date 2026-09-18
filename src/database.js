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

/**
 * Get week date range using server-side timezone calculation
 * Calculates Monday to Sunday of the current week
 * 
 * @param {string} pharmacyId - Optional pharmacy ID for timezone-aware calculation
 * @returns {Promise<{start: string, end: string}>}
 */
export async function getWeekDateRange(pharmacyId = null) {
  // Client-side: Get Monday to Sunday of current week (resets on Monday)
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  
  // Calculate Monday of the current week
  const dayOfWeek = todayUTC.getUTCDay(); // 0=Sunday, 1=Monday, etc.
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 0=Sunday go back 6, 1=Monday go back 0
  
  const weekStartUTC = new Date(todayUTC);
  weekStartUTC.setUTCDate(todayUTC.getUTCDate() - daysToMonday);
  weekStartUTC.setUTCHours(0, 0, 0, 0);
  
  // Calculate Sunday of the current week (6 days after Monday)
  const weekEndUTC = new Date(weekStartUTC);
  weekEndUTC.setUTCDate(weekStartUTC.getUTCDate() + 7); // End at start of next Monday
  weekEndUTC.setUTCHours(0, 0, 0, 0);
  
  return {
    start: weekStartUTC.toISOString(),
    end: weekEndUTC.toISOString()
  };
}

/**
 * Get month date range using server-side timezone calculation
 * 
 * @param {string} pharmacyId - Optional pharmacy ID for timezone-aware calculation
 * @returns {Promise<{start: string, end: string}>}
 */
export async function getMonthDateRange(pharmacyId = null) {
  // Client-side: Get current month (avoid RPC 400 error)
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const monthStartUTC = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const tomorrowUTC = new Date(Date.UTC(year, month, new Date(Date.UTC(year, month + 1, 0)).getUTCDate() + 1, 0, 0, 0, 0));
  return {
    start: monthStartUTC.toISOString(),
    end: tomorrowUTC.toISOString()
  };
}

/**
 * Get year date range using server-side timezone calculation
 * 
 * @param {string} pharmacyId - Optional pharmacy ID for timezone-aware calculation
 * @returns {Promise<{start: string, end: string}>}
 */
export async function getYearDateRange(pharmacyId = null) {
  // Client-side: Get current year (avoid RPC 400 error)
  const now = new Date();
  const year = now.getUTCFullYear();
  const yearStartUTC = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const yearEndUTC = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  return {
    start: yearStartUTC.toISOString(),
    end: yearEndUTC.toISOString()
  };
}

// ===================== PHARMACIES =====================
export async function getPharmacies() {
  const { data, error } = await supabase.from('pharmacies').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createPharmacy(payload) {
  const { data, error } = await supabase.from('pharmacies').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updatePharmacy(id, payload) {
  const { data, error } = await supabase.from('pharmacies').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ===================== PHARMACY SETTINGS =====================
export async function getPharmacySettings(pharmacyId) {
  const enhancedSelect = 'id, name, branding_color, currency_code, currency_symbol, timezone, tax_enabled, tax_rate, discount_enabled, discount_rules, logo_url, module_features, operational_settings, updated_at';
  let { data, error } = await supabase
    .from('pharmacies')
    .select(enhancedSelect)
    .eq('id', pharmacyId)
    .single();

  // Keep deployments usable while the optional Settings Center migration is
  // being applied. Older schemas simply fall back to the legacy settings fields.
  if (error && (error.code === '42703' || /module_features|operational_settings/i.test(error.message || ''))) {
    const legacy = await supabase
      .from('pharmacies')
      .select('id, name, branding_color, currency_code, currency_symbol, timezone, tax_enabled, tax_rate, discount_enabled, discount_rules, logo_url, updated_at')
      .eq('id', pharmacyId)
      .single();
    data = legacy.data;
    error = legacy.error;
  }

  if (error) {
    console.error('Error fetching pharmacy settings:', error);
    throw error;
  }
  return {
    ...(data || {}),
    module_features: data?.module_features || null,
    operational_settings: data?.operational_settings || null
  };
}

export async function uploadPharmacyLogo(pharmacyId, file) {
  if (!pharmacyId) throw new Error('Pharmacy ID is required');
  if (!file) throw new Error('Choose a logo file first');

  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowedTypes.includes(file.type)) throw new Error('Logo must be a PNG, JPG, or WebP image.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Logo must be 2 MB or smaller.');

  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const objectPath = `${pharmacyId}/logo-${Date.now()}.${extension}`;
  const { error } = await supabase.storage
    .from('pharmacy-branding')
    .upload(objectPath, file, { cacheControl: '3600', upsert: false, contentType: file.type });
  if (error) throw new Error(`Logo upload failed: ${error.message}`);

  const { data } = supabase.storage.from('pharmacy-branding').getPublicUrl(objectPath);
  return { path: objectPath, url: data?.publicUrl || '' };
}

export async function removePharmacyLogo(logoUrlOrPath) {
  const value = String(logoUrlOrPath || '').trim();
  if (!value) return;
  const marker = '/storage/v1/object/public/pharmacy-branding/';
  let objectPath = value;
  if (value.includes(marker)) objectPath = decodeURIComponent(value.split(marker)[1] || '');
  if (!objectPath || objectPath.includes('://')) return;
  const { error } = await supabase.storage.from('pharmacy-branding').remove([objectPath]);
  if (error) console.warn('Failed to remove old pharmacy logo:', error.message);
}

export async function updateAdminPharmacyBranding(pharmacyId, settings, note = '') {
  if (!pharmacyId) throw new Error('Pharmacy is required.');
  const { data, error } = await supabase.rpc('update_pharmacy_branding', {
    p_pharmacy_id: pharmacyId,
    p_settings: settings || {},
    p_note: String(note || '').trim() || null
  });
  if (error) {
    if (['PGRST202', '42883'].includes(error.code) || /update_pharmacy_branding/i.test(error.message || '')) {
      throw new Error('Apply the Pharmacy Branding migration before saving branding settings.');
    }
    throw error;
  }
  return data;
}

export async function updatePharmacySettings(pharmacyId, settings) {
  // Validate required fields
  if (!pharmacyId) throw new Error('Pharmacy ID is required');
  if (!settings) throw new Error('Settings object is required');

  const updatePayload = {
    branding_color: settings.branding_color || '#1976d2',
    currency_code: settings.currency_code || 'USD',
    currency_symbol: settings.currency_symbol || '$',
    tax_enabled: Boolean(settings.tax_enabled),
    tax_rate: parseFloat(settings.tax_rate) || 0,
    discount_enabled: Boolean(settings.discount_enabled),
    discount_rules: settings.discount_rules || { max_discount: 10, min_cart_amount: 0 },
    logo_url: settings.logo_url || '',
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('pharmacies')
    .update(updatePayload)
    .eq('id', pharmacyId)
    .select()
    .single();

  if (error) {
    console.error('Error updating pharmacy settings:', {
      pharmacyId,
      error: error.message,
      details: error.details,
      hint: error.hint
    });
    throw new Error(`Failed to update settings: ${error.message}`);
  }

  return data;
}


const SUPER_ADMIN_DEFAULT_MODULE_FEATURES = Object.freeze({
  inventory: true,
  sales: true,
  customers: true,
  patients: true,
  suppliers: true,
  purchases: true,
  returns: true,
  alerts: true,
  stock_transfers: true,
  staff: true,
  branches: true,
  expenses: true,
  reports: true,
  sales_reports: true,
  daily_records: true
});

function fallbackPlatformSettings() {
  return {
    settings: {
      branding_color: '#2563eb',
      currency_code: 'NLE',
      currency_symbol: 'Le',
      timezone: 'Africa/Freetown',
      tax_enabled: false,
      tax_rate: 0,
      discount_enabled: true,
      discount_rules: { max_discount: 10, min_cart_amount: 0 },
      default_low_stock_threshold: 5,
      receipt_footer: 'Thank you for choosing {branch_name}.',
      module_features: { ...SUPER_ADMIN_DEFAULT_MODULE_FEATURES },
      updated_at: null
    },
    summary: {
      total_pharmacies: 0,
      tax_enabled_pharmacies: 0,
      custom_branding_pharmacies: 0,
      restricted_pharmacies: 0
    },
    migrationRequired: true
  };
}

function isMissingSettingsRpc(error) {
  return ['PGRST202', '42883', '42P01', '42703'].includes(error?.code) ||
    /function .* does not exist|platform_settings|module_features|operational_settings/i.test(error?.message || '');
}

/** Load platform-wide defaults and summary counts for the Super Admin Settings center. */
export async function getSuperAdminPlatformSettings() {
  const { data, error } = await supabase.rpc('get_super_admin_platform_settings');
  if (error) {
    if (isMissingSettingsRpc(error)) {
      console.warn('[settings] Settings-center migration is not applied yet:', error.message);
      return fallbackPlatformSettings();
    }
    throw error;
  }
  return { ...(data || fallbackPlatformSettings()), migrationRequired: false };
}

/** Persist platform defaults through a guarded SECURITY DEFINER RPC. */
export async function updateSuperAdminPlatformSettings(settings, note = '') {
  const { data, error } = await supabase.rpc('super_admin_update_platform_settings', {
    p_settings: settings || {},
    p_note: String(note || '').trim() || null
  });
  if (error) {
    if (isMissingSettingsRpc(error)) throw new Error('Apply the Super Admin Settings migration before saving platform defaults.');
    throw error;
  }
  return data;
}

/** Load one pharmacy configuration together with platform defaults and recent changes. */
export async function getSuperAdminPharmacyConfiguration(pharmacyId) {
  if (!pharmacyId) throw new Error('Pharmacy is required.');
  const { data, error } = await supabase.rpc('get_super_admin_pharmacy_configuration', {
    p_pharmacy_id: pharmacyId
  });
  if (error) {
    if (isMissingSettingsRpc(error)) {
      const settings = await getPharmacySettings(pharmacyId);
      return {
        pharmacy: {
          ...settings,
          module_features: { ...SUPER_ADMIN_DEFAULT_MODULE_FEATURES, ...(settings?.module_features || {}) },
          operational_settings: {
            default_low_stock_threshold: 5,
            receipt_footer: 'Thank you for choosing {branch_name}.',
            ...(settings?.operational_settings || {})
          }
        },
        platform_defaults: fallbackPlatformSettings().settings,
        recent_changes: [],
        migrationRequired: true
      };
    }
    throw error;
  }
  return { ...(data || {}), migrationRequired: false };
}

/** Update selected pharmacy overrides / module availability with an audit record. */
export async function updateSuperAdminPharmacyConfiguration(pharmacyId, settings, note = '', section = 'pharmacy_overrides') {
  const { data, error } = await supabase.rpc('super_admin_update_pharmacy_configuration', {
    p_pharmacy_id: pharmacyId,
    p_settings: settings || {},
    p_note: String(note || '').trim() || null,
    p_section: section || 'pharmacy_overrides'
  });
  if (error) {
    if (isMissingSettingsRpc(error)) throw new Error('Apply the Super Admin Settings migration before saving pharmacy configuration.');
    throw error;
  }
  return data;
}

/** Reset a pharmacy financial/display/module defaults to the current platform defaults. */
export async function resetSuperAdminPharmacyConfiguration(pharmacyId, note = '') {
  const { data, error } = await supabase.rpc('super_admin_reset_pharmacy_configuration', {
    p_pharmacy_id: pharmacyId,
    p_note: String(note || '').trim() || null
  });
  if (error) {
    if (isMissingSettingsRpc(error)) throw new Error('Apply the Super Admin Settings migration before resetting pharmacy configuration.');
    throw error;
  }
  return data;
}

/** Server-paged settings audit history. */
export async function getSuperAdminSettingsAuditPage({
  page = 1,
  pageSize = 30,
  scope = 'all',
  pharmacyId = null
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = [25, 30, 50].includes(Number(pageSize)) ? Number(pageSize) : 30;
  const { data, error } = await supabase.rpc('get_super_admin_settings_audit_page', {
    p_page: safePage,
    p_page_size: safeSize,
    p_scope: scope || 'all',
    p_pharmacy_id: pharmacyId || null
  });
  if (error) {
    if (isMissingSettingsRpc(error)) {
      return { rows: [], count: 0, page: 1, page_size: safeSize, page_count: 1, migrationRequired: true };
    }
    throw error;
  }
  return { ...(data || {}), migrationRequired: false };
}

// ===================== PROFILES =====================
export async function getProfiles(pharmacyId = null) {
  let query = supabase.from('profiles').select('*, pharmacies(*)').order('created_at', { ascending: false });
  if (pharmacyId) query = query.eq('pharmacy_id', pharmacyId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function updateProfile(id, payload) {
  const { data, error } = await supabase.from('profiles').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}


function normalizePlatformUserStatus(profile = {}) {
  if (profile.account_status === 'locked') return 'locked';
  if (profile.account_status === 'disabled' || profile.is_active === false) return 'disabled';
  return 'active';
}

/**
 * Server-side Super Admin user directory. The RPC enriches each visible row
 * with Auth last-sign-in information and active branch assignments without
 * downloading the entire platform directory into the browser.
 */
export async function getSuperAdminUsersPage({
  page = 1,
  pageSize = 30,
  search = '',
  role = '',
  status = 'all',
  pharmacyId = null,
  branchId = null
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = [25, 30, 50].includes(Number(pageSize)) ? Number(pageSize) : 30;
  const { data, error } = await supabase.rpc('get_super_admin_users_page', {
    p_page: safePage,
    p_page_size: safeSize,
    p_search: String(search || '').trim().slice(0, 100),
    p_role: role || null,
    p_status: status || 'all',
    p_pharmacy_id: pharmacyId || null,
    p_branch_id: branchId || null
  });

  if (!error && data) {
    return {
      rows: data.rows || [],
      count: Number(data.count || 0),
      page: Number(data.page || safePage),
      pageSize: Number(data.page_size || safeSize),
      pageCount: Math.max(1, Number(data.page_count || 1)),
      usingFallback: false
    };
  }

  const missingRpc = error && (error.code === 'PGRST202' || /get_super_admin_users_page/i.test(error.message || ''));
  if (error && !missingRpc) throw error;

  console.warn('Super Admin user-management RPC is unavailable; using compatibility queries. Apply the latest Supabase migration for Auth activity and account locking.');
  const from = (safePage - 1) * safeSize;
  const to = from + safeSize - 1;
  const term = String(search || '').trim().replace(/[%_(),\\"']/g, ' ').replace(/\s+/g, ' ').slice(0, 80);

  let branchUserIds = null;
  if (branchId) {
    const { data: assignments, error: assignmentError } = await supabase
      .from('staff_branch_assignments').select('staff_id').eq('branch_id', branchId).eq('is_active', true);
    if (assignmentError) throw assignmentError;
    branchUserIds = [...new Set((assignments || []).map(row => row.staff_id).filter(Boolean))];
    if (!branchUserIds.length) return { rows: [], count: 0, page: 1, pageSize: safeSize, pageCount: 1, usingFallback: true };
  }

  let query = supabase
    .from('profiles')
    .select('id,full_name,email,role,pharmacy_id,is_active,created_at,pharmacies(id,name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
  if (role) query = query.eq('role', role);
  if (pharmacyId) query = query.eq('pharmacy_id', pharmacyId);
  if (status === 'active') query = query.eq('is_active', true);
  if (status === 'disabled' || status === 'locked') query = query.eq('is_active', false);
  if (branchUserIds) query = query.in('id', branchUserIds);

  const { data: rows, error: pageError, count } = await query;
  if (pageError) throw pageError;
  const ids = (rows || []).map(row => row.id);
  let assignments = [];
  if (ids.length) {
    const { data: assignmentRows, error: assignmentError } = await supabase
      .from('staff_branch_assignments')
      .select('staff_id,role_in_branch,branches(id,name)')
      .in('staff_id', ids)
      .eq('is_active', true);
    if (!assignmentError) assignments = assignmentRows || [];
  }
  const byUser = new Map();
  assignments.forEach(row => {
    const list = byUser.get(row.staff_id) || [];
    list.push({ branch_id: row.branches?.id, branch_name: row.branches?.name, role_in_branch: row.role_in_branch });
    byUser.set(row.staff_id, list);
  });
  return {
    rows: (rows || []).map(row => ({
      ...row,
      pharmacy_name: row.pharmacies?.name || null,
      account_status: row.is_active === false ? 'disabled' : 'active',
      branch_assignments: byUser.get(row.id) || [],
      last_sign_in_at: null,
      last_activity_at: null
    })),
    count: Number(count || 0),
    page: safePage,
    pageSize: safeSize,
    pageCount: Math.max(1, Math.ceil(Number(count || 0) / safeSize)),
    usingFallback: true
  };
}

export async function getSuperAdminUserSummary() {
  const count = async (apply) => {
    let query = supabase.from('profiles').select('id', { count: 'exact', head: true });
    query = apply ? apply(query) : query;
    const { count: total, error } = await query;
    if (error) throw error;
    return Number(total || 0);
  };
  const [total, active, disabled, superAdmins] = await Promise.all([
    count(),
    count(q => q.eq('is_active', true)),
    count(q => q.eq('is_active', false)),
    count(q => q.eq('role', 'super_admin'))
  ]);
  return { total, active, disabled, superAdmins };
}

export async function getSuperAdminUserFilterOptions() {
  const [pharmaciesResult, branchesResult] = await Promise.all([
    supabase.from('pharmacies').select('id,name,is_active').order('name'),
    supabase.from('branches').select('id,name,pharmacy_id,is_active').order('name')
  ]);
  if (pharmaciesResult.error) throw pharmaciesResult.error;
  if (branchesResult.error) throw branchesResult.error;
  return { pharmacies: pharmaciesResult.data || [], branches: branchesResult.data || [] };
}

export async function getSuperAdminUserDetail(userId) {
  const { data, error } = await supabase.rpc('get_super_admin_user_detail', { p_user_id: userId });
  if (!error && data) return { ...data, usingFallback: false };
  const missingRpc = error && (error.code === 'PGRST202' || /get_super_admin_user_detail/i.test(error.message || ''));
  if (error && !missingRpc) throw error;

  const [profileResult, assignmentsResult, salesResult] = await Promise.all([
    supabase.from('profiles').select('*,pharmacies(id,name)').eq('id', userId).single(),
    supabase.from('staff_branch_assignments').select('branch_id,role_in_branch,assigned_date,branches(id,name)').eq('staff_id', userId).eq('is_active', true),
    supabase.from('sales').select('id,total_amount,created_at').eq('created_by', userId).eq('status', 'completed').order('created_at', { ascending: false }).limit(1000)
  ]);
  if (profileResult.error) throw profileResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;
  if (salesResult.error) throw salesResult.error;
  const profile = profileResult.data;
  const sales = salesResult.data || [];
  return {
    profile: {
      ...profile,
      pharmacy_name: profile.pharmacies?.name || null,
      account_status: normalizePlatformUserStatus(profile)
    },
    security: { last_sign_in_at: null, email_confirmed_at: null, auth_created_at: profile.created_at, phone: null },
    branches: (assignmentsResult.data || []).map(row => ({ branch_id: row.branch_id, branch_name: row.branches?.name, role_in_branch: row.role_in_branch, assigned_date: row.assigned_date })),
    sales: {
      transactions: sales.length,
      total_sales: sales.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
      last_sale_at: sales[0]?.created_at || null
    },
    audit: [],
    usingFallback: true
  };
}

export async function setSuperAdminUserAccountState(userId, status, reason = '') {
  const { error } = await supabase.rpc('super_admin_set_user_account_state', {
    p_target_user: userId,
    p_status: status,
    p_reason: reason || null
  });
  if (error) throw error;
}

export async function changeSuperAdminUserRole(userId, role, reason = '') {
  const { error } = await supabase.rpc('super_admin_change_user_role', {
    p_target_user: userId,
    p_role: role,
    p_reason: reason || null
  });
  if (error) throw error;
}

export async function revokeSuperAdminUserSessions(userId, reason = '') {
  const { data, error } = await supabase.rpc('super_admin_revoke_user_sessions', {
    p_target_user: userId,
    p_reason: reason || null
  });
  if (error) throw error;
  return Number(data || 0);
}

/**
 * Load one page of pharmacy staff directly from Supabase. Branch filtering is
 * resolved through staff_branch_assignments first, then only the visible profile
 * rows are requested. This prevents the Staff page from downloading the entire
 * team directory as the pharmacy grows.
 */
export async function getStaffPage(pharmacyId, {
  page = 1,
  pageSize = 30,
  search = '',
  role = '',
  status = 'all',
  branchId = null
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 30));
  const normalizedSearch = String(search || '').trim().replace(/[,%()]/g, ' ').replace(/\s+/g, ' ');

  let branchStaffIds = null;
  if (branchId) {
    const { data: branchAssignments, error: assignmentError } = await supabase
      .from('staff_branch_assignments')
      .select('staff_id')
      .eq('pharmacy_id', pharmacyId)
      .eq('branch_id', branchId)
      .eq('is_active', true);
    if (assignmentError) throw assignmentError;
    branchStaffIds = [...new Set((branchAssignments || []).map(row => row.staff_id).filter(Boolean))];
    if (!branchStaffIds.length) {
      return { data: [], total: 0, page: 1, pageSize: safePageSize, totalPages: 1 };
    }
  }

  let query = supabase
    .from('profiles')
    .select('id,full_name,email,role,is_active,created_at,pharmacy_id', { count: 'exact' })
    .eq('pharmacy_id', pharmacyId)
    .neq('role', 'super_admin');

  if (normalizedSearch) {
    const pattern = `%${normalizedSearch}%`;
    query = query.or(`full_name.ilike.${pattern},email.ilike.${pattern}`);
  }
  if (role) query = query.eq('role', role);
  if (status === 'active') query = query.eq('is_active', true);
  if (status === 'inactive') query = query.eq('is_active', false);
  if (branchStaffIds) query = query.in('id', branchStaffIds);

  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;
  const { data, error, count } = await query
    .order('full_name', { ascending: true, nullsFirst: false })
    .range(from, to);
  if (error) throw error;

  const profiles = data || [];
  const staffIds = profiles.map(row => row.id);
  let assignments = [];
  if (staffIds.length) {
    const { data: assignmentRows, error: assignmentError } = await supabase
      .from('staff_branch_assignments')
      .select('id,staff_id,branch_id,role_in_branch,assigned_date,is_active')
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true)
      .in('staff_id', staffIds);
    if (assignmentError) throw assignmentError;
    assignments = assignmentRows || [];
  }

  const branchIds = [...new Set(assignments.map(row => row.branch_id).filter(Boolean))];
  let branchMap = new Map();
  if (branchIds.length) {
    const { data: branches, error: branchError } = await supabase
      .from('branches')
      .select('id,name')
      .eq('pharmacy_id', pharmacyId)
      .in('id', branchIds);
    if (branchError) throw branchError;
    branchMap = new Map((branches || []).map(branch => [branch.id, branch.name]));
  }

  const assignmentsByStaff = new Map();
  assignments.forEach(assignment => {
    const list = assignmentsByStaff.get(assignment.staff_id) || [];
    list.push({
      ...assignment,
      branch_name: branchMap.get(assignment.branch_id) || 'Unknown branch'
    });
    assignmentsByStaff.set(assignment.staff_id, list);
  });

  const enriched = profiles.map(profile => ({
    ...profile,
    branch_assignments: assignmentsByStaff.get(profile.id) || []
  }));
  const total = Number(count || 0);
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));

  return { data: enriched, total, page: Math.min(safePage, totalPages), pageSize: safePageSize, totalPages };
}

export async function getStaffSummary(pharmacyId) {
  const base = () => supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('pharmacy_id', pharmacyId)
    .neq('role', 'super_admin');

  const [totalResult, activeResult, salesmanResult, inventoryResult] = await Promise.all([
    base(),
    base().eq('is_active', true),
    base().eq('role', 'salesman'),
    base().eq('role', 'inventory_manager')
  ]);

  for (const result of [totalResult, activeResult, salesmanResult, inventoryResult]) {
    if (result.error) throw result.error;
  }

  return {
    total: Number(totalResult.count || 0),
    active: Number(activeResult.count || 0),
    salesmen: Number(salesmanResult.count || 0),
    inventoryManagers: Number(inventoryResult.count || 0)
  };
}

/**
 * Build an employee sales summary for a selected period. Sales are read in
 * database pages by getSalesForReport so the profile modal stays complete even
 * when the employee has more than the default Supabase row limit.
 */
export async function getStaffSalesAnalytics(pharmacyId, staffId, {
  branchId = null,
  start = null,
  end = null
} = {}) {
  const sales = await getSalesForReport(pharmacyId, { branchId, staffId, start, end });
  const dailyMap = new Map();
  const paymentBreakdown = {};
  let totalRevenue = 0;

  for (const sale of sales) {
    const amount = Number(sale.total_amount || 0);
    totalRevenue += amount;
    const method = sale.payment_method || 'other';
    paymentBreakdown[method] = (paymentBreakdown[method] || 0) + amount;

    const date = new Date(sale.created_at).toISOString().slice(0, 10);
    const row = dailyMap.get(date) || { date, transactions: 0, total: 0 };
    row.transactions += 1;
    row.total += amount;
    dailyMap.set(date, row);
  }

  const daily = [...dailyMap.values()].sort((a, b) => b.date.localeCompare(a.date));
  const bestDay = daily.reduce((best, row) => (!best || row.total > best.total ? row : best), null);
  const lastSale = sales.length ? sales[sales.length - 1].created_at : null;

  return {
    totalRevenue,
    transactions: sales.length,
    averageSale: sales.length ? totalRevenue / sales.length : 0,
    activeDays: daily.length,
    bestDay,
    lastSale,
    paymentBreakdown,
    daily
  };
}


// ===================== GLOBAL ADMIN SEARCH =====================
/**
 * Search the current pharmacy workspace without loading full module datasets.
 * Each query is explicitly scoped to pharmacy_id (and branch_id where the table
 * supports it), then RLS provides the final database-side access boundary.
 */
export async function searchAdminWorkspace(pharmacyId, searchTerm, { branchId = null, limitPerType = 5 } = {}) {
  const normalized = String(searchTerm || '')
    .trim()
    .replace(/[%_(),\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80);

  if (!pharmacyId || normalized.length < 2) {
    return {
      products: [], customers: [], patients: [], sales: [],
      suppliers: [], purchases: [], staff: [], branches: []
    };
  }

  const pattern = `%${normalized}%`;
  const safe = async (label, buildQuery) => {
    try {
      const { data, error } = await buildQuery();
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.warn(`[global search] ${label} query failed:`, error);
      return [];
    }
  };

  const productQuery = () => {
    let query = supabase
      .from('products')
      .select('id,name,category,price,stock_boxes,stock_units,units_per_box,branch_id,expiry_date')
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true)
      .or(`name.ilike.${pattern},category.ilike.${pattern}`)
      .order('name', { ascending: true })
      .limit(limitPerType);
    if (branchId) query = query.eq('branch_id', branchId);
    return query;
  };

  const customerQuery = () => supabase
    .from('customers')
    .select('id,name,phone,email,address,created_at')
    .eq('pharmacy_id', pharmacyId)
    .or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
    .order('name', { ascending: true })
    .limit(limitPerType);

  const patientQuery = () => {
    let query = supabase
      .from('patients')
      .select('id,name,phone,email,patient_id_number,branch_id')
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true)
      .or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern},patient_id_number.ilike.${pattern}`)
      .order('name', { ascending: true })
      .limit(limitPerType);
    if (branchId) query = query.eq('branch_id', branchId);
    return query;
  };

  const salesQuery = () => {
    let query = supabase
      .from('sales')
      .select('id,invoice_number,total_amount,payment_method,status,branch_id,created_at')
      .eq('pharmacy_id', pharmacyId)
      .ilike('invoice_number', pattern)
      .order('created_at', { ascending: false })
      .limit(limitPerType);
    if (branchId) query = query.eq('branch_id', branchId);
    return query;
  };

  const supplierQuery = () => supabase
    .from('suppliers')
    .select('id,name,contact_person,phone,email')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .or(`name.ilike.${pattern},contact_person.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
    .order('name', { ascending: true })
    .limit(limitPerType);

  const purchaseQuery = () => supabase
    .from('purchases')
    .select('id,purchase_number,total_cost,payment_status,supplier_id,created_at')
    .eq('pharmacy_id', pharmacyId)
    .ilike('purchase_number', pattern)
    .order('created_at', { ascending: false })
    .limit(limitPerType);

  const staffQuery = () => supabase
    .from('profiles')
    .select('id,full_name,email,role,is_active')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .neq('role', 'super_admin')
    .or(`full_name.ilike.${pattern},email.ilike.${pattern},role.ilike.${pattern}`)
    .order('full_name', { ascending: true })
    .limit(limitPerType);

  const branchQuery = () => {
    let query = supabase
      .from('branches')
      .select('id,name,address,is_active')
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true)
      .or(`name.ilike.${pattern},address.ilike.${pattern}`)
      .order('name', { ascending: true })
      .limit(limitPerType);
    if (branchId) query = query.eq('id', branchId);
    return query;
  };

  const [products, customers, patients, sales, suppliers, purchases, staff, branches] = await Promise.all([
    safe('products', productQuery),
    safe('customers', customerQuery),
    safe('patients', patientQuery),
    safe('sales', salesQuery),
    safe('suppliers', supplierQuery),
    safe('purchases', purchaseQuery),
    safe('staff', staffQuery),
    safe('branches', branchQuery)
  ]);

  return { products, customers, patients, sales, suppliers, purchases, staff, branches };
}

// ===================== PRODUCTS =====================
export async function getProducts(pharmacyId, branchId = null) {
  let query = supabase
    .from('products')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);
    
  if (branchId) {
    query = query.eq('branch_id', branchId);
  }
  
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data;
}


/**
 * Load a single inventory page directly from Supabase instead of downloading
 * the whole product catalogue into the browser.
 */
export async function getProductsPage(pharmacyId, options = {}) {
  const {
    branchId = null,
    page = 1,
    pageSize = 30,
    search = '',
    category = '',
    filterType = '',
    sortType = ''
  } = options;

  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 30));
  const normalizedSearch = String(search || '').trim().replace(/[,%()]/g, ' ').replace(/\s+/g, ' ');
  const normalizedFilter = filterType === 'expiring' ? 'expiring-30' : filterType;
  const today = new Date().toISOString().slice(0, 10);

  const cutoffDate = (days) => {
    const value = new Date(`${today}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };

  const applyCommonFilters = (query) => {
    let q = query
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true);

    if (branchId) q = q.eq('branch_id', branchId);
    if (category) q = q.eq('category', category);
    if (normalizedSearch) {
      const pattern = `%${normalizedSearch}%`;
      q = q.or(`name.ilike.${pattern},category.ilike.${pattern},description.ilike.${pattern}`);
    }

    if (normalizedFilter === 'expired') {
      q = q.lt('expiry_date', today);
    } else if (['expiring-30', 'expiring-60', 'expiring-90'].includes(normalizedFilter)) {
      const days = Number(normalizedFilter.split('-')[1]) || 30;
      q = q.gte('expiry_date', today).lte('expiry_date', cutoffDate(days));
    } else if (normalizedFilter === 'no-expiry') {
      q = q.is('expiry_date', null);
    }

    return q;
  };

  // Filters/sorts that compare two columns or use a calculated value cannot be
  // expressed safely with the existing REST schema. For those explicit views,
  // fetch only lightweight candidate fields, calculate the matching ids, then
  // request the 30 full rows required for the visible page.
  const needsCandidatePass = normalizedFilter === 'low-stock' || normalizedFilter === 'duplicates' || sortType.startsWith('margin-');

  if (needsCandidatePass) {
    const candidates = [];
    const chunkSize = 1000;
    let offset = 0;

    while (true) {
      let candidateQuery = supabase
        .from('products')
        .select('id,name,category,description,price,cost_price,stock_boxes,low_stock_threshold,expiry_date');
      candidateQuery = applyCommonFilters(candidateQuery)
        .order('name', { ascending: true })
        .range(offset, offset + chunkSize - 1);

      const { data, error } = await candidateQuery;
      if (error) throw error;
      const batch = data || [];
      candidates.push(...batch);
      if (batch.length < chunkSize) break;
      offset += chunkSize;
    }

    let filtered = candidates;
    if (normalizedFilter === 'low-stock') {
      filtered = filtered.filter((product) => Number(product.stock_boxes || 0) <= Number(product.low_stock_threshold || 0));
    } else if (normalizedFilter === 'duplicates') {
      const counts = new Map();
      filtered.forEach((product) => {
        const key = String(product.name || '').trim().toLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
      });
      filtered = filtered.filter((product) => counts.get(String(product.name || '').trim().toLowerCase()) > 1);
    }

    const sorter = {
      'selling-asc': (a, b) => Number(a.price || 0) - Number(b.price || 0),
      'selling-desc': (a, b) => Number(b.price || 0) - Number(a.price || 0),
      'cost-asc': (a, b) => Number(a.cost_price || 0) - Number(b.cost_price || 0),
      'cost-desc': (a, b) => Number(b.cost_price || 0) - Number(a.cost_price || 0),
      'margin-asc': (a, b) => (Number(a.price || 0) - Number(a.cost_price || 0)) - (Number(b.price || 0) - Number(b.cost_price || 0)),
      'margin-desc': (a, b) => (Number(b.price || 0) - Number(b.cost_price || 0)) - (Number(a.price || 0) - Number(a.cost_price || 0)),
      'stock-asc': (a, b) => Number(a.stock_boxes || 0) - Number(b.stock_boxes || 0),
      'stock-desc': (a, b) => Number(b.stock_boxes || 0) - Number(a.stock_boxes || 0),
      'expiry-asc': (a, b) => String(a.expiry_date || '9999-12-31').localeCompare(String(b.expiry_date || '9999-12-31'))
    }[sortType];

    if (sorter) filtered = [...filtered].sort(sorter);
    else filtered = [...filtered].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    const count = filtered.length;
    const from = (safePage - 1) * safePageSize;
    const pageCandidates = filtered.slice(from, from + safePageSize);
    const pageIds = pageCandidates.map((product) => product.id);

    if (!pageIds.length) return { products: [], count, page: safePage, pageSize: safePageSize };

    const { data: fullRows, error } = await supabase
      .from('products')
      .select('*')
      .in('id', pageIds);
    if (error) throw error;

    const byId = new Map((fullRows || []).map((product) => [product.id, product]));
    const products = pageIds.map((id) => byId.get(id)).filter(Boolean);
    return { products, count, page: safePage, pageSize: safePageSize };
  }

  let query = supabase
    .from('products')
    .select('*', { count: 'exact' });
  query = applyCommonFilters(query);

  if (sortType === 'selling-asc') query = query.order('price', { ascending: true });
  else if (sortType === 'selling-desc') query = query.order('price', { ascending: false });
  else if (sortType === 'cost-asc') query = query.order('cost_price', { ascending: true });
  else if (sortType === 'cost-desc') query = query.order('cost_price', { ascending: false });
  else if (sortType === 'stock-asc') query = query.order('stock_boxes', { ascending: true });
  else if (sortType === 'stock-desc') query = query.order('stock_boxes', { ascending: false });
  else if (sortType === 'expiry-asc') query = query.order('expiry_date', { ascending: true, nullsFirst: false });
  else query = query.order('name', { ascending: true });

  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;
  const { data, error, count } = await query.range(from, to);
  if (error) throw error;

  return {
    products: data || [],
    count: count || 0,
    page: safePage,
    pageSize: safePageSize
  };
}


/**
 * POS-focused product paging. Keeps the till responsive by returning only one
 * small page of products while search/category/stock filters execute in Supabase.
 */
export async function getPOSProductsPage(pharmacyId, {
  branchId = null,
  page = 1,
  pageSize = 24,
  search = '',
  category = '',
  inStockOnly = true
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(60, Math.max(12, Number(pageSize) || 24));
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;
  const term = String(search || '').trim().replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);

  let query = supabase
    .from('products')
    .select('*', { count: 'exact' })
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);

  if (branchId) query = query.eq('branch_id', branchId);
  if (category) query = query.eq('category', category);
  if (term) {
    const pattern = `%${term}%`;
    query = query.or(`name.ilike.${pattern},category.ilike.${pattern},description.ilike.${pattern}`);
  }
  if (inStockOnly) query = query.or('stock_boxes.gt.0,stock_units.gt.0');

  const { data, error, count } = await query
    .order('name', { ascending: true })
    .range(from, to);
  if (error) throw error;
  return { products: data || [], count: Number(count || 0), page: safePage, pageSize: safePageSize };
}


export async function getPOSProductsByIds(pharmacyId, branchId, ids = []) {
  const cleanIds = [...new Set((ids || []).filter(Boolean))].slice(0, 30);
  if (!cleanIds.length) return [];
  let query = supabase
    .from('products')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .in('id', cleanIds);
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  const byId = new Map((data || []).map(row => [row.id, row]));
  return cleanIds.map(id => byId.get(id)).filter(Boolean);
}

export async function getInventorySummary(pharmacyId, branchId = null) {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + 30);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  const scopedCount = (configure) => {
    let query = supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true);
    if (branchId) query = query.eq('branch_id', branchId);
    return configure ? configure(query) : query;
  };

  const [totalResult, expiredResult, expiringResult] = await Promise.all([
    scopedCount(),
    scopedCount((query) => query.lt('expiry_date', today)),
    scopedCount((query) => query.gte('expiry_date', today).lte('expiry_date', cutoffKey))
  ]);

  if (totalResult.error) throw totalResult.error;
  if (expiredResult.error) throw expiredResult.error;
  if (expiringResult.error) throw expiringResult.error;

  // Low-stock uses a per-product threshold, so retrieve only the two numeric
  // columns needed for the comparison instead of every product field.
  let lowStockCount = 0;
  const chunkSize = 1000;
  let offset = 0;
  while (true) {
    let query = supabase
      .from('products')
      .select('stock_boxes,low_stock_threshold')
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true)
      .range(offset, offset + chunkSize - 1);
    if (branchId) query = query.eq('branch_id', branchId);
    const { data, error } = await query;
    if (error) throw error;
    const batch = data || [];
    lowStockCount += batch.filter((product) => Number(product.stock_boxes || 0) <= Number(product.low_stock_threshold || 0)).length;
    if (batch.length < chunkSize) break;
    offset += chunkSize;
  }

  return {
    totalProducts: totalResult.count || 0,
    lowStockCount,
    expiredCount: expiredResult.count || 0,
    expiringSoonCount: expiringResult.count || 0
  };
}

export async function getProductCategories(pharmacyId, branchId = null) {
  const categories = new Set();
  const chunkSize = 1000;
  let offset = 0;

  while (true) {
    let query = supabase
      .from('products')
      .select('category')
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true)
      .order('category', { ascending: true })
      .range(offset, offset + chunkSize - 1);
    if (branchId) query = query.eq('branch_id', branchId);

    const { data, error } = await query;
    if (error) throw error;
    const batch = data || [];
    batch.forEach((row) => {
      if (row.category) categories.add(row.category);
    });
    if (batch.length < chunkSize) break;
    offset += chunkSize;
  }

  return [...categories].sort((a, b) => a.localeCompare(b));
}

export async function getProductStockLogs(pharmacyId, productId, limit = 100) {
  const { data, error } = await supabase
    .from('stock_logs')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getLowStockProducts(pharmacyId) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .filter('stock_boxes', 'lte', supabase.rpc('low_stock_threshold'));
  if (error) {
    const { data: all } = await supabase.from('products').select('*').eq('pharmacy_id', pharmacyId).eq('is_active', true);
    return (all || []).filter(p => p.stock_boxes <= p.low_stock_threshold);
  }
  return data;
}

export async function createProduct(payload) {
  if (!payload.pharmacy_id) {
    throw new Error('pharmacy_id is required when creating a product');
  }
  if (!payload.branch_id) {
    throw new Error('branch_id is required when creating a product. Please select a branch before importing.');
  }
  const { data, error } = await supabase.from('products').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id, payload) {
  const { data, error } = await supabase.from('products').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').update({ is_active: false }).eq('id', id);
  if (error) throw error;
}

// ===================== PRODUCT BATCHES (FIFO) =====================
export async function getProductBatches(productId, pharmacyId) {
  const { data, error } = await supabase
    .from('product_batches')
    .select('*')
    .eq('product_id', productId)
    .eq('pharmacy_id', pharmacyId)
    .order('received_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createBatch(payload) {
  const { data, error } = await supabase.from('product_batches').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateBatchStock(batchId, quantityBoxes, quantityUnits) {
  const { data, error } = await supabase
    .from('product_batches')
    .update({ quantity_boxes: quantityBoxes, quantity_units: quantityUnits })
    .eq('id', batchId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================== CUSTOMERS =====================
export async function getCustomers(pharmacyId) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('name');
  if (error) throw error;
  return data;
}

export async function createCustomer(payload) {
  const { data, error } = await supabase.from('customers').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateCustomer(id, payload) {
  const { data, error } = await supabase.from('customers').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCustomer(id) {
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
}

function normalizeCustomerSearchTerm(value) {
  return String(value || '')
    .trim()
    .replace(/[%_(),\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

/**
 * Fetch one Customer page from Supabase. Only the visible rows are returned so
 * large customer lists do not have to be loaded into the browser at once.
 */
export async function getCustomersPage(pharmacyId, { page = 1, pageSize = 30, search = '' } = {}) {
  const safePageSize = [25, 30, 50].includes(Number(pageSize)) ? Number(pageSize) : 30;
  const safePage = Math.max(1, Number(page) || 1);
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;
  const term = normalizeCustomerSearchTerm(search);

  let query = supabase
    .from('customers')
    .select('*', { count: 'exact' })
    .eq('pharmacy_id', pharmacyId)
    .order('name', { ascending: true });

  if (term) {
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,address.ilike.%${term}%`);
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;

  const total = Number(count || 0);
  return {
    data: data || [],
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize))
  };
}

/**
 * Aggregate completed-sale activity for the customers currently visible in the
 * paginated Customer table. The query contains only four lightweight columns.
 */
export async function getCustomerMetricsForIds(pharmacyId, customerIds = []) {
  const ids = [...new Set((customerIds || []).filter(Boolean))];
  if (!ids.length) return {};

  const metrics = Object.fromEntries(ids.map((id) => [id, {
    purchaseCount: 0, totalSpent: 0, lastPurchaseAt: null
  }]));
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('sales')
      .select('customer_id,total_amount,status,created_at')
      .eq('pharmacy_id', pharmacyId)
      .in('customer_id', ids)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const batch = data || [];
    for (const sale of batch) {
      if (sale.status !== 'completed' || !metrics[sale.customer_id]) continue;
      const metric = metrics[sale.customer_id];
      metric.purchaseCount += 1;
      metric.totalSpent += Number(sale.total_amount || 0);
      if (!metric.lastPurchaseAt || new Date(sale.created_at) > new Date(metric.lastPurchaseAt)) {
        metric.lastPurchaseAt = sale.created_at;
      }
    }

    if (batch.length < pageSize) break;
    from += pageSize;
  }

  Object.values(metrics).forEach((metric) => {
    metric.averagePurchase = metric.purchaseCount ? metric.totalSpent / metric.purchaseCount : 0;
  });
  return metrics;
}

/** Fetch one page of a single customer's sales history. */
export async function getCustomerSalesPage(pharmacyId, customerId, { page = 1, pageSize = 10 } = {}) {
  const safePageSize = [10, 20, 30].includes(Number(pageSize)) ? Number(pageSize) : 10;
  const safePage = Math.max(1, Number(page) || 1);
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;

  const { data, error, count } = await supabase
    .from('sales')
    .select('*', { count: 'exact' })
    .eq('pharmacy_id', pharmacyId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;

  const sales = await enrichSalesWithItems(data || []);
  const total = Number(count || 0);
  return {
    data: sales,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize))
  };
}

/** Lifetime completed-sale metrics for one customer. */
export async function getCustomerSalesSummary(pharmacyId, customerId) {
  const pageSize = 1000;
  let from = 0;
  let purchaseCount = 0;
  let totalSpent = 0;
  let lastPurchaseAt = null;
  const paymentBreakdown = { cash: 0, mobile_money: 0, card: 0 };

  while (true) {
    const { data, error } = await supabase
      .from('sales')
      .select('total_amount,status,payment_method,created_at')
      .eq('pharmacy_id', pharmacyId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;

    const batch = data || [];
    for (const sale of batch) {
      if (sale.status !== 'completed') continue;
      const amount = Number(sale.total_amount || 0);
      purchaseCount += 1;
      totalSpent += amount;
      if (Object.prototype.hasOwnProperty.call(paymentBreakdown, sale.payment_method)) {
        paymentBreakdown[sale.payment_method] += amount;
      }
      if (!lastPurchaseAt || new Date(sale.created_at) > new Date(lastPurchaseAt)) {
        lastPurchaseAt = sale.created_at;
      }
    }

    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return {
    purchaseCount,
    totalSpent,
    averagePurchase: purchaseCount ? totalSpent / purchaseCount : 0,
    lastPurchaseAt,
    paymentBreakdown
  };
}


// ===================== POS HELD SALES =====================
export async function getPOSHeldSales(pharmacyId, branchId, userId) {
  const { data, error } = await supabase
    .from('pos_held_sales')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('branch_id', branchId)
    .eq('created_by', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createPOSHeldSale(payload) {
  const { data, error } = await supabase
    .from('pos_held_sales')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePOSHeldSale(id) {
  const { error } = await supabase.from('pos_held_sales').delete().eq('id', id);
  if (error) throw error;
}

// ===================== SALES =====================
export async function getSales(pharmacyId, limit = 50) {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// Normalize free-text filters before embedding them in PostgREST filter expressions.
function normalizeSalesSearchTerm(value) {
  return String(value || '')
    .trim()
    .replace(/[%_(),\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

async function resolveSalesCustomerMatches(pharmacyId, searchTerm) {
  const term = normalizeSalesSearchTerm(searchTerm);
  if (!term) return { term: '', customerIds: [] };

  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .eq('pharmacy_id', pharmacyId)
    .ilike('name', `%${term}%`)
    .limit(50);

  if (error) throw error;
  return { term, customerIds: (data || []).map((row) => row.id).filter(Boolean) };
}

function applySalesFilters(query, {
  branchId = null,
  paymentMethod = null,
  staffId = null,
  start = null,
  end = null,
  searchTerm = '',
  customerIds = []
} = {}) {
  let next = query;
  if (branchId) next = next.eq('branch_id', branchId);
  if (paymentMethod) next = next.eq('payment_method', paymentMethod);
  if (staffId) next = next.eq('created_by', staffId);
  if (start) next = next.gte('created_at', start);
  if (end) next = next.lt('created_at', end);

  if (searchTerm) {
    if (customerIds.length) {
      next = next.or(`invoice_number.ilike.%${searchTerm}%,customer_id.in.(${customerIds.join(',')})`);
    } else {
      next = next.ilike('invoice_number', `%${searchTerm}%`);
    }
  }
  return next;
}

/**
 * Fetch one Admin Sales page from Supabase. Only the visible page is hydrated
 * with line items, preventing large pharmacies from loading their entire sales
 * history into the browser just to render the transaction table.
 */
export async function getSalesPage(pharmacyId, {
  page = 1,
  pageSize = 30,
  branchId = null,
  paymentMethod = null,
  staffId = null,
  start = null,
  end = null,
  search = ''
} = {}) {
  const safePageSize = [25, 30, 50].includes(Number(pageSize)) ? Number(pageSize) : 30;
  const safePage = Math.max(1, Number(page) || 1);
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;
  const { term, customerIds } = await resolveSalesCustomerMatches(pharmacyId, search);

  let query = supabase
    .from('sales')
    .select('*, customers(name)', { count: 'exact' })
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false });

  query = applySalesFilters(query, {
    branchId, paymentMethod, staffId, start, end, searchTerm: term, customerIds
  }).range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  const sales = await enrichSalesWithItems(data || []);
  const creatorIds = [...new Set(sales.map((sale) => sale.created_by).filter(Boolean))];
  let staffById = {};
  if (creatorIds.length) {
    const { data: staffRows, error: staffError } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('pharmacy_id', pharmacyId)
      .in('id', creatorIds);
    if (staffError) throw staffError;
    staffById = Object.fromEntries((staffRows || []).map((row) => [row.id, row]));
  }

  const total = Number(count || 0);
  return {
    data: sales.map((sale) => ({
      ...sale,
      staff_name: staffById[sale.created_by]?.full_name || 'Unknown staff',
      staff_role: staffById[sale.created_by]?.role || ''
    })),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize))
  };
}

/**
 * Calculate lightweight summary metrics for the active Sales filters. The query
 * fetches only the numeric/payment columns required for the cards, in pages,
 * instead of downloading full sales and item records. Revenue metrics count only
 * completed sales.
 */
export async function getSalesFilteredSummary(pharmacyId, {
  branchId = null,
  paymentMethod = null,
  staffId = null,
  start = null,
  end = null,
  search = ''
} = {}) {
  const { term, customerIds } = await resolveSalesCustomerMatches(pharmacyId, search);
  const pageSize = 1000;
  let from = 0;
  const completed = [];

  while (true) {
    let query = supabase
      .from('sales')
      .select('id, total_amount, discount, payment_method, status, created_at')
      .eq('pharmacy_id', pharmacyId)
      .order('created_at', { ascending: false });

    query = applySalesFilters(query, {
      branchId, paymentMethod, staffId, start, end, searchTerm: term, customerIds
    }).range(from, from + pageSize - 1);

    const { data, error } = await query;
    if (error) throw error;

    const batch = data || [];
    completed.push(...batch.filter((sale) => sale.status === 'completed'));
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  const paymentBreakdown = { cash: 0, mobile_money: 0, card: 0 };
  let totalRevenue = 0;
  let totalDiscount = 0;
  for (const sale of completed) {
    const amount = Number(sale.total_amount || 0);
    totalRevenue += amount;
    totalDiscount += Number(sale.discount || 0);
    if (Object.prototype.hasOwnProperty.call(paymentBreakdown, sale.payment_method)) {
      paymentBreakdown[sale.payment_method] += amount;
    }
  }

  return {
    totalRevenue,
    totalTransactions: completed.length,
    averageSale: completed.length ? totalRevenue / completed.length : 0,
    totalDiscount,
    paymentBreakdown
  };
}

/**
 * Fetch completed sales for reporting without the fixed getSales() history cap.
 * Results are paged so daily/weekly/monthly employee reports remain complete even
 * when the selected period contains more than Supabase's default row limit.
 */
export async function getSalesForReport(pharmacyId, {
  branchId = null,
  staffId = null,
  start = null,
  end = null
} = {}) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from('sales')
      .select('*, customers(name)')
      .eq('pharmacy_id', pharmacyId)
      .eq('status', 'completed')
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);

    if (branchId) query = query.eq('branch_id', branchId);
    if (staffId) query = query.eq('created_by', staffId);
    if (start) query = query.gte('created_at', start);
    if (end) query = query.lt('created_at', end);

    const { data, error } = await query;
    if (error) throw error;

    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}


/**
 * Fetch one database page of completed sales for the detailed section of the
 * Admin Sales Reports workspace. Aggregate report calculations can scan the
 * requested period, while the UI only renders a small transaction page.
 */
export async function getSalesReportTransactionsPage(pharmacyId, {
  branchId = null,
  staffId = null,
  start = null,
  end = null,
  page = 1,
  pageSize = 30
} = {}) {
  const safePageSize = [25, 30, 50].includes(Number(pageSize)) ? Number(pageSize) : 30;
  const safePage = Math.max(1, Number(page) || 1);
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;

  let query = supabase
    .from('sales')
    .select('id,invoice_number,total_amount,payment_method,status,branch_id,created_by,created_at,customers(name)', { count: 'exact' })
    .eq('pharmacy_id', pharmacyId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (branchId) query = query.eq('branch_id', branchId);
  if (staffId) query = query.eq('created_by', staffId);
  if (start) query = query.gte('created_at', start);
  if (end) query = query.lt('created_at', end);

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;

  const total = Number(count || 0);
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  if (safePage > totalPages && total > 0) {
    return getSalesReportTransactionsPage(pharmacyId, {
      branchId, staffId, start, end, page: totalPages, pageSize: safePageSize
    });
  }

  return {
    rows: data || [],
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages
  };
}


export async function getSaleItems(saleId) {
  const { data, error } = await supabase
    .from('sale_items')
    .select('*')
    .eq('sale_id', saleId);
  if (error) {
    console.error(`Error fetching sale_items for ${saleId}:`, error);
    throw error;
  }
  return data || [];
}

export async function enrichSalesWithItems(sales) {
  if (!sales || sales.length === 0) return sales;
  
  try {
    console.log(`[enrichSalesWithItems] Enriching ${sales.length} sales with items`);
    
    // Batch fetch items to avoid URL length limits (batch size: 50 sales per query)
    const saleIds = sales.map(s => s.id);
    const batchSize = 50;
    const itemsBySaleId = {};
    let totalItems = 0;
    
    for (let i = 0; i < saleIds.length; i += batchSize) {
      const batch = saleIds.slice(i, i + batchSize);
      const { data: batchItems, error: itemsError } = await supabase
        .from('sale_items')
        .select('*')
        .in('sale_id', batch);
      
      if (itemsError) throw itemsError;
      
      // Map batch items by sale_id
      (batchItems || []).forEach(item => {
        if (!itemsBySaleId[item.sale_id]) {
          itemsBySaleId[item.sale_id] = [];
        }
        itemsBySaleId[item.sale_id].push(item);
        totalItems++;
      });
    }
    
    // Attach items to sales
    const enrichedSales = sales.map(sale => ({
      ...sale,
      sale_items: itemsBySaleId[sale.id] || []
    }));
    
    const numBatches = Math.ceil(saleIds.length / batchSize);
    console.log(`[enrichSalesWithItems] Success - ${totalItems} total items across ${enrichedSales.length} sales (${numBatches} batches instead of ${enrichedSales.length} individual queries)`);
    
    return enrichedSales;
  } catch (err) {
    console.error('[enrichSalesWithItems] Error enriching sales:', {
      error: err,
      message: err.message,
      salesCount: sales?.length
    });
    // Return sales with empty items array if enrichment fails
    return sales.map(sale => ({
      ...sale,
      sale_items: sale.sale_items || []
    }));
  }
}

export async function getSalesToday(pharmacyId, branchId = null) {
  // Use timezone-aware date range
  const todayRange = await getTodayDateRange(pharmacyId);
  
  let query = supabase
    .from('sales')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', todayRange.start)
    .lt('created_at', todayRange.end)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });
  
  if (branchId) query = query.eq('branch_id', branchId);
  
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function syncQueuedPOSSale(record) {
  if (!record?.client_transaction_id) throw new Error('Missing offline transaction ID.');
  const { data, error } = await supabase.rpc('sync_offline_pos_sale', {
    p_client_transaction_id: record.client_transaction_id,
    p_invoice_number: record.invoice_number || null,
    p_sale: record.sale_payload || {},
    p_items: record.sale_items || []
  });
  if (error) throw error;
  return data || {};
}

export async function createPOSSaleAtomic(salePayload, items, { clientTransactionId, invoiceNumber } = {}) {
  const record = {
    client_transaction_id: clientTransactionId || (globalThis.crypto?.randomUUID?.() || `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    invoice_number: invoiceNumber || `INV-${Date.now().toString().slice(-8)}`,
    sale_payload: salePayload || {},
    sale_items: items || []
  };

  try {
    const result = await syncQueuedPOSSale(record);
    return result?.sale || result;
  } catch (error) {
    const message = String(error?.message || '');
    const migrationMissing = ['PGRST202', '42883'].includes(error?.code) || /sync_offline_pos_sale/i.test(message);
    if (!migrationMissing) throw error;
    // Preserve normal online checkout during rollout before the offline migration
    // has been applied. Offline queued sales themselves never use this fallback,
    // because only the idempotent RPC is safe to retry after reconnecting.
    return createSale(salePayload, items);
  }
}

export async function createSale(salePayload, items) {
  const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

  // Check for expired products BEFORE creating sale
  for (const item of items) {
    const { data: product } = await supabase.from('products').select('expiry_date').eq('id', item.product_id).single();
    if (product && product.expiry_date) {
      const expiry = new Date(product.expiry_date);
      if (expiry < new Date()) {
        throw new Error(`Cannot sell expired product: ${item.product_name} (Expired: ${product.expiry_date})`);
      }
    }
  }

  // Get pharmacy settings for tax calculation
  const { data: pharmacy } = await supabase.from('pharmacies').select('tax_enabled, tax_rate').eq('id', salePayload.pharmacy_id).single();
  
  let finalTotal = Number(salePayload.total_amount || 0);
  if (pharmacy?.tax_enabled && pharmacy?.tax_rate > 0) {
    const taxAmount = (finalTotal * pharmacy.tax_rate) / 100;
    finalTotal += taxAmount;
  }

  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({ ...salePayload, invoice_number: invoiceNumber, total_amount: finalTotal })
    .select()
    .single();
  
  if (saleError) {
    console.error('Sale insert error:', {
      error: saleError,
      code: saleError.code,
      message: saleError.message,
      details: saleError.details,
      hint: saleError.hint,
      payload: { ...salePayload, total_amount: finalTotal, invoice_number: invoiceNumber }
    });
    throw saleError;
  }

  const saleItems = items.map(item => ({
    sale_id: sale.id,
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.quantity * item.unit_price,
    packaging_type: item.packaging_type || 'unit',
    packaging_quantity: item.packaging_quantity || item.quantity
  }));

  const { error: itemsError } = await supabase.from('sale_items').insert(saleItems);
  if (itemsError) throw itemsError;

  for (const item of items) {
    const { data: product, error: productError } = await supabase.from('products').select('stock_boxes, stock_units, units_per_box').eq('id', item.product_id).single();
    if (productError) {
      continue;
    }
    
    if (product) {
      const unitsPerBox = product.units_per_box || 1;
      let totalUnits = (product.stock_boxes * unitsPerBox) + product.stock_units - item.quantity;
      
      const newBoxes = Math.floor(totalUnits / unitsPerBox);
      const newUnits = totalUnits % unitsPerBox;
      
      const { data: updateData, error: updateError } = await supabase.from('products').update({ stock_boxes: Math.max(0, newBoxes), stock_units: Math.max(0, newUnits) }).eq('id', item.product_id).select();
      if (updateError) {
        continue;
      }

      await supabase.from('stock_logs').insert({
        product_id: item.product_id,
        product_name: item.product_name,
        change_type: 'sale',
        quantity_change: -item.quantity,
        notes: `Sale: ${sale.invoice_number}`,
        created_by: salePayload.created_by,
        pharmacy_id: salePayload.pharmacy_id,
        branch_id: salePayload.branch_id
      }).select();
    }
  }

  return sale;
}

// ===================== BRANCHES =====================
export async function getBranches(pharmacyId) {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('name');
  if (error) throw error;
  return data;
}

export async function createBranch(payload) {
  const { data, error } = await supabase.from('branches').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateBranch(id, payload) {
  const { data, error } = await supabase.from('branches').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ===================== STOCK LOGS =====================
export async function getStockLogs(pharmacyId, limit = 100) {
  const { data, error } = await supabase
    .from('stock_logs')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function addStock(productId, productName, quantity, notes, userId, pharmacyId, branchId = null, stockUnitType = 'box') {
  const { data: product } = await supabase.from('products').select('stock_boxes, units_per_box, branch_id, stock_unit_type').eq('id', productId).single();
  if (!product) throw new Error('Product not found');
  
  // Ensure stock is added to product's branch
  const targetBranchId = branchId || product.branch_id;
  if (!targetBranchId) throw new Error('Product must be assigned to a branch');

  // Store stock with unit type information
  const newBoxes = product.stock_boxes + quantity;
  await supabase
    .from('products')
    .update({ stock_boxes: newBoxes, stock_unit_type: stockUnitType })
    .eq('id', productId);
  
  await supabase.from('stock_logs').insert({
    product_id: productId,
    product_name: productName,
    change_type: 'restock',
    quantity_change: quantity,
    notes: `${notes}${stockUnitType !== 'box' ? ` [${stockUnitType}s]` : ''}`,
    created_by: userId,
    pharmacy_id: pharmacyId,
    branch_id: targetBranchId
  });
}

// ===================== ANALYTICS =====================
export async function getDashboardStats(pharmacyId, branchId = null) {
  // Sales totals are aggregated in PostgreSQL so the browser receives only a
  // handful of numbers instead of every sale from the current day/week.
  let productsQuery = supabase
    .from('products')
    .select('id, name, category, stock_boxes, stock_units, units_per_box, price, low_stock_threshold, expiry_date')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);

  if (branchId) {
    productsQuery = productsQuery.eq('branch_id', branchId);
  }

  const [salesStats, productsResult] = await Promise.all([
    getSalesStats(pharmacyId, branchId),
    productsQuery
  ]);

  if (productsResult.error) throw productsResult.error;

  const allProducts = productsResult.data || [];
  const lowStockItems = allProducts.filter(p => Number(p.stock_boxes || 0) <= Number(p.low_stock_threshold || 0));

  const todayKey = new Date().toISOString().slice(0, 10);
  const expiryCutoff = new Date();
  expiryCutoff.setUTCDate(expiryCutoff.getUTCDate() + 30);
  const expiryCutoffKey = expiryCutoff.toISOString().slice(0, 10);

  const expiredProducts = allProducts
    .filter(p => p.expiry_date && p.expiry_date < todayKey)
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
  const expiringSoonProducts = allProducts
    .filter(p => p.expiry_date && p.expiry_date >= todayKey && p.expiry_date <= expiryCutoffKey)
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));

  const inventoryWorth = allProducts.reduce((sum, p) => {
    const totalUnits = (Number(p.stock_boxes || 0) * Number(p.units_per_box || 1)) + Number(p.stock_units || 0);
    return sum + (totalUnits * Number(p.price || 0));
  }, 0);

  return {
    todayRevenue: salesStats.todayRevenue,
    weekRevenue: salesStats.weekRevenue,
    todaySalesCount: salesStats.todayTransactions,
    totalProducts: allProducts.length,
    lowStockCount: lowStockItems.length,
    lowStockProducts: lowStockItems,
    expiredCount: expiredProducts.length,
    expiredProducts,
    expiringSoonCount: expiringSoonProducts.length,
    expiringSoonProducts,
    inventoryWorth,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Build the operational insight panels used by the Admin dashboard.
 * The selected period is fetched directly from Supabase so the dashboard does
 * not rely on the capped recent-sales list used by the transaction preview.
 */
export async function getDashboardInsights(pharmacyId, period = 'week', branchId = null) {
  let range;
  if (period === 'today') range = await getTodayDateRange(pharmacyId);
  else if (period === 'month') range = await getMonthDateRange(pharmacyId);
  else range = await getWeekDateRange(pharmacyId);

  const [rawSales, salesmen] = await Promise.all([
    getSalesForReport(pharmacyId, {
      branchId,
      start: range.start,
      end: range.end
    }),
    getPharmacySalesmen(pharmacyId)
  ]);

  const sales = await enrichSalesWithItems(rawSales || []);
  const totalRevenue = sales.reduce((sum, sale) => sum + Number(sale.total_amount || 0), 0);
  const transactionCount = sales.length;
  const averageSale = transactionCount ? totalRevenue / transactionCount : 0;

  const productMap = new Map();
  for (const sale of sales) {
    for (const item of (sale.sale_items || [])) {
      const key = item.product_id || item.product_name || 'unknown';
      const current = productMap.get(key) || {
        id: item.product_id || null,
        name: item.product_name || 'Unknown product',
        quantity: 0,
        revenue: 0,
        transactions: 0
      };
      current.quantity += Number(item.quantity || 0);
      current.revenue += Number(item.total_price || 0);
      current.transactions += 1;
      productMap.set(key, current);
    }
  }

  const topProducts = [...productMap.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, 5);

  const staffMap = new Map((salesmen || []).map(person => [person.id, {
    id: person.id,
    name: person.full_name || person.email || 'Salesman',
    email: person.email || '',
    transactions: 0,
    revenue: 0
  }]));

  for (const sale of sales) {
    const staff = staffMap.get(sale.created_by);
    if (!staff) continue;
    staff.transactions += 1;
    staff.revenue += Number(sale.total_amount || 0);
  }

  const staffPerformance = [...staffMap.values()]
    .filter(person => person.transactions > 0)
    .sort((a, b) => b.revenue - a.revenue || b.transactions - a.transactions)
    .slice(0, 5);

  return {
    period,
    start: range.start,
    end: range.end,
    totalRevenue,
    transactionCount,
    averageSale,
    topProducts,
    staffPerformance
  };
}

/**
 * Get sales statistics using server-side timezone-aware date range queries
 * This ensures consistent calculations across all time periods
 * 
 * @param {string} pharmacyId - The pharmacy ID
 * @param {string} branchId - Optional branch ID for filtering
 * @returns {Promise<{todayRevenue, weekRevenue, monthRevenue, yearRevenue, totalRevenue, todayTransactions, totalTransactions}>}
 */
export async function getSalesStats(pharmacyId, branchId = null) {
  const { data, error } = await supabase.rpc('get_sales_stats', {
    p_pharmacy_id: pharmacyId,
    p_branch_id: branchId
  });

  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return {
      todayRevenue: Number(row?.today_revenue || 0),
      weekRevenue: Number(row?.week_revenue || 0),
      monthRevenue: Number(row?.month_revenue || 0),
      yearRevenue: Number(row?.year_revenue || 0),
      totalRevenue: Number(row?.total_revenue || 0),
      todayTransactions: Number(row?.today_transactions || 0),
      totalTransactions: Number(row?.total_transactions || 0)
    };
  }

  // Keep existing deployments functional until the optimization migration is
  // applied. The fallback is deliberately one narrow query (not five queries
  // plus an all-column historical download like the previous implementation).
  const missingRpc = error.code === 'PGRST202' || (
    /get_sales_stats/i.test(error.message || '') &&
    /not found|does not exist|schema cache/i.test(error.message || '')
  );
  if (!missingRpc) throw error;

  console.warn('get_sales_stats RPC is not available yet; using reduced-egress fallback. Apply the latest Supabase migrations.');

  const [todayRange, weekRange, monthRange, yearRange] = await Promise.all([
    getTodayDateRange(pharmacyId),
    getWeekDateRange(pharmacyId),
    getMonthDateRange(pharmacyId),
    getYearDateRange(pharmacyId)
  ]);

  let query = supabase
    .from('sales')
    .select('total_amount, created_at')
    .eq('pharmacy_id', pharmacyId)
    .eq('status', 'completed');

  if (branchId) query = query.eq('branch_id', branchId);

  const { data: sales, error: fallbackError } = await query;
  if (fallbackError) throw fallbackError;

  const rows = sales || [];
  const inRange = (createdAt, range) => createdAt >= range.start && createdAt < range.end;
  const sumRange = range => rows.reduce((sum, sale) => (
    inRange(sale.created_at, range) ? sum + Number(sale.total_amount || 0) : sum
  ), 0);

  return {
    todayRevenue: sumRange(todayRange),
    weekRevenue: sumRange(weekRange),
    monthRevenue: sumRange(monthRange),
    yearRevenue: sumRange(yearRange),
    totalRevenue: rows.reduce((sum, sale) => sum + Number(sale.total_amount || 0), 0),
    todayTransactions: rows.filter(sale => inRange(sale.created_at, todayRange)).length,
    totalTransactions: rows.length
  };
}

export async function getSuperAdminStats() {
  const [pharmacies, usersCount, revenueRpc] = await Promise.all([
    supabase.from('pharmacies').select('id, name, is_active, created_at'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.rpc('get_visible_sales_revenue_total')
  ]);

  if (pharmacies.error) throw pharmacies.error;
  if (usersCount.error) throw usersCount.error;

  let totalRevenue = 0;
  if (!revenueRpc.error) {
    totalRevenue = Number(revenueRpc.data || 0);
  } else {
    const missingRpc = revenueRpc.error.code === 'PGRST202' || (
      /get_visible_sales_revenue_total/i.test(revenueRpc.error.message || '') &&
      /not found|does not exist|schema cache/i.test(revenueRpc.error.message || '')
    );
    if (!missingRpc) throw revenueRpc.error;

    // Temporary compatibility path until the migration is applied.
    const { data: sales, error: salesError } = await supabase
      .from('sales')
      .select('total_amount')
      .eq('status', 'completed');
    if (salesError) throw salesError;
    totalRevenue = (sales || []).reduce((sum, sale) => sum + Number(sale.total_amount || 0), 0);
  }

  return {
    totalPharmacies: (pharmacies.data || []).length,
    activePharmacies: (pharmacies.data || []).filter(p => p.is_active).length,
    totalUsers: usersCount.count || 0,
    totalRevenue,
    pharmacies: pharmacies.data || []
  };
}


function getSuperAdminPeriodRange(period = 'this_month') {
  const now = new Date();
  const utcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(utcDay.getTime() + 86400000);
  let start;
  let end = tomorrow;
  let previousStart = null;
  let previousEnd = null;

  if (period === 'today') {
    start = utcDay;
    previousEnd = new Date(start);
    previousStart = new Date(start.getTime() - 86400000);
  } else if (period === 'yesterday') {
    end = utcDay;
    start = new Date(utcDay.getTime() - 86400000);
    previousEnd = new Date(start);
    previousStart = new Date(start.getTime() - 86400000);
  } else if (period === 'last_7_days') {
    start = new Date(utcDay.getTime() - (6 * 86400000));
    previousEnd = new Date(start);
    previousStart = new Date(start.getTime() - (7 * 86400000));
  } else if (period === 'this_year') {
    start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    previousStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
    previousEnd = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  } else if (period === 'all_time') {
    start = new Date('2000-01-01T00:00:00.000Z');
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    previousEnd = new Date(start);
    previousStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    previousStart: previousStart?.toISOString() || null,
    previousEnd: previousEnd?.toISOString() || null
  };
}

/**
 * Platform-wide Super Admin overview. Uses the secure aggregate RPC when the
 * latest migration is available and falls back to compatible queries for
 * deployments that have not applied it yet.
 */
export async function getSuperAdminOverview(period = 'this_month') {
  const range = getSuperAdminPeriodRange(period);
  const { data, error } = await supabase.rpc('get_super_admin_overview', {
    p_start: range.start,
    p_end: range.end,
    p_prev_start: range.previousStart,
    p_prev_end: range.previousEnd
  });

  if (!error && data) return { ...data, period, range, usingFallback: false };

  const missingRpc = error && (error.code === 'PGRST202' || /get_super_admin_overview/i.test(error.message || ''));
  if (error && !missingRpc) throw error;

  console.warn('get_super_admin_overview RPC is unavailable; using compatibility queries. Apply the latest Supabase migration for best performance.');

  const [pharmaciesResult, profilesResult, branchesResult, periodSalesResult, previousSalesResult, recentSalesResult] = await Promise.all([
    supabase.from('pharmacies').select('id,name,email,is_active,created_at').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id,full_name,role,pharmacy_id,is_active,created_at').order('created_at', { ascending: false }),
    supabase.from('branches').select('id,pharmacy_id,is_active'),
    supabase.from('sales').select('id,invoice_number,total_amount,pharmacy_id,created_at').eq('status', 'completed').gte('created_at', range.start).lt('created_at', range.end).order('created_at', { ascending: false }).limit(5000),
    range.previousStart
      ? supabase.from('sales').select('id,total_amount').eq('status', 'completed').gte('created_at', range.previousStart).lt('created_at', range.previousEnd).limit(5000)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('sales').select('id,invoice_number,total_amount,pharmacy_id,created_at').eq('status', 'completed').order('created_at', { ascending: false }).limit(250)
  ]);

  for (const result of [pharmaciesResult, profilesResult, branchesResult, periodSalesResult, previousSalesResult, recentSalesResult]) {
    if (result.error) throw result.error;
  }

  const pharmacies = pharmaciesResult.data || [];
  const profiles = profilesResult.data || [];
  const branches = branchesResult.data || [];
  const periodSales = periodSalesResult.data || [];
  const previousSales = previousSalesResult.data || [];
  const recentSales = recentSalesResult.data || [];
  const pharmacyMap = new Map(pharmacies.map(p => [p.id, p]));

  const pharmacyRows = pharmacies.map(p => {
    const pharmacyUsers = profiles.filter(row => row.pharmacy_id === p.id);
    const pharmacyBranches = branches.filter(row => row.pharmacy_id === p.id && row.is_active);
    const selectedSales = periodSales.filter(row => row.pharmacy_id === p.id);
    const latestSale = recentSales.find(row => row.pharmacy_id === p.id);
    return {
      ...p,
      user_count: pharmacyUsers.length,
      active_user_count: pharmacyUsers.filter(row => row.is_active !== false).length,
      branch_count: pharmacyBranches.length,
      period_revenue: selectedSales.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
      period_transactions: selectedSales.length,
      last_sale_at: latestSale?.created_at || null
    };
  });

  const trend = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const dayStart = new Date(utcMidnight(Date.now() - offset * 86400000));
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const rows = recentSales.filter(row => {
      const when = new Date(row.created_at);
      return when >= dayStart && when < dayEnd;
    });
    trend.push({
      date: dayStart.toISOString().slice(0, 10),
      revenue: rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
      transactions: rows.length
    });
  }

  const activities = [
    ...pharmacies.slice(0, 6).map(p => ({ type: 'pharmacy_created', time: p.created_at, title: 'Pharmacy registered', detail: p.name, pharmacy_id: p.id })),
    ...profiles.slice(0, 6).map(pr => ({
      type: 'user_created',
      time: pr.created_at,
      title: 'User joined',
      detail: [pr.full_name, pr.role, pharmacyMap.get(pr.pharmacy_id)?.name].filter(Boolean).join(' · '),
      pharmacy_id: pr.pharmacy_id
    })),
    ...recentSales.slice(0, 8).map(sl => ({
      type: 'sale_completed',
      time: sl.created_at,
      title: 'Sale completed',
      detail: [pharmacyMap.get(sl.pharmacy_id)?.name, sl.invoice_number].filter(Boolean).join(' · '),
      pharmacy_id: sl.pharmacy_id,
      amount: sl.total_amount
    }))
  ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 15);

  return {
    period,
    range,
    usingFallback: true,
    summary: {
      total_pharmacies: pharmacies.length,
      active_pharmacies: pharmacies.filter(p => p.is_active).length,
      total_users: profiles.length,
      active_users: profiles.filter(p => p.is_active !== false).length,
      period_revenue: periodSales.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
      period_transactions: periodSales.length,
      previous_revenue: range.previousStart ? previousSales.reduce((sum, row) => sum + Number(row.total_amount || 0), 0) : null,
      previous_transactions: range.previousStart ? previousSales.length : null
    },
    pharmacies: pharmacyRows,
    revenue_trend: trend,
    activity: activities
  };
}



/**
 * Server-side pharmacy directory for Super Admin. Keeps the platform list fast
 * as tenants grow instead of downloading every pharmacy into the browser.
 */
export async function getSuperAdminPharmaciesPage({
  page = 1,
  pageSize = 30,
  search = '',
  status = 'all'
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = [25, 30, 50].includes(Number(pageSize)) ? Number(pageSize) : 30;
  const from = (safePage - 1) * safeSize;
  const to = from + safeSize - 1;

  let query = supabase
    .from('pharmacies')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  const term = String(search || '').trim().replace(/[%_(),\"']/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
  if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,address.ilike.%${term}%`);
  if (status === 'active') query = query.eq('is_active', true);
  if (status === 'disabled') query = query.eq('platform_status', 'disabled');
  if (status === 'suspended') query = query.eq('platform_status', 'suspended');
  if (status === 'archived') query = query.eq('platform_status', 'archived');

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    rows: data || [],
    count: count || 0,
    page: safePage,
    pageSize: safeSize,
    pageCount: Math.max(1, Math.ceil((count || 0) / safeSize))
  };
}

/**
 * Operational snapshot for one tenant, used by the Super Admin pharmacy
 * workspace. Financial values are management metrics, not accounting profit.
 */
export async function getSuperAdminPharmacyProfile(pharmacyId) {
  if (!pharmacyId) throw new Error('Pharmacy is required.');
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const [pharmacyRes, usersRes, activeUsersRes, branchesRes, productsRes, lowStockRes, todaySalesRes, monthSalesRes, expensesRes, lastSaleRes] = await Promise.all([
    supabase.from('pharmacies').select('*').eq('id', pharmacyId).single(),
    supabase.from('profiles').select('id,full_name,email,role,is_active,created_at', { count: 'exact' }).eq('pharmacy_id', pharmacyId).order('created_at', { ascending: false }).limit(12),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('pharmacy_id', pharmacyId).eq('is_active', true),
    supabase.from('branches').select('id,name,address,is_active,created_at', { count: 'exact' }).eq('pharmacy_id', pharmacyId).order('created_at', { ascending: true }),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('pharmacy_id', pharmacyId).eq('is_active', true),
    supabase.from('products').select('id,stock_boxes,low_stock_threshold').eq('pharmacy_id', pharmacyId).eq('is_active', true).limit(5000),
    supabase.from('sales').select('id,total_amount,created_at').eq('pharmacy_id', pharmacyId).eq('status', 'completed').gte('created_at', todayStart).lt('created_at', tomorrow).limit(5000),
    supabase.from('sales').select('id,total_amount,created_at').eq('pharmacy_id', pharmacyId).eq('status', 'completed').gte('created_at', monthStart).lt('created_at', tomorrow).limit(10000),
    supabase.from('expenses').select('id,amount,is_approved,expense_date').eq('pharmacy_id', pharmacyId).eq('is_approved', true).gte('expense_date', monthStart.slice(0,10)).lte('expense_date', tomorrow.slice(0,10)).limit(5000),
    supabase.from('sales').select('id,invoice_number,total_amount,created_at').eq('pharmacy_id', pharmacyId).eq('status', 'completed').order('created_at', { ascending: false }).limit(1)
  ]);

  for (const result of [pharmacyRes, usersRes, activeUsersRes, branchesRes, productsRes, lowStockRes, todaySalesRes, monthSalesRes, expensesRes, lastSaleRes]) {
    if (result.error) throw result.error;
  }

  const products = lowStockRes.data || [];
  const lowStock = products.filter(p => Number(p.stock_boxes || 0) <= Number(p.low_stock_threshold || 0)).length;
  const todaySales = todaySalesRes.data || [];
  const monthSales = monthSalesRes.data || [];
  const expenses = expensesRes.data || [];
  return {
    pharmacy: pharmacyRes.data,
    users: usersRes.data || [],
    branches: branchesRes.data || [],
    summary: {
      totalUsers: usersRes.count || 0,
      activeUsers: activeUsersRes.count || 0,
      branches: (branchesRes.data || []).filter(b => b.is_active !== false).length,
      products: productsRes.count || 0,
      lowStock,
      todayRevenue: todaySales.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
      todayTransactions: todaySales.length,
      monthRevenue: monthSales.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
      monthTransactions: monthSales.length,
      monthExpenses: expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      operatingBalance: monthSales.reduce((sum, row) => sum + Number(row.total_amount || 0), 0) - expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      lastSale: (lastSaleRes.data || [])[0] || null
    }
  };
}

function utcMidnight(timestamp) {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// ===================== SUPPLIERS =====================
export async function getSuppliers(pharmacyId) {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data;
}

export async function createSupplier(payload) {
  const { data, error } = await supabase.from('suppliers').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateSupplier(id, payload) {
  const { data, error } = await supabase.from('suppliers').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSupplier(id) {
  const { error } = await supabase.from('suppliers').update({ is_active: false }).eq('id', id);
  if (error) throw error;
}

export async function getSupplierPurchaseHistory(supplierId) {
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// ===================== PURCHASES (STOCK IN) =====================
export async function getPurchases(pharmacyId) {
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createPurchase(payload) {
  const purchaseNumber = `PO-${Date.now().toString().slice(-8)}`;
  const { data, error } = await supabase
    .from('purchases')
    .insert({ ...payload, purchase_number: purchaseNumber })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePurchase(id, payload) {
  const { data, error } = await supabase.from('purchases').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function getPurchaseDetails(purchaseId) {
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('id', purchaseId)
    .single();
  if (error) throw error;
  return data;
}

export async function createPurchaseItem(payload) {
  const { data, error } = await supabase.from('purchase_items').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function deletePurchaseItem(id) {
  const { error } = await supabase.from('purchase_items').delete().eq('id', id);
  if (error) throw error;
}

export async function processPurchase(purchaseId) {
  const { error } = await supabase.rpc('process_purchase', { p_purchase_id: purchaseId });
  if (error) throw error;
  return true;
}

// ===================== SALES RETURNS =====================
export async function getSalesReturns(pharmacyId) {
  const { data, error } = await supabase
    .from('sales_returns')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createSalesReturn(returnPayload, items) {
  const returnNumber = `RET-${Date.now().toString().slice(-8)}`;
  
  const { data: ret, error: retError } = await supabase
    .from('sales_returns')
    .insert({ ...returnPayload, return_number: returnNumber })
    .select()
    .single();
  if (retError) throw retError;

  const returnItems = items.map(item => ({
    return_id: ret.id,
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.quantity * item.unit_price
  }));

  const { error: itemsError } = await supabase.from('return_items').insert(returnItems);
  if (itemsError) throw itemsError;

  // Fetch original sale and items BEFORE making changes to calculate original quantity
  const { data: originalSale } = await supabase
    .from('sales')
    .select('total_amount, sale_items(*)')
    .eq('id', returnPayload.sale_id)
    .single();

  if (!originalSale) throw new Error('Sale not found');

  // Calculate original total quantity
  const originalSaleItems = originalSale.sale_items || [];
  const totalOriginalQty = originalSaleItems.reduce((sum, item) => sum + item.quantity, 0);

  // Restore stock for returned items and update sale_items quantities
  for (const item of items) {
    // Restore stock
    const { data: product } = await supabase.from('products').select('stock_boxes, stock_units, units_per_box').eq('id', item.product_id).single();
    if (product) {
      let totalUnits = (product.stock_boxes * product.units_per_box) + product.stock_units + item.quantity;
      const newBoxes = Math.floor(totalUnits / product.units_per_box);
      const newUnits = totalUnits % product.units_per_box;
      await supabase.from('products').update({ stock_boxes: newBoxes, stock_units: newUnits }).eq('id', item.product_id);

      await supabase.from('stock_logs').insert({
        product_id: item.product_id,
        product_name: item.product_name,
        change_type: 'restock',
        quantity_change: item.quantity,
        notes: `Return: ${ret.return_number}`,
        created_by: returnPayload.created_by,
        pharmacy_id: returnPayload.pharmacy_id
      });
    }

    // Update sale_items to reduce quantity for returned items
    const { data: saleItem } = await supabase
      .from('sale_items')
      .select('*')
      .eq('sale_id', returnPayload.sale_id)
      .eq('product_id', item.product_id)
      .single();

    if (saleItem) {
      const newQuantity = Math.max(0, saleItem.quantity - item.quantity);
      const newTotalPrice = newQuantity > 0 ? newQuantity * saleItem.unit_price : 0;
      
      if (newQuantity === 0) {
        // Delete the sale item if quantity becomes 0
        await supabase
          .from('sale_items')
          .delete()
          .eq('id', saleItem.id);
      } else {
        // Update with reduced quantity
        await supabase
          .from('sale_items')
          .update({
            quantity: newQuantity,
            total_price: newTotalPrice
          })
          .eq('id', saleItem.id);
      }
    }
  }

  // Check if this is a full return by comparing returned quantity with ORIGINAL quantity
  const totalReturnedQty = items.reduce((sum, item) => sum + item.quantity, 0);
  const isFullReturn = totalReturnedQty >= totalOriginalQty;

  // Delete the entire sale if all items are returned, otherwise update total
  if (isFullReturn) {
    // Delete the entire sale if all items are returned
    await supabase
      .from('sales')
      .delete()
      .eq('id', returnPayload.sale_id);
  } else {
    // Update sale with new total amount for partial returns
    const refundAmount = returnPayload.total_refund || 0;
    const newTotal = Math.max(0, (originalSale.total_amount || 0) - refundAmount);
    
    await supabase
      .from('sales')
      .update({
        total_amount: newTotal,
        status: 'completed'
      })
      .eq('id', returnPayload.sale_id);
  }

  return ret;
}

// ===================== ADVANCED RETURNS MANAGEMENT =====================
export async function processPartialReturn(returnId, saleId, returnedItems, refundAmount, newTotal) {
  const { error } = await supabase.rpc('process_partial_return', {
    p_return_id: returnId,
    p_sale_id: saleId,
    p_returned_items: returnedItems,
    p_refund_amount: refundAmount,
    p_new_total: newTotal
  });
  if (error) throw error;
  return true;
}

export async function processFullReturn(returnId, saleId, refundAmount) {
  const { error } = await supabase.rpc('process_full_return', {
    p_return_id: returnId,
    p_sale_id: saleId,
    p_refund_amount: refundAmount
  });
  if (error) throw error;
  return true;
}

export async function getBranchReturnStats(pharmacyId, branchId) {
  const { data, error } = await supabase.rpc('get_branch_return_stats', {
    p_pharmacy_id: pharmacyId,
    p_branch_id: branchId
  });
  if (error) throw error;
  return data?.[0] || {};
}

export async function getReturnAuditLog(pharmacyId, returnId = null, limit = 50) {
  let query = supabase
    .from('return_audit_log')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (returnId) query = query.eq('return_id', returnId);
  
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getReturnsByStatus(pharmacyId, status, branchId = null) {
  let query = supabase
    .from('sales_returns')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('status', status);
  
  if (branchId) query = query.eq('branch_id', branchId);
  
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getReturnsByType(pharmacyId, type, branchId = null) {
  let query = supabase
    .from('sales_returns')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('return_type', type);
  
  if (branchId) query = query.eq('branch_id', branchId);
  
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ===================== STOCK ADJUSTMENTS =====================
export async function getStockAdjustments(pharmacyId) {
  const { data, error } = await supabase
    .from('stock_adjustments')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createStockAdjustment(adjustment) {
  const { data: adj, error: adjError } = await supabase
    .from('stock_adjustments')
    .insert(adjustment)
    .select()
    .single();
  if (adjError) throw adjError;

  // Update product stock
  const { data: product } = await supabase.from('products').select('stock_boxes, stock_units, units_per_box').eq('id', adjustment.product_id).single();
  if (product) {
    let totalUnits = (product.stock_boxes * product.units_per_box) + product.stock_units + adjustment.adjustment_quantity;
    if (totalUnits < 0) totalUnits = 0;
    
    const newBoxes = Math.floor(totalUnits / product.units_per_box);
    const newUnits = totalUnits % product.units_per_box;
    await supabase.from('products').update({ stock_boxes: newBoxes, stock_units: newUnits }).eq('id', adjustment.product_id);
  }

  return adj;
}

// ===================== ALERTS =====================
export async function getAlerts(pharmacyId, unreadOnly = false, branchId = null) {
  let query = supabase
    .from('alerts')
    .select('*')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) query = query.eq('branch_id', branchId);
  if (unreadOnly) query = query.eq('is_read', false);
  
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createAlert(payload) {
  const { data, error } = await supabase.from('alerts').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function markAlertAsRead(id) {
  const { data, error } = await supabase
    .from('alerts')
    .update({ is_read: true })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error('Error marking alert as read:', error);
    throw error;
  }
  return data;
}

export async function markAllAlertsAsRead(pharmacyId) {
  const { data, error } = await supabase
    .from('alerts')
    .update({ is_read: true })
    .eq('pharmacy_id', pharmacyId)
    .eq('is_read', false)
    .select();
  if (error) {
    console.error('Error marking all alerts as read:', error);
    throw error;
  }
  return data;
}

export async function generateAlerts(pharmacyId) {
  // Get all active products
  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);

  if (!products) return;

  const today = new Date();

  for (const product of products) {
    try {
      // Check for low stock
      if (product.stock_boxes <= product.low_stock_threshold) {
        // Check if alert already exists (don't use .single() as it can throw 406 if no rows)
        const { data: existing } = await supabase
          .from('alerts')
          .select('id')
          .eq('product_id', product.id)
          .eq('alert_type', 'low_stock')
          .eq('is_read', false)
          .limit(1);

        if (!existing || existing.length === 0) {
          await createAlert({
            alert_type: product.stock_boxes === 0 ? 'out_of_stock' : 'low_stock',
            product_id: product.id,
            product_name: product.name,
            current_stock: product.stock_boxes,
            threshold_value: product.low_stock_threshold,
            pharmacy_id: pharmacyId,
            branch_id: product.branch_id
          });
        }
      }

      // Check for expiry
      if (product.expiry_date) {
        const expiryDate = new Date(product.expiry_date);
        const daysToExpiry = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));

        if (daysToExpiry < 0) {
          // Expired
          const { data: existing } = await supabase
            .from('alerts')
            .select('id')
            .eq('product_id', product.id)
            .eq('alert_type', 'expiry')
            .eq('is_read', false)
            .limit(1);

          if (!existing || existing.length === 0) {
            await createAlert({
              alert_type: 'expiry',
              product_id: product.id,
              product_name: product.name,
              days_to_expiry: 0,
              pharmacy_id: pharmacyId,
              branch_id: product.branch_id
            });
          }
        } else if (daysToExpiry <= 30) {
          // Expiring soon
          const { data: existing } = await supabase
            .from('alerts')
            .select('id')
            .eq('product_id', product.id)
            .eq('alert_type', 'expiry_30_days')
            .eq('is_read', false)
            .limit(1);

          if (!existing || existing.length === 0) {
            await createAlert({
              alert_type: 'expiry_30_days',
              product_id: product.id,
              product_name: product.name,
              days_to_expiry: daysToExpiry,
              pharmacy_id: pharmacyId,
            branch_id: product.branch_id
            });
          }
        }
      }
    } catch (err) {
      console.error('Error generating alerts for product', product.id, err);
      // Continue with next product instead of failing entirely
    }
  }
}

// ===================== BRANCH MANAGEMENT =====================
export async function updateBranchDetails(branchId, payload) {
  const { data, error } = await supabase.from('branches').update(payload).eq('id', branchId).select().single();
  if (error) throw error;
  return data;
}

export async function getBranchDetails(branchId) {
  const { data, error } = await supabase.from('branches').select('*').eq('id', branchId).single();
  if (error) throw error;
  return data;
}

export async function getBranchDashboard(branchId, pharmacyId) {
  const alertsCountQuery = supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('pharmacy_id', pharmacyId)
    .eq('branch_id', branchId)
    .eq('is_read', false);

  // Keep the branch overview lightweight and reusable by both the Branches list
  // and Branch Details. Sales totals are aggregated server-side, while inventory
  // and staff/expense summaries return only the fields needed by the dashboard.
  const staffCountQuery = supabase
    .from('staff_branch_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('pharmacy_id', pharmacyId)
    .eq('branch_id', branchId)
    .eq('is_active', true);

  const [salesStats, inventorySummary, alertsResult, staffResult, expenseReport] = await Promise.all([
    getSalesStats(pharmacyId, branchId),
    getInventorySummary(pharmacyId, branchId),
    alertsCountQuery,
    staffCountQuery,
    getMonthlyExpenseReport(pharmacyId, branchId)
  ]);

  if (alertsResult.error) throw alertsResult.error;
  if (staffResult.error) throw staffResult.error;

  const monthlyExpenses = Number(expenseReport?.totalExpenses || 0);
  return {
    dailySales: Number(salesStats.todayRevenue || 0),
    weeklyRevenue: Number(salesStats.weekRevenue || 0),
    monthlyRevenue: Number(salesStats.monthRevenue || 0),
    todayTransactions: Number(salesStats.todayTransactions || 0),
    totalTransactions: Number(salesStats.totalTransactions || 0),
    staffCount: Number(staffResult.count || 0),
    totalProducts: Number(inventorySummary.totalProducts || 0),
    lowStockCount: Number(inventorySummary.lowStockCount || 0),
    expiredCount: Number(inventorySummary.expiredCount || 0),
    expiringSoonCount: Number(inventorySummary.expiringSoonCount || 0),
    alertCount: Number(alertsResult.count || 0),
    monthlyExpenses,
    operatingBalance: Number(salesStats.monthRevenue || 0) - monthlyExpenses
  };
}

/**
 * Return per-staff sales totals for a branch without downloading every sale to
 * the browser. The RPC performs grouping and aggregation in PostgreSQL.
 */
export async function getBranchStaffSalesStats(pharmacyId, branchId) {
  const { data, error } = await supabase.rpc('get_branch_staff_sales_stats', {
    p_pharmacy_id: pharmacyId,
    p_branch_id: branchId
  });

  if (!error) {
    return (data || []).map(row => ({
      staffId: row.staff_id,
      dailyTotal: Number(row.daily_total || 0),
      dailyCount: Number(row.daily_count || 0),
      total: Number(row.total_revenue || 0),
      count: Number(row.total_count || 0)
    }));
  }

  const missingRpc = error.code === 'PGRST202' || (
    /get_branch_staff_sales_stats/i.test(error.message || '') &&
    /not found|does not exist|schema cache/i.test(error.message || '')
  );
  if (!missingRpc) throw error;

  console.warn('get_branch_staff_sales_stats RPC is not available yet; using reduced-egress fallback. Apply the latest Supabase migrations.');

  const todayRange = await getTodayDateRange(pharmacyId);
  const { data: sales, error: fallbackError } = await supabase
    .from('sales')
    .select('created_by, total_amount, created_at')
    .eq('pharmacy_id', pharmacyId)
    .eq('branch_id', branchId)
    .eq('status', 'completed');

  if (fallbackError) throw fallbackError;

  const byStaff = new Map();
  for (const sale of sales || []) {
    if (!sale.created_by) continue;
    const existing = byStaff.get(sale.created_by) || {
      staffId: sale.created_by,
      dailyTotal: 0,
      dailyCount: 0,
      total: 0,
      count: 0
    };

    const amount = Number(sale.total_amount || 0);
    existing.total += amount;
    existing.count += 1;

    if (sale.created_at >= todayRange.start && sale.created_at < todayRange.end) {
      existing.dailyTotal += amount;
      existing.dailyCount += 1;
    }

    byStaff.set(sale.created_by, existing);
  }

  return [...byStaff.values()];
}

// ===================== STAFF BRANCH ASSIGNMENTS =====================
export async function assignStaffToBranch(staffId, branchId, pharmacyId, roleInBranch) {
  const { data, error } = await supabase
    .from('staff_branch_assignments')
    .insert({ staff_id: staffId, branch_id: branchId, pharmacy_id: pharmacyId, role_in_branch: roleInBranch })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getBranchAssignments(branchId) {
  const { data, error } = await supabase
    .from('staff_branch_assignments')
    .select('*')
    .eq('branch_id', branchId)
    .eq('is_active', true);
  if (error) throw error;
  
  // Manually fetch staff names from profiles using staff_id
  if (data && data.length > 0) {
    const staffIds = data.map(d => d.staff_id);
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active')
      .in('id', staffIds);
    
    if (!profileError && profiles) {
      const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
      return data.map(assignment => ({
        ...assignment,
        profiles: profileMap[assignment.staff_id] || { full_name: 'Unknown', email: '' }
      }));
    }
  }
  
  return data;
}

export async function getStaffBranch(staffId) {
  const { data, error } = await supabase
    .from('staff_branch_assignments')
    .select('branch_id')
    .eq('staff_id', staffId)
    .eq('is_active', true);
  
  if (error) throw error;
  
  // Return the first (and should be only) branch assignment
  return data && data.length > 0 ? data[0].branch_id : null;
}

export async function updateStaffAssignment(assignmentId, payload) {
  const { data, error } = await supabase
    .from('staff_branch_assignments')
    .update(payload)
    .eq('id', assignmentId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPharmacyStaff(pharmacyId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);
  if (error) throw error;
  return data;
}


/**
 * Return only active salesmen for employee sales reporting.
 * Keeping the role filter in the database query prevents admin, inventory
 * manager and other private roles from appearing in the Sales Reports picker.
 */
export async function getPharmacySalesmen(pharmacyId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('pharmacy_id', pharmacyId)
    .eq('role', 'salesman')
    .eq('is_active', true)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function removeStaffFromBranch(assignmentId) {
  const { data, error } = await supabase
    .from('staff_branch_assignments')
    .update({ is_active: false })
    .eq('id', assignmentId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================== STAFF PERFORMANCE =====================
export async function getStaffPerformance(pharmacyId, branchId = null, periodDate = null) {
  let query = supabase
    .from('staff_performance')
    .select('*, profiles(full_name, email)')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) query = query.eq('branch_id', branchId);
  if (periodDate) query = query.eq('period_date', periodDate);
  else query = query.eq('period_date', new Date().toISOString().split('T')[0]);
  
  const { data, error } = await query.order('total_sales', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getStaffPerformanceHistory(staffId, days = 30) {
  const { data, error } = await supabase
    .from('staff_performance')
    .select('*')
    .eq('staff_id', staffId)
    .gte('period_date', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .order('period_date', { ascending: false });
  if (error) throw error;
  return data;
}

// ===================== BRANCH STOCK TRANSFERS =====================
export async function getBranchTransfers(pharmacyId, branchId = null) {
  let query = supabase
    .from('branch_stock_transfers')
    .select('*')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) {
    // Get transfers where this branch is either sender or receiver
    const { data: fromBranch } = await query.eq('from_branch_id', branchId).order('created_at', { ascending: false });
    const { data: toBranch } = await supabase
      .from('branch_stock_transfers')
      .select('*')
      .eq('pharmacy_id', pharmacyId)
      .eq('to_branch_id', branchId)
      .order('created_at', { ascending: false });
    
    const data = [...(fromBranch || []), ...(toBranch || [])];
    const uniqueData = Array.from(new Map(data.map(item => [item.id, item])).values());
    return uniqueData.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createStockTransfer(payload) {
  const { data, error } = await supabase
    .from('branch_stock_transfers')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function addTransferItem(payload) {
  const { data, error } = await supabase
    .from('branch_transfer_items')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getTransferDetails(transferId) {
  const { data, error } = await supabase
    .from('branch_stock_transfers')
    .select('*, branch_transfer_items(*)')
    .eq('id', transferId)
    .single();
  if (error) throw error;
  return data;
}

export async function processStockTransfer(transferId) {
  const { error } = await supabase.rpc('process_branch_transfer', { p_transfer_id: transferId });
  if (error) throw error;
  return true;
}

// ===================== PATIENTS =====================
export async function getPatients(pharmacyId, branchId = null) {
  let query = supabase
    .from('patients')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);
  
  if (branchId) query = query.eq('branch_id', branchId);
  
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data;
}

export async function searchPatients(pharmacyId, searchTerm) {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .or(`name.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%,patient_id_number.ilike.%${searchTerm}%`)
    .limit(10);
  if (error) throw error;
  return data;
}

export async function createPatient(payload) {
  const { data, error } = await supabase
    .from('patients')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePatient(patientId, payload) {
  const { data, error } = await supabase
    .from('patients')
    .update(payload)
    .eq('id', patientId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPatientDetails(patientId) {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .eq('id', patientId)
    .single();
  if (error) throw error;
  return data;
}

// ===================== PATIENT VISITS (WITH DOCTOR TRACKING) =====================
export async function getPatientVisits(patientId) {
  const { data, error } = await supabase
    .from('patient_visits')
    .select('*')
    .eq('patient_id', patientId)
    .order('visit_date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createPatientVisit(payload) {
  const { data, error } = await supabase
    .from('patient_visits')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePatientVisit(visitId, payload) {
  const { data, error } = await supabase
    .from('patient_visits')
    .update(payload)
    .eq('id', visitId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================== TREATMENT PAYMENTS (CLINIC REVENUE) =====================
export async function getTreatmentPayments(patientId = null, pharmacyId = null) {
  let query = supabase
    .from('treatment_payments')
    .select('*, patient_visits(symptoms, diagnosis, doctor_name, doctor_specialty)')
    .order('payment_date', { ascending: false });
  
  if (patientId) query = query.eq('patient_id', patientId);
  if (pharmacyId) query = query.eq('pharmacy_id', pharmacyId);
  
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createTreatmentPayment(payload) {
  // Payload: { visit_id, patient_id, amount, payment_method, description, recorded_by, branch_id, pharmacy_id }
  const { data, error } = await supabase
    .from('treatment_payments')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTreatmentPayment(paymentId, payload) {
  const { data, error } = await supabase
    .from('treatment_payments')
    .update(payload)
    .eq('id', paymentId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTreatmentPayment(paymentId) {
  const { error } = await supabase
    .from('treatment_payments')
    .delete()
    .eq('id', paymentId);
  if (error) throw error;
  return true;
}

export async function getTreatmentPaymentsReport(pharmacyId, branchId = null, startDate = null, endDate = null) {
  // Get aggregated treatment payment data for reporting
  let query = supabase
    .from('treatment_payments')
    .select('*')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) query = query.eq('branch_id', branchId);
  if (startDate) query = query.gte('payment_date', startDate);
  if (endDate) query = query.lte('payment_date', endDate);
  
  const { data, error } = await query.order('payment_date', { ascending: false });
  if (error) throw error;
  
  // Calculate totals by payment method
  const totals = {};
  let grandTotal = 0;
  data.forEach(payment => {
    const method = payment.payment_method;
    totals[method] = (totals[method] || 0) + parseFloat(payment.amount);
    grandTotal += parseFloat(payment.amount);
  });
  
  return { payments: data, totals, grandTotal, count: data.length };
}

// ===================== DAILY SALES REPORTS =====================
export async function generateDailySalesReport(pharmacyId, branchId, reportDate) {
  const { error } = await supabase.rpc('generate_daily_sales_report', {
    p_pharmacy_id: pharmacyId,
    p_branch_id: branchId,
    p_report_date: reportDate
  });
  if (error) throw error;
  return true;
}

function isDailyClosingSchemaMissing(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42703' || code === 'PGRST204' || message.includes('closing_status') || message.includes('total_transactions');
}

function applyDailyReportFilters(query, { branchId = null, startDate = null, endDate = null } = {}) {
  let next = query;
  if (branchId) next = next.eq('branch_id', branchId);
  if (startDate) next = next.gte('report_date', startDate);
  if (endDate) next = next.lte('report_date', endDate);
  return next;
}

/**
 * Load a lightweight page of daily records without downloading sales_data JSON
 * for every day. Full transaction detail is fetched only when View Details is
 * opened, which keeps this workspace fast even after years of reports.
 */
export async function getDailyReportsPage(pharmacyId, {
  branchId = null,
  page = 1,
  pageSize = 30,
  startDate = null,
  endDate = null
} = {}) {
  const safePageSize = [25, 30, 50].includes(Number(pageSize)) ? Number(pageSize) : 30;
  const safePage = Math.max(1, Number(page) || 1);
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;

  const richColumns = [
    'id','pharmacy_id','branch_id','report_date','total_sales','total_items_sold',
    'payment_breakdown','created_at','updated_at','total_transactions',
    'approved_expenses','recorded_returns','return_count','closing_status','closed_at'
  ].join(',');
  const legacyColumns = 'id,pharmacy_id,branch_id,report_date,total_sales,total_items_sold,payment_breakdown,created_at,updated_at';

  const run = async (columns) => {
    let query = supabase
      .from('daily_sales_reports')
      .select(columns, { count: 'exact' })
      .eq('pharmacy_id', pharmacyId)
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false });
    query = applyDailyReportFilters(query, { branchId, startDate, endDate });
    return query.range(from, to);
  };

  let result = await run(richColumns);
  let closingReady = true;
  if (result.error && isDailyClosingSchemaMissing(result.error)) {
    closingReady = false;
    result = await run(legacyColumns);
  }
  if (result.error) throw result.error;

  const total = Number(result.count || 0);
  return {
    data: (result.data || []).map((row) => ({
      ...row,
      total_transactions: Number(row.total_transactions ?? 0),
      approved_expenses: Number(row.approved_expenses ?? 0),
      recorded_returns: Number(row.recorded_returns ?? 0),
      return_count: Number(row.return_count ?? 0),
      closing_status: row.closing_status || 'open'
    })),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    closingReady
  };
}

/**
 * Aggregate the filtered daily-record range using narrow columns only. The
 * fallback remains compatible with installations that have not yet applied the
 * daily-closing migration.
 */
export async function getDailyReportsSummary(pharmacyId, {
  branchId = null,
  startDate = null,
  endDate = null
} = {}) {
  const chunkSize = 1000;

  const loadRows = async (rich = true) => {
    const columns = rich
      ? 'total_sales,total_items_sold,total_transactions,approved_expenses,recorded_returns,closing_status,report_date'
      : 'total_sales,total_items_sold,report_date';
    const rows = [];
    let offset = 0;

    while (true) {
      let query = supabase
        .from('daily_sales_reports')
        .select(columns)
        .eq('pharmacy_id', pharmacyId)
        .order('report_date', { ascending: false });
      query = applyDailyReportFilters(query, { branchId, startDate, endDate });
      const { data, error } = await query.range(offset, offset + chunkSize - 1);
      if (error) return { rows: [], error };
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < chunkSize) return { rows, error: null };
      offset += chunkSize;
    }
  };

  let result = await loadRows(true);
  let closingReady = true;
  if (result.error && isDailyClosingSchemaMissing(result.error)) {
    closingReady = false;
    result = await loadRows(false);
  }
  if (result.error) throw result.error;

  return result.rows.reduce((summary, row) => {
    summary.totalReports += 1;
    summary.totalRevenue += Number(row.total_sales || 0);
    summary.totalItems += Number(row.total_items_sold || 0);
    summary.totalTransactions += Number(row.total_transactions || 0);
    summary.approvedExpenses += Number(row.approved_expenses || 0);
    summary.recordedReturns += Number(row.recorded_returns || 0);
    if (row.closing_status === 'closed') summary.closedDays += 1;
    else summary.openDays += 1;
    return summary;
  }, {
    totalReports: 0,
    totalRevenue: 0,
    totalItems: 0,
    totalTransactions: 0,
    approvedExpenses: 0,
    recordedReturns: 0,
    closedDays: 0,
    openDays: 0,
    closingReady
  });
}

export async function getDailyReports(pharmacyId, branchId = null, limit = 30, offset = 0) {
  const { data, error } = await supabase.rpc('get_daily_reports', {
    p_pharmacy_id: pharmacyId,
    p_branch_id: branchId,
    p_limit: limit,
    p_offset: offset
  });
  if (error) throw error;
  return data || [];
}

export async function getDailyReportsByDateRange(pharmacyId, branchId = null, startDate = null, endDate = null) {
  let query = supabase
    .from('daily_sales_reports')
    .select('*')
    .eq('pharmacy_id', pharmacyId);

  if (branchId) query = query.eq('branch_id', branchId);
  if (startDate) query = query.gte('report_date', startDate);
  if (endDate) query = query.lte('report_date', endDate);

  const { data, error } = await query.order('report_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getDailyReportDetail(reportId) {
  const { data, error } = await supabase
    .from('daily_sales_reports')
    .select('*')
    .eq('id', reportId)
    .single();
  if (error) throw error;
  return data;
}

export async function getDailyClosingCapability() {
  const { error } = await supabase
    .from('daily_sales_reports')
    .select('closing_status')
    .limit(1);
  if (!error) return { ready: true };
  if (isDailyClosingSchemaMissing(error)) return { ready: false };
  throw error;
}

export async function saveDailyCashClosing(reportId, {
  openingCash = 0,
  actualCash = 0,
  notes = ''
} = {}) {
  const { data, error } = await supabase.rpc('close_daily_sales_report', {
    p_report_id: reportId,
    p_opening_cash: Number(openingCash || 0),
    p_actual_cash: Number(actualCash || 0),
    p_notes: notes || null
  });

  if (error) {
    const missingRpc = ['PGRST202', '42883'].includes(String(error.code || ''))
      || /close_daily_sales_report/i.test(String(error.message || ''));
    if (missingRpc) {
      const migrationError = new Error('Daily cash closing requires the latest Supabase daily-records migration.');
      migrationError.code = 'DAILY_CLOSING_MIGRATION_REQUIRED';
      throw migrationError;
    }
    throw error;
  }
  return data;
}


// ===================== PRESCRIPTIONS =====================
export async function getPrescriptions(pharmacyId, patientId = null, status = 'active') {
  let query = supabase
    .from('prescriptions')
    .select('*, patients(name, phone)')
    .eq('pharmacy_id', pharmacyId)
    .eq('status', status);
  
  if (patientId) query = query.eq('patient_id', patientId);
  
  const { data, error } = await query.order('prescribed_date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createPrescription(payload) {
  const { data, error } = await supabase
    .from('prescriptions')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePrescription(prescriptionId, payload) {
  const { data, error } = await supabase
    .from('prescriptions')
    .update(payload)
    .eq('id', prescriptionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fillPrescription(prescriptionId, saleId) {
  const { data, error } = await supabase
    .from('prescription_sales')
    .insert({ prescription_id: prescriptionId, sale_id: saleId })
    .select()
    .single();
  if (error) throw error;
  
  // Update prescription status
  await updatePrescription(prescriptionId, { status: 'filled' });
  return data;
}

export async function getPrescriptionHistory(patientId) {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('*, prescription_sales(sale_id, filled_date, refill_number)')
    .eq('patient_id', patientId)
    .order('prescribed_date', { ascending: false });
  if (error) throw error;
  return data;
}

// ===================== EXPENSES =====================
// ===================== EXPENSE CATEGORIES (ADMIN MANAGED) =====================
export async function getExpenseCategories(pharmacyId) {
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .order('category_name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getAllExpenseCategories(pharmacyId) {
  // Admin can see all categories including inactive ones
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('category_name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createExpenseCategory(payload) {
  // payload: { pharmacy_id, category_name, description }
  const { data, error } = await supabase
    .from('expense_categories')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateExpenseCategory(categoryId, payload) {
  const { data, error } = await supabase
    .from('expense_categories')
    .update(payload)
    .eq('id', categoryId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteExpenseCategory(categoryId) {
  const { error } = await supabase
    .from('expense_categories')
    .delete()
    .eq('id', categoryId);
  if (error) throw error;
  return true;
}

// ===================== EXPENSES =====================
export async function getExpenses(pharmacyId, branchId = null, startDate = null, endDate = null) {
  let query = supabase
    .from('expenses')
    .select('*, expense_categories(category_name, description)')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) query = query.eq('branch_id', branchId);
  if (startDate) query = query.gte('expense_date', startDate);
  if (endDate) query = query.lte('expense_date', endDate);
  
  const { data, error } = await query.order('expense_date', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Load a single page of branch/pharmacy expenses without downloading the full
 * expense ledger. Used by Branch Details now and by the main Expense workspace
 * upgrade later.
 */
export async function getExpensesPage(pharmacyId, {
  branchId = null,
  page = 1,
  pageSize = 30,
  startDate = null,
  endDate = null,
  categoryId = null,
  paymentMethod = null,
  status = 'all',
  search = ''
} = {}) {
  const safePageSize = [25, 30, 50].includes(Number(pageSize)) ? Number(pageSize) : 30;
  const safePage = Math.max(1, Number(page) || 1);
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;
  const normalizedSearch = String(search || '').trim().replace(/[,%()]/g, ' ').replace(/\s+/g, ' ');

  let query = supabase
    .from('expenses')
    .select('*, expense_categories(category_name, description), branches(name)', { count: 'exact' })
    .eq('pharmacy_id', pharmacyId)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (branchId) query = query.eq('branch_id', branchId);
  if (startDate) query = query.gte('expense_date', startDate);
  if (endDate) query = query.lte('expense_date', endDate);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (paymentMethod) query = query.eq('payment_method', paymentMethod);
  if (status === 'approved') query = query.eq('is_approved', true);
  if (status === 'pending') query = query.eq('is_approved', false);
  if (normalizedSearch) {
    const pattern = `%${normalizedSearch}%`;
    query = query.or(`description.ilike.${pattern},receipt_number.ilike.${pattern},notes.ilike.${pattern}`);
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;

  const total = Number(count || 0);
  return {
    data: data || [],
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize))
  };
}

/**
 * Aggregate expense totals without loading the full expense rows into the UI.
 * The helper requests only the narrow columns required for analytics and pages
 * through them in 1,000-row chunks so large ledgers remain accurate.
 */
export async function getExpenseFilteredSummary(pharmacyId, {
  branchId = null,
  startDate = null,
  endDate = null,
  categoryId = null,
  paymentMethod = null,
  status = 'all',
  search = ''
} = {}) {
  const normalizedSearch = String(search || '').trim().replace(/[,%()]/g, ' ').replace(/\s+/g, ' ');

  const { data: rpcData, error: rpcError } = await supabase.rpc('get_expense_filtered_summary', {
    p_pharmacy_id: pharmacyId,
    p_branch_id: branchId || null,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
    p_category_id: categoryId || null,
    p_payment_method: paymentMethod || null,
    p_status: status || 'all',
    p_search: normalizedSearch || null
  });
  if (!rpcError && rpcData) {
    return {
      totalAmount: Number(rpcData.totalAmount || 0),
      approvedAmount: Number(rpcData.approvedAmount || 0),
      pendingAmount: Number(rpcData.pendingAmount || 0),
      count: Number(rpcData.count || 0),
      approvedCount: Number(rpcData.approvedCount || 0),
      pendingCount: Number(rpcData.pendingCount || 0),
      paymentBreakdown: rpcData.paymentBreakdown || {},
      categoryBreakdown: rpcData.categoryBreakdown || {}
    };
  }

  const missingRpc = ['PGRST202', '42883'].includes(String(rpcError?.code || ''))
    || String(rpcError?.message || '').toLowerCase().includes('get_expense_filtered_summary');
  if (rpcError && !missingRpc) throw rpcError;

  const chunkSize = 1000;
  let offset = 0;
  const rows = [];

  while (true) {
    let query = supabase
      .from('expenses')
      .select('amount,payment_method,is_approved,category_id,expense_categories(category_name)')
      .eq('pharmacy_id', pharmacyId)
      .order('expense_date', { ascending: false });

    if (branchId) query = query.eq('branch_id', branchId);
    if (startDate) query = query.gte('expense_date', startDate);
    if (endDate) query = query.lte('expense_date', endDate);
    if (categoryId) query = query.eq('category_id', categoryId);
    if (paymentMethod) query = query.eq('payment_method', paymentMethod);
    if (status === 'approved') query = query.eq('is_approved', true);
    if (status === 'pending') query = query.eq('is_approved', false);
    if (normalizedSearch) {
      const pattern = `%${normalizedSearch}%`;
      query = query.or(`description.ilike.${pattern},receipt_number.ilike.${pattern},notes.ilike.${pattern}`);
    }

    const { data, error } = await query.range(offset, offset + chunkSize - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < chunkSize) break;
    offset += chunkSize;
  }

  const paymentBreakdown = {};
  const categoryBreakdown = {};
  let totalAmount = 0;
  let approvedAmount = 0;
  let pendingAmount = 0;
  let approvedCount = 0;
  let pendingCount = 0;

  rows.forEach((row) => {
    const amount = Number(row.amount || 0);
    totalAmount += amount;
    if (row.is_approved) {
      approvedAmount += amount;
      approvedCount += 1;
    } else {
      pendingAmount += amount;
      pendingCount += 1;
    }
    const method = row.payment_method || 'other';
    paymentBreakdown[method] = (paymentBreakdown[method] || 0) + amount;
    const category = row.expense_categories?.category_name || 'Uncategorized';
    categoryBreakdown[category] = (categoryBreakdown[category] || 0) + amount;
  });

  return {
    totalAmount,
    approvedAmount,
    pendingAmount,
    count: rows.length,
    approvedCount,
    pendingCount,
    paymentBreakdown,
    categoryBreakdown
  };
}

export async function getExpenseCreatorProfiles(userIds = []) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('profiles')
    .select('id,full_name,email,role')
    .in('id', ids);
  if (error) throw error;
  return Object.fromEntries((data || []).map((profile) => [profile.id, profile]));
}

export async function createExpense(payload) {
  const { data, error } = await supabase
    .from('expenses')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateExpense(expenseId, payload) {
  const { data, error } = await supabase
    .from('expenses')
    .update(payload)
    .eq('id', expenseId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteExpense(expenseId) {
  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId);
  if (error) throw error;
  return true;
}

const isMissingExpenseFeature = (error) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return ['42P01', '42703', 'PGRST202', 'PGRST205'].includes(code)
    || message.includes('recurring_expenses')
    || message.includes('expense_attachments')
    || message.includes('expense-receipts');
};

export async function getRecurringExpenses(pharmacyId) {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .select('*, expense_categories(category_name), branches(name)')
    .eq('pharmacy_id', pharmacyId)
    .order('next_due_date', { ascending: true });
  if (error) {
    if (isMissingExpenseFeature(error)) return { supported: false, data: [] };
    throw error;
  }
  return { supported: true, data: data || [] };
}

export async function createRecurringExpense(payload) {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRecurringExpense(id, payload) {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRecurringExpense(id) {
  const { error } = await supabase
    .from('recurring_expenses')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}

export async function getExpenseAttachments(expenseId) {
  const { data, error } = await supabase
    .from('expense_attachments')
    .select('*')
    .eq('expense_id', expenseId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingExpenseFeature(error)) return { supported: false, data: [] };
    throw error;
  }
  return { supported: true, data: data || [] };
}

export async function uploadExpenseAttachment({ expenseId, pharmacyId, file, userId }) {
  if (!file) throw new Error('Choose a receipt file first.');
  const safeName = String(file.name || 'receipt')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'receipt';
  const filePath = `${pharmacyId}/${expenseId}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from('expense-receipts')
    .upload(filePath, file, { upsert: false, contentType: file.type || undefined });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('expense_attachments')
    .insert({
      expense_id: expenseId,
      pharmacy_id: pharmacyId,
      file_path: filePath,
      file_name: file.name || safeName,
      mime_type: file.type || null,
      size_bytes: Number(file.size || 0),
      uploaded_by: userId || null
    })
    .select()
    .single();

  if (error) {
    await supabase.storage.from('expense-receipts').remove([filePath]);
    throw error;
  }
  return data;
}

export async function getExpenseAttachmentUrl(filePath, expiresIn = 300) {
  const { data, error } = await supabase.storage
    .from('expense-receipts')
    .createSignedUrl(filePath, expiresIn);
  if (error) throw error;
  return data?.signedUrl || null;
}

export async function deleteExpenseAttachment(attachment) {
  if (!attachment?.id) throw new Error('Attachment not found.');
  if (attachment.file_path) {
    const { error: storageError } = await supabase.storage
      .from('expense-receipts')
      .remove([attachment.file_path]);
    if (storageError) throw storageError;
  }
  const { error } = await supabase
    .from('expense_attachments')
    .delete()
    .eq('id', attachment.id);
  if (error) throw error;
  return true;
}

export async function approveExpense(expenseId, approvedBy) {
  const { data, error } = await supabase
    .from('expenses')
    .update({ is_approved: true, approved_by: approvedBy })
    .eq('id', expenseId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getExpenseReport(pharmacyId, branchId = null, startDate, endDate) {
  const expenses = await getExpenses(pharmacyId, branchId, startDate, endDate);
  
  // Group by category name
  const byCategory = {};
  expenses.forEach(exp => {
    const categoryName = exp.expense_categories?.category_name || 'Uncategorized';
    if (!byCategory[categoryName]) byCategory[categoryName] = 0;
    byCategory[categoryName] += parseFloat(exp.amount);
  });
  
  const totalExpenses = Object.values(byCategory).reduce((sum, val) => sum + val, 0);
  
  return { byCategory, totalExpenses, count: expenses.length };
}

export async function getMonthlyExpenseReport(pharmacyId, branchId = null) {
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];
  
  return getExpenseReport(pharmacyId, branchId, startDate, endDate);
}

export async function calculateNetProfit(pharmacyId, branchId = null, startDate, endDate) {
  // Get revenue
  let salesQuery = supabase
    .from('sales')
    .select('total_amount')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) salesQuery = salesQuery.eq('branch_id', branchId);
  if (startDate) salesQuery = salesQuery.gte('created_at', startDate);
  if (endDate) salesQuery = salesQuery.lte('created_at', endDate);
  
  const { data: salesData } = await salesQuery;
  const revenue = salesData?.reduce((sum, sale) => sum + sale.total_amount, 0) || 0;
  
  // Get COGS (cost of goods sold)
  let costQuery = supabase
    .from('sale_items')
    .select('sale_id, product_id(cost_price), quantity')
    .neq('product_id', null);
  
  const { data: costData } = await costQuery;
  let cogs = 0;
  if (costData) {
    cogs = costData.reduce((sum, item) => sum + (item.quantity * (item.product_id?.cost_price || 0)), 0);
  }
  
  // Get expenses
  const expenseReport = await getExpenseReport(pharmacyId, branchId, startDate, endDate);
  const totalExpenses = expenseReport.totalExpenses;
  
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - totalExpenses;
  const profitMargin = revenue > 0 ? ((netProfit / revenue) * 100).toFixed(2) : 0;
  
  return {
    revenue,
    cogs,
    grossProfit,
    totalExpenses,
    netProfit,
    profitMargin
  };
}


// ===================== MANAGEMENT REPORTS & ANALYTICS =====================

/**
 * Build a period-based management report from completed sales and approved
 * expenses. COGS is explicitly an estimate because sale_items do not yet store
 * the historical cost-at-sale; the current product cost_price is used instead.
 */
export async function getManagementReportAnalytics(pharmacyId, {
  branchId = null,
  salesStart = null,
  salesEnd = null,
  expenseStart = null,
  expenseEnd = null
} = {}) {
  const rawSales = await getSalesForReport(pharmacyId, {
    branchId,
    start: salesStart,
    end: salesEnd
  });
  const sales = await enrichSalesWithItems(rawSales || []);

  const productIds = [...new Set(
    sales.flatMap((sale) => sale.sale_items || [])
      .map((item) => item.product_id)
      .filter(Boolean)
  )];

  const productCostById = {};
  const productMetaById = {};
  const batchSize = 200;
  for (let i = 0; i < productIds.length; i += batchSize) {
    const batch = productIds.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from('products')
      .select('id,name,cost_price,price,units_per_box')
      .eq('pharmacy_id', pharmacyId)
      .in('id', batch);
    if (error) throw error;
    (data || []).forEach((product) => {
      productCostById[product.id] = Number(product.cost_price || 0) / Math.max(1, Number(product.units_per_box || 1));
      productMetaById[product.id] = product;
    });
  }

  let revenue = 0;
  let estimatedCogs = 0;
  let itemUnits = 0;
  let totalDiscount = 0;
  const paymentBreakdown = {};
  const productSales = {};
  const dailyRevenue = {};

  for (const sale of sales) {
    const amount = Number(sale.total_amount || 0);
    revenue += amount;
    totalDiscount += Number(sale.discount || 0);
    const method = sale.payment_method || 'other';
    paymentBreakdown[method] = (paymentBreakdown[method] || 0) + amount;

    const dayKey = String(sale.created_at || '').slice(0, 10);
    if (dayKey) dailyRevenue[dayKey] = (dailyRevenue[dayKey] || 0) + amount;

    for (const item of sale.sale_items || []) {
      const qty = Number(item.quantity || 0);
      itemUnits += qty;
      const itemRevenue = Number(item.total_price || 0);
      const name = item.product_name || productMetaById[item.product_id]?.name || 'Unknown product';
      if (!productSales[name]) productSales[name] = { quantity: 0, revenue: 0 };
      productSales[name].quantity += qty;
      productSales[name].revenue += itemRevenue;

      // NOTE: This is only an estimate until cost-at-sale is persisted per line.
      // Sale quantities are treated as individual units, so current container cost
      // is prorated by units_per_box before applying quantity.
      estimatedCogs += qty * Number(productCostById[item.product_id] || 0);
    }
  }

  const expenseSummary = await getExpenseFilteredSummary(pharmacyId, {
    branchId,
    startDate: expenseStart,
    endDate: expenseEnd,
    status: 'approved'
  });
  const approvedExpenses = Number(expenseSummary.approvedAmount || 0);
  const estimatedGrossProfit = revenue - estimatedCogs;
  const estimatedNetResult = estimatedGrossProfit - approvedExpenses;

  const topProducts = Object.entries(productSales)
    .map(([name, values]) => ({ name, ...values }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return {
    revenue,
    transactions: sales.length,
    averageSale: sales.length ? revenue / sales.length : 0,
    itemUnits,
    totalDiscount,
    paymentBreakdown,
    dailyRevenue,
    topProducts,
    estimatedCogs,
    estimatedGrossProfit,
    approvedExpenses,
    estimatedNetResult,
    estimatedGrossMargin: revenue ? (estimatedGrossProfit / revenue) * 100 : 0,
    estimatedNetMargin: revenue ? (estimatedNetResult / revenue) * 100 : 0,
    cogsMethod: 'current_product_cost'
  };
}

/**
 * Inventory analytics using only the columns required for management reporting.
 * Values are estimates based on the current product cost/selling-price model.
 */
export async function getInventoryReportAnalytics(pharmacyId, branchId = null) {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    let query = supabase
      .from('products')
      .select('id,name,category,price,cost_price,stock_boxes,stock_units,units_per_box,low_stock_threshold,expiry_date,branch_id,is_active')
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true)
      .order('name', { ascending: true })
      .range(from, from + pageSize - 1);
    if (branchId) query = query.eq('branch_id', branchId);
    const { data, error } = await query;
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let lowStockCount = 0;
  let expiredCount = 0;
  let expiring30Count = 0;
  let expiring90Count = 0;
  let noExpiryCount = 0;
  let estimatedCostValue = 0;
  let estimatedRetailValue = 0;
  let lowStockCostValue = 0;
  let expiredCostExposure = 0;
  const categoryValues = {};

  for (const product of rows) {
    const boxes = Number(product.stock_boxes || 0);
    const looseUnits = Number(product.stock_units || 0);
    const unitsPerBox = Math.max(1, Number(product.units_per_box || 1));
    const costPerContainer = Number(product.cost_price || 0);
    const pricePerContainer = Number(product.price || 0);
    const estimatedCost = (boxes * costPerContainer) + (looseUnits * (costPerContainer / unitsPerBox));
    const estimatedRetail = (boxes * pricePerContainer) + (looseUnits * (pricePerContainer / unitsPerBox));
    estimatedCostValue += estimatedCost;
    estimatedRetailValue += estimatedRetail;

    const category = product.category || 'Uncategorized';
    categoryValues[category] = (categoryValues[category] || 0) + estimatedCost;

    const lowStock = boxes <= Number(product.low_stock_threshold || 0);
    if (lowStock) {
      lowStockCount += 1;
      lowStockCostValue += estimatedCost;
    }

    if (!product.expiry_date) {
      noExpiryCount += 1;
      continue;
    }
    const expiry = new Date(`${product.expiry_date}T00:00:00`);
    const days = Math.floor((expiry - today) / 86400000);
    if (days < 0) {
      expiredCount += 1;
      expiredCostExposure += estimatedCost;
    } else if (days <= 30) {
      expiring30Count += 1;
    } else if (days <= 90) {
      expiring90Count += 1;
    }
  }

  const topCategories = Object.entries(categoryValues)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return {
    totalProducts: rows.length,
    lowStockCount,
    expiredCount,
    expiring30Count,
    expiring90Count,
    noExpiryCount,
    estimatedCostValue,
    estimatedRetailValue,
    estimatedPotentialMargin: estimatedRetailValue - estimatedCostValue,
    lowStockCostValue,
    expiredCostExposure,
    topCategories
  };
}

/**
 * Compare active branches for a selected period using one paged sales scan,
 * one paged approved-expense scan, and one lightweight inventory scan.
 */
export async function getBranchComparisonReport(pharmacyId, {
  salesStart = null,
  salesEnd = null,
  expenseStart = null,
  expenseEnd = null
} = {}) {
  const branches = await getBranches(pharmacyId);
  const activeBranches = (branches || []).filter((branch) => branch.is_active !== false);
  const byId = Object.fromEntries(activeBranches.map((branch) => [branch.id, {
    id: branch.id,
    name: branch.name,
    revenue: 0,
    transactions: 0,
    approvedExpenses: 0,
    products: 0,
    lowStock: 0
  }]));

  const chunkSize = 1000;
  let offset = 0;
  while (true) {
    let query = supabase
      .from('sales')
      .select('branch_id,total_amount,status,created_at')
      .eq('pharmacy_id', pharmacyId)
      .eq('status', 'completed')
      .order('created_at', { ascending: true })
      .range(offset, offset + chunkSize - 1);
    if (salesStart) query = query.gte('created_at', salesStart);
    if (salesEnd) query = query.lt('created_at', salesEnd);
    const { data, error } = await query;
    if (error) throw error;
    const batch = data || [];
    batch.forEach((sale) => {
      const row = byId[sale.branch_id];
      if (!row) return;
      row.revenue += Number(sale.total_amount || 0);
      row.transactions += 1;
    });
    if (batch.length < chunkSize) break;
    offset += chunkSize;
  }

  offset = 0;
  while (true) {
    let query = supabase
      .from('expenses')
      .select('branch_id,amount,is_approved,expense_date')
      .eq('pharmacy_id', pharmacyId)
      .eq('is_approved', true)
      .order('expense_date', { ascending: true })
      .range(offset, offset + chunkSize - 1);
    if (expenseStart) query = query.gte('expense_date', expenseStart);
    if (expenseEnd) query = query.lte('expense_date', expenseEnd);
    const { data, error } = await query;
    if (error) throw error;
    const batch = data || [];
    batch.forEach((expense) => {
      const row = byId[expense.branch_id];
      if (row) row.approvedExpenses += Number(expense.amount || 0);
    });
    if (batch.length < chunkSize) break;
    offset += chunkSize;
  }

  offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('branch_id,stock_boxes,low_stock_threshold')
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true)
      .range(offset, offset + chunkSize - 1);
    if (error) throw error;
    const batch = data || [];
    batch.forEach((product) => {
      const row = byId[product.branch_id];
      if (!row) return;
      row.products += 1;
      if (Number(product.stock_boxes || 0) <= Number(product.low_stock_threshold || 0)) row.lowStock += 1;
    });
    if (batch.length < chunkSize) break;
    offset += chunkSize;
  }

  return Object.values(byId)
    .map((row) => ({
      ...row,
      averageSale: row.transactions ? row.revenue / row.transactions : 0,
      operatingBalance: row.revenue - row.approvedExpenses
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ===================== SALESMAN FEATURES =====================
/**
 * Get salesman feature visibility settings for a pharmacy
 * Returns which features salesman should see (dashboard, sales_history, daily_records, etc.)
 */
export async function getSalesmanFeatures(pharmacyId) {
  try {
    const { data, error } = await supabase
      .from('pharmacies')
      .select('salesman_features')
      .eq('id', pharmacyId)
      .single();
    
    if (error) throw error;
    
    // Return with defaults for any missing features
    const defaults = {
      pos: true,
      customers: true,
      patients: true,
      expenses: true,
      returns_request: true,
      dashboard: true,
      sales_history: true,
      daily_records: true
    };
    
    return { ...defaults, ...data?.salesman_features };
  } catch (err) {
    console.error('Error fetching salesman features:', err);
    throw err;
  }
}

/**
 * Update salesman feature visibility settings for a pharmacy
 * Only admin can call this (enforced by RLS)
 */
export async function updateSalesmanFeatures(pharmacyId, features) {
  try {
    if (!pharmacyId) throw new Error('Pharmacy ID is required');
    if (!features || typeof features !== 'object') throw new Error('Features object is required');
    
    // Validate that all required features are present
    const requiredFeatures = ['pos', 'customers', 'patients', 'expenses', 'returns_request', 'dashboard', 'sales_history', 'daily_records'];
    const validatedFeatures = {};
    
    requiredFeatures.forEach(feat => {
      validatedFeatures[feat] = Boolean(features[feat]);
    });
    
    const { data, error } = await supabase
      .from('pharmacies')
      .update({
        salesman_features: validatedFeatures,
        updated_at: new Date().toISOString()
      })
      .eq('id', pharmacyId)
      .select('salesman_features')
      .single();
    
    if (error) throw error;
    
    return data;
  } catch (err) {
    console.error('Error updating salesman features:', err);
    throw err;
  }
}

