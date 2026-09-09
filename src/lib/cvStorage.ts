import { doc, getDocFromServer } from 'firebase/firestore';
import { db } from './firebase';
import { apiFetch, requireUid, userCacheKey } from './api/client';

const DB_NAME = 'JobOutreachCVStorage';
const STORE_NAME = 'cv_blobs';
export interface StoredCVAttachment {
  filename: string; mimeType: string; base64: string; sizeBytes: number;
  uid?: string; contentHash?: string;
}
export interface VerifiedCvResult { ok: boolean; attachment?: StoredCVAttachment; error?: string }
export interface CvBinary extends StoredCVAttachment { uid: string; contentHash: string }

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Archivio locale bloccato'));
  });
}
export async function saveCvToIndexedDb(key: string, data: StoredCVAttachment): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function getCvFromIndexedDb(key: string): Promise<StoredCVAttachment | null> {
  try {
    const db = await database();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = tx.onabort = () => db.close();
    });
  } catch { return null; }
}
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
export async function hashBase64(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export function formatProfessionalCvFilename(nome?: string, cognome?: string, originalName?: string): string {
  const name = [nome, cognome].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_-]/gu, '_');
  const extension = originalName?.split('.').pop() || 'pdf';
  return name ? `${name}_CV.${extension}` : originalName || 'Curriculum_Vitae.pdf';
}
export function cvMimeType(fileName: string, declaredType?: string): string {
  if (/\.docx$/i.test(fileName)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (/\.txt$/i.test(fileName)) return 'text/plain';
  if (/\.pdf$/i.test(fileName)) return 'application/pdf';
  return declaredType || 'application/octet-stream';
}
export async function persistCvFile(file: File, uid: string, candidateData?: any): Promise<CvBinary & { success: true }> {
  requireUid(uid);
  const base64 = await fileToBase64(file);
  const contentHash = await hashBase64(base64);
  const data: CvBinary = { uid, filename: file.name,
    mimeType: cvMimeType(file.name, file.type), base64,
    contentHash, sizeBytes: file.size };
  const response = await apiFetch('/api/cv/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, fileName: data.filename, base64Data: base64, mimeType: data.mimeType, contentHash }) }, uid);
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || 'Salvataggio del file CV non riuscito');
  requireUid(uid);
  await saveCvToIndexedDb(userCacheKey('cv', uid), data).catch(() => {});
  return { ...data, success: true };
}
export async function loadCvBinary(uid: string, expectedHash?: string): Promise<CvBinary | null> {
  requireUid(uid);
  let data = await getCvFromIndexedDb(userCacheKey('cv', uid));
  // Legacy UID-scoped entries have unambiguous ownership; unscoped current_cv never does.
  if (!data) data = await getCvFromIndexedDb(`cv_${uid}`);
  if (data && (!data.uid || data.uid === uid) && (!expectedHash || data.contentHash === expectedHash)) {
    const owned = { ...data, uid, contentHash: await hashBase64(data.base64) };
    if (expectedHash && owned.contentHash !== expectedHash) throw new Error('Copia locale del CV corrotta. Ripristina il documento originale.');
    requireUid(uid);
    await saveCvToIndexedDb(userCacheKey('cv', uid), owned).catch(() => {});
    return owned;
  }
  const res = await apiFetch(`/api/cv/file${expectedHash ? `?hash=${encodeURIComponent(expectedHash)}` : ''}`, {}, uid);
  if (res.status === 404) return null;
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || 'Recupero CV fallito');
  requireUid(uid);
  const raw = json.data;
  const contentHash = raw.contentHash || await hashBase64(raw.base64Data);
  if (expectedHash && contentHash !== expectedHash) throw new Error('Il file salvato non corrisponde al profilo CV. Ricarica il documento corretto.');
  const binary = { uid, filename: raw.fileName, mimeType: raw.mimeType, base64: raw.base64Data,
    sizeBytes: raw.sizeBytes || Math.floor(raw.base64Data.length * 3 / 4), contentHash };
  await saveCvToIndexedDb(userCacheKey('cv', uid), binary).catch(() => {});
  return binary;
}
export async function getVerifiedCvAttachment(cvFileState?: any, _cvData?: any, profile?: any): Promise<VerifiedCvResult> {
  try {
    const uid = requireUid(profile?.user_id);
    const saved = await getDocFromServer(doc(db, 'users', uid));
    requireUid(uid);
    const expectedHash = saved.data()?.cvMetadata?.contentHash;
    if (!expectedHash) throw new Error('Il file CV originale non è ancora verificato. Completa l’analisi o ricarica il documento.');
    const data = cvFileState?.uid === uid && cvFileState?.base64Data && await hashBase64(cvFileState.base64Data) === expectedHash ? {
      uid, filename: cvFileState.fileName, base64: cvFileState.base64Data, mimeType: cvFileState.mimeType,
      sizeBytes: Math.floor(cvFileState.base64Data.length * 3 / 4), contentHash: expectedHash,
    } : await loadCvBinary(uid, expectedHash);
    if (!data?.base64) throw new Error('Il file CV originale non è disponibile. Caricalo per allegarlo.');
    return { ok: true, attachment: data };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

/** Before any Gmail send, compare the actual bytes with the uploaded file hash persisted in Firestore. */
export async function verifyOriginalAttachment(attachment?: { base64: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const uid = requireUid();
    if (!attachment?.base64) throw new Error('Invio bloccato: manca il CV originale.');
    const snapshot = await getDocFromServer(doc(db, 'users', uid));
    requireUid(uid);
    const hash = snapshot.data()?.cvMetadata?.contentHash;
    if (!hash || await hashBase64(attachment.base64) !== hash) throw new Error('Invio bloccato: l’allegato non corrisponde al CV originale caricato.');
    requireUid(uid);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}
