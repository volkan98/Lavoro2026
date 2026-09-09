import { auth } from '../firebase';
export function requireUid(expectedUid?: string): string {
  const uid = auth.currentUser?.uid;
  if (!uid || (expectedUid !== undefined && expectedUid !== uid)) throw new Error('Sessione Firebase assente o cambiata. Accedi nuovamente.');
  return uid;
}
export function userCacheKey(suffix: string, uid = requireUid()): string {
  if (!uid) throw new Error('UID richiesto');
  return `ais_job_outreach_${suffix}_${uid}`;
}
export async function apiFetch(path: string, init: RequestInit = {}, expectedUid?: string): Promise<Response> {
  const uid = requireUid(expectedUid);
  const token = await auth.currentUser!.getIdToken();
  requireUid(uid);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(path, { ...init, headers });
}

export function scopedStorageKey(key: string): string { return `${key}_${requireUid()}`; }
