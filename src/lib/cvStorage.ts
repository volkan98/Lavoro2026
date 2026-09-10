import { doc, getDoc, getDocFromServer, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { apiFetch, requireUid, userCacheKey, safeJsonResponse } from './api/client';

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

  // 1. Save to Firestore doc users/{uid}/cv_binary/current
  try {
    await setDoc(doc(db, 'users', uid, 'cv_binary', 'current'), {
      uid,
      filename: data.filename,
      mimeType: data.mimeType,
      base64: data.base64,
      sizeBytes: data.sizeBytes,
      contentHash,
      updatedAt: new Date().toISOString(),
    });
  } catch (fsErr) {
    console.warn('[CV Storage] Firestore write error:', fsErr);
  }

  // 2. Save to server API /api/cv/upload
  const response = await apiFetch('/api/cv/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, fileName: data.filename, base64Data: base64, mimeType: data.mimeType, contentHash }) }, uid);
  const result = await safeJsonResponse(response);
  if (!response.ok || !result.success) {
    console.warn('[CV Storage] Server upload returned non-ok, but Firestore write succeeded:', result);
  }

  requireUid(uid);
  await saveCvToIndexedDb(userCacheKey('cv', uid), data).catch(() => {});
  return { ...data, success: true };
}

export async function loadCvBinary(uid: string, expectedHash?: string): Promise<CvBinary | null> {
  requireUid(uid);
  let data = await getCvFromIndexedDb(userCacheKey('cv', uid));
  if (!data) data = await getCvFromIndexedDb(`cv_${uid}`);
  if (data && (!data.uid || data.uid === uid) && (!expectedHash || data.contentHash === expectedHash)) {
    const owned = { ...data, uid, contentHash: await hashBase64(data.base64) };
    if (!expectedHash || owned.contentHash === expectedHash) {
      requireUid(uid);
      await saveCvToIndexedDb(userCacheKey('cv', uid), owned).catch(() => {});
      return owned;
    }
  }

  // 1. Try reading from Firestore users/{uid}/cv_binary/current
  try {
    const fsSnap = await Promise.race([
      getDoc(doc(db, 'users', uid, 'cv_binary', 'current')),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 5000))
    ]);
    if (fsSnap.exists()) {
      const fsData = fsSnap.data();
      if (fsData && fsData.base64 && fsData.base64.length > 50) {
        const contentHash = fsData.contentHash || await hashBase64(fsData.base64);
        if (!expectedHash || contentHash === expectedHash) {
          const binary: CvBinary = {
            uid,
            filename: fsData.filename || 'Curriculum_Vitae.pdf',
            mimeType: fsData.mimeType || 'application/pdf',
            base64: fsData.base64,
            sizeBytes: fsData.sizeBytes || Math.floor(fsData.base64.length * 3 / 4),
            contentHash,
          };
          await saveCvToIndexedDb(userCacheKey('cv', uid), binary).catch(() => {});
          return binary;
        }
      }
    }
  } catch (fsErr) {
    console.warn('[CV Storage] Firestore binary load error:', fsErr);
  }

  // 2. Fallback to /api/cv/file
  try {
    const res = await apiFetch(`/api/cv/file${expectedHash ? `?hash=${encodeURIComponent(expectedHash)}` : ''}`, {}, uid);
    if (res.ok) {
      const json = await safeJsonResponse(res);
      if (json.success && json.data?.base64Data) {
        requireUid(uid);
        const raw = json.data;
        const contentHash = raw.contentHash || await hashBase64(raw.base64Data);
        if (!expectedHash || contentHash === expectedHash) {
          const binary = { uid, filename: raw.fileName, mimeType: raw.mimeType, base64: raw.base64Data,
            sizeBytes: raw.sizeBytes || Math.floor(raw.base64Data.length * 3 / 4), contentHash };
          await saveCvToIndexedDb(userCacheKey('cv', uid), binary).catch(() => {});
          return binary;
        }
      }
    }
  } catch (apiErr) {
    console.warn('[CV Storage] API binary load error:', apiErr);
  }

  return null;
}

function getCachedCvMeta(uid: string): { contentHash?: string; fileName?: string } | null {
  try {
    const value = JSON.parse(localStorage.getItem(userCacheKey('cv', uid)) || 'null');
    if (!value || (value.uid && value.uid !== uid)) return null;
    return value.cvMetadata || null;
  } catch { return null; }
}

export async function getVerifiedCvAttachment(cvFileState?: any, _cvData?: any, profile?: any): Promise<VerifiedCvResult> {
  try {
    const uid = requireUid(profile?.user_id || undefined);
    let expectedHash: string | undefined;
    try {
      const snap = await Promise.race([
        getDocFromServer(doc(db, 'users', uid)),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 5000))
      ]);
      expectedHash = snap.data()?.cvMetadata?.contentHash;
    } catch {
      try {
        const fallbackSnap = await Promise.race([
          getDoc(doc(db, 'users', uid)),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 3000))
        ]);
        expectedHash = fallbackSnap.data()?.cvMetadata?.contentHash;
      } catch {
        // Offline / Firestore timeout / permission fallback
      }
    }
    if (!expectedHash) {
      const cached = getCachedCvMeta(uid);
      expectedHash = cached?.contentHash || profile?.cvMetadata?.contentHash || cvFileState?.contentHash;
    }

    let data: CvBinary | null = null;
    if (cvFileState?.base64Data && (!cvFileState.uid || cvFileState.uid === uid)) {
      const fileHash = await hashBase64(cvFileState.base64Data);
      if (!expectedHash || fileHash === expectedHash) {
        data = {
          uid,
          filename: cvFileState.fileName || 'Curriculum_Vitae.pdf',
          base64: cvFileState.base64Data,
          mimeType: cvFileState.mimeType || 'application/pdf',
          sizeBytes: Math.floor(cvFileState.base64Data.length * 3 / 4),
          contentHash: fileHash,
        };
      }
    }

    if (!data) {
      data = await loadCvBinary(uid, expectedHash);
    }
    if (!data) {
      data = await loadCvBinary(uid);
    }

    if (!data?.base64) throw new Error('Il file CV originale non è disponibile. Caricalo per allegarlo.');
    requireUid(uid);
    return { ok: true, attachment: data };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

/** Before any Gmail send, compare the actual bytes with the uploaded file hash persisted in Firestore. */
export async function verifyOriginalAttachment(attachment?: { base64: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const uid = requireUid();
    if (!attachment?.base64) throw new Error('Invio bloccato: manca il CV originale.');
    let hash: string | undefined;
    try {
      const snapshot = await Promise.race([
        getDocFromServer(doc(db, 'users', uid)),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 5000))
      ]);
      hash = snapshot.data()?.cvMetadata?.contentHash;
    } catch {
      try {
        const fallbackSnap = await Promise.race([
          getDoc(doc(db, 'users', uid)),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 3000))
        ]);
        hash = fallbackSnap.data()?.cvMetadata?.contentHash;
      } catch {
        // Fallback
      }
    }
    if (!hash) {
      const cached = getCachedCvMeta(uid);
      hash = cached?.contentHash;
    }
    if (!hash) {
      const binary = await loadCvBinary(uid);
      hash = binary?.contentHash;
    }
    if (!hash || await hashBase64(attachment.base64) !== hash) throw new Error('Invio bloccato: l’allegato non corrisponde al CV originale caricato.');
    requireUid(uid);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

