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

export async function safeJsonResponse<T = any>(input: any): Promise<T> {
  if (input === null || input === undefined) {
    return { success: false, error: 'Risposta del server vuota o non valida' } as unknown as T;
  }
  
  // If input is already a plain object and NOT a Response object (no .json function or no .headers)
  if (typeof input === 'object' && typeof input.json !== 'function') {
    return input as T;
  }

  if (typeof input.json === 'function') {
    try {
      const status = typeof input.status === 'number' ? input.status : 200;
      const contentType = input.headers?.get?.('content-type') || '';
      const text = await input.text();
      
      if (!contentType.includes('application/json') && !text.trim().startsWith('{') && !text.trim().startsWith('[')) {
        console.warn(`[safeJsonResponse] Received non-JSON response (status ${status}, type ${contentType}):`, text.slice(0, 200));
        return {
          success: false,
          status,
          error: `Risposta non JSON dal server (status ${status})`,
          rawText: text.slice(0, 500)
        } as unknown as T;
      }

      try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
          if (input.ok === false && parsed.success === undefined) {
            parsed.success = false;
          }
          return parsed as T;
        }
        return { success: input.ok !== false, data: parsed } as unknown as T;
      } catch (parseErr) {
        console.error(`[safeJsonResponse] JSON parse error (status ${status}):`, parseErr);
        return {
          success: false,
          status,
          error: `Errore durante il parsing del JSON (status ${status})`,
          rawText: text.slice(0, 500)
        } as unknown as T;
      }
    } catch (readErr: any) {
      console.error('[safeJsonResponse] Error reading response stream:', readErr);
      return { success: false, error: readErr?.message || 'Errore di lettura della risposta HTTP' } as unknown as T;
    }
  }

  return { success: false, error: 'Oggetto risposta non valido' } as unknown as T;
}

export function sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const result: any = Array.isArray(obj) ? [] : {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
      result[key] = sanitizeForFirestore(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}
