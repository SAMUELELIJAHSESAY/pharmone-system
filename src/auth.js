import { supabase } from './config.js';

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
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, pharmacies(*)')
    .eq('id', user.id)
    .maybeSingle();

  // Check if user is disabled
  if (profile && !profile.is_active) {
    // User is disabled, sign them out
    await signOut().catch(() => {}); // Ignore errors
    return null;
  }

  // For salesman/non-super-admin users, also check if their admin is disabled
  if (profile && profile.role !== 'super_admin' && profile.pharmacy_id) {
    const { data: pharmacy } = await supabase
      .from('pharmacies')
      .select('id, owner_id')
      .eq('id', profile.pharmacy_id)
      .maybeSingle();

    // If pharmacy has an owner (admin), check if that admin is disabled
    if (pharmacy && pharmacy.owner_id) {
      const { data: adminProfile } = await supabase
        .from('profiles')
        .select('is_active')
        .eq('id', pharmacy.owner_id)
        .maybeSingle();

      if (adminProfile && !adminProfile.is_active) {
        // Admin is disabled, sign out this user too
        await signOut().catch(() => {}); // Ignore errors
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
