import { supabase } from './config.js';

const OFFLINE_AUTH_CACHE_PREFIX = 'sammia-offline-user:';
const OFFLINE_AUTH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function cacheVerifiedUser(user, profile) {
  if (!user?.id || !profile) return;
  try {
    localStorage.setItem(`${OFFLINE_AUTH_CACHE_PREFIX}${user.id}`, JSON.stringify({
      user: { id: user.id, email: user.email || profile.email || '', user_metadata: user.user_metadata || {} },
      profile,
      verified_at: Date.now()
    }));
  } catch (_) {}
}

function removeCachedUser(userId) {
  if (!userId) return;
  try { localStorage.removeItem(`${OFFLINE_AUTH_CACHE_PREFIX}${userId}`); } catch (_) {}
}

async function getCachedOfflineUser() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const sessionUser = session?.user;
    if (!sessionUser?.id) return null;
    const raw = localStorage.getItem(`${OFFLINE_AUTH_CACHE_PREFIX}${sessionUser.id}`);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.profile || Date.now() - Number(cached.verified_at || 0) > OFFLINE_AUTH_MAX_AGE_MS) return null;
    if (cached.profile.is_active === false || ['disabled', 'locked'].includes(cached.profile.account_status)) return null;
    return { ...sessionUser, profile: cached.profile, offline_session: true };
  } catch (_) {
    return null;
  }
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password, fullName, role, pharmacyId = null) {
  // Store current session before signup
  const { data: { session: currentSession } } = await supabase.auth.getSession();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, role } }
  });
  if (error) throw error;

  if (data.user) {
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: data.user.id,
      email,
      full_name: fullName,
      role,
      pharmacy_id: pharmacyId
    });
    if (profileError) throw profileError;
  }

  // Restore the admin's session if it existed
  if (currentSession) {
    await supabase.auth.setSession(currentSession);
  }

  return data;
}

export async function signOut() {
  const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  removeCachedUser(session?.user?.id);
  const { error } = await supabase.auth.signOut();
  if (error && navigator.onLine) throw error;
}

export async function getCurrentUser() {
  if (!navigator.onLine) return getCachedOfflineUser();
  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result?.data?.user || null;
    if (result?.error) throw result.error;
  } catch (error) {
    if (!navigator.onLine || /fetch|network|timeout/i.test(String(error?.message || ''))) {
      return getCachedOfflineUser();
    }
    throw error;
  }
  if (!user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*, pharmacies(*)')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    if (!navigator.onLine || /fetch|network|timeout/i.test(String(profileError?.message || ''))) {
      return getCachedOfflineUser();
    }
    throw profileError;
  }

  if (profile && (!profile.is_active || profile.account_status === 'disabled' || profile.account_status === 'locked')) {
    await signOut().catch(() => {});
    return null;
  }

  if (profile) {
    cacheVerifiedUser(user, profile);
    try {
      const key = `sammia-last-activity-${user.id}`;
      const previous = Number(localStorage.getItem(key) || 0);
      const now = Date.now();
      if (!previous || now - previous > 10 * 60 * 1000) {
        localStorage.setItem(key, String(now));
        supabase.from('profiles').update({ last_activity_at: new Date(now).toISOString() }).eq('id', user.id).then(() => {}).catch(() => {});
      }
    } catch (_) {}
  }

  if (profile && profile.role !== 'super_admin' && profile.pharmacy_id && navigator.onLine) {
    const { data: pharmacy } = await supabase
      .from('pharmacies')
      .select('id, owner_id')
      .eq('id', profile.pharmacy_id)
      .maybeSingle();

    if (pharmacy?.owner_id) {
      const { data: adminProfile } = await supabase
        .from('profiles')
        .select('is_active')
        .eq('id', pharmacy.owner_id)
        .maybeSingle();
      if (adminProfile && !adminProfile.is_active) {
        await signOut().catch(() => {});
        return null;
      }
    }
  }

  return { ...user, profile };
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}
