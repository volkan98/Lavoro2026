import { doc, getDocFromServer, runTransaction } from 'firebase/firestore';
import { db } from './firebase';
import type { CVData } from '../types/cv';
import { normalizeCvData, hasCvData, mergeCvData, getEmptyCvData } from './cvNormalizer';
import { apiFetch, requireUid, userCacheKey } from './api/client';
import { loadCvBinary, CvBinary } from './cvStorage';
import { aiAgent } from './api/ai-agent';

export interface CvMetadata { fileName: string; mimeType: string; contentHash?: string; sizeBytes?: number; uploadedAt?: string }
export interface UserDocument {
  uid: string; schemaVersion?: number; profile?: Record<string, any>; cvMetadata?: CvMetadata;
  cvParsedData?: CVData | null; updatedAt?: string;
}
export function profileFromCv(uid: string, c: CVData, previous: Record<string, any> = {}, meta?: CvMetadata) {
  return { id: uid, user_id: uid, full_name: [c.nome, c.cognome].filter(Boolean).join(' ') || null,
    email: c.email || null, phone: c.telefono || null, city: c.citta || null, cap: c.cap || null,
    indirizzo: c.indirizzo || null, data_nascita: c.dataNascita || null, patente: c.patente || null,
    skills: c.competenze, profile_summary: c.profilo || null, permesso_g: c.permessoG,
    stato_permesso: c.statoPermesso || null, cv_short_summary: c.sintesiBreve || null,
    cv_full_summary: c.sintesiCompleta || null, cv_file_path: meta?.fileName || previous.cv_file_path || null,
    target_role: c.targetRole || null, search_radius_km: previous.search_radius_km ?? 35,
    exclude_same_domain: previous.exclude_same_domain ?? true };
}
export function cacheDocument(uid: string, document: UserDocument) {
  requireUid(uid);
  try {
    localStorage.setItem(userCacheKey('cv', uid), JSON.stringify(document));
    localStorage.setItem(userCacheKey('profile', uid), JSON.stringify(document.profile || {}));
  } catch { /* A cache failure does not invalidate an acknowledged Firestore write. */ }
}
export function cachedDocument(uid: string): UserDocument | null {
  try {
    const value = JSON.parse(localStorage.getItem(userCacheKey('cv', uid)) || 'null');
    if (!value || (value.uid && value.uid !== uid)) return null;
    return value.cvParsedData ? value : { uid, cvParsedData: normalizeCvData(value) };
  } catch { return null; }
}
const completeSnapshot = (d: any) => d?.schemaVersion === 2 && d.cvParsedData &&
  Object.keys(getEmptyCvData()).every(k => Object.hasOwn(d.cvParsedData, k));
const structuredLegacy = (d: any) => d && ['esperienze', 'experiences', 'work_experience', 'istruzione', 'education', 'lingue', 'languages'].some(k => Array.isArray(d[k]) && d[k].length);

export async function writeCvSnapshot(uid: string, input: unknown, metadata?: CvMetadata, replace = false, recoveryHash?: string): Promise<UserDocument> {
  requireUid(uid);
  const normalized = normalizeCvData(input);
  if (!hasCvData(normalized)) throw new Error('Nessun dato CV da salvare. Il profilo precedente è stato mantenuto.');
  const result = await runTransaction(db, async tx => {
    const ref = doc(db, 'users', uid);
    const snap = await tx.get(ref);
    requireUid(uid);
    const previous = snap.data() || {};
    if (recoveryHash && completeSnapshot(previous)) return previous as UserDocument;
    if (recoveryHash && previous.cvRecovery?.contentHash !== recoveryHash) throw new Error('Il documento è cambiato durante il recupero.');
    const cv = replace ? normalized : completeSnapshot(previous) ? normalizeCvData(previous.cvParsedData) : mergeCvData(previous.cvParsedData, normalized);
    const cvMetadata = metadata || previous.cvMetadata;
    const saved: UserDocument = { uid, schemaVersion: 2, cvParsedData: cv,
      profile: profileFromCv(uid, cv, previous.profile, cvMetadata), updatedAt: new Date().toISOString(),
      ...(cvMetadata ? { cvMetadata } : {}) };
    // mergeFields replaces each complete CV map, preserving unrelated user data.
    tx.set(ref, { ...saved, cvRecovery: null }, { mergeFields: [...Object.keys(saved), 'cvRecovery'] });
    return saved;
  });
  requireUid(uid);
  cacheDocument(uid, result);
  return result;
}
export async function recoverCv(uid: string, binary: CvBinary, force = false): Promise<UserDocument | null> {
  const claimed = await runTransaction(db, async tx => {
    const ref = doc(db, 'users', uid);
    const snapshot = await tx.get(ref);
    requireUid(uid);
    const d = snapshot.data() || {};
    if (completeSnapshot(d)) return false;
    const attempt = d.cvRecovery;
    if (attempt?.contentHash === binary.contentHash) {
      if (attempt.status === 'running' && Date.now() - attempt.startedAt < 300000) return false;
      if (attempt.status === 'failed' && !force) throw new Error('Il recupero del CV non è riuscito. Usa “Riprova analisi” per riprovare.');
    }
    tx.set(ref, { cvRecovery: { contentHash: binary.contentHash, status: 'running', startedAt: Date.now() } }, { merge: true });
    return true;
  });
  if (!claimed) return null;
  try {
    const parsed = await aiAgent.parseCV({ base64Data: binary.base64, mimeType: binary.mimeType, fileName: binary.filename });
    requireUid(uid);
    if (!parsed.success) throw new Error(parsed.error);
    return await writeCvSnapshot(uid, parsed.data, { fileName: binary.filename, mimeType: binary.mimeType,
      contentHash: binary.contentHash, sizeBytes: binary.sizeBytes }, true, binary.contentHash);
  } catch (e) {
    requireUid(uid);
    await runTransaction(db, async tx => {
      const ref = doc(db, 'users', uid); const snap = await tx.get(ref);
      if (snap.data()?.cvRecovery?.contentHash === binary.contentHash) tx.set(ref,
        { cvRecovery: { contentHash: binary.contentHash, status: 'failed', startedAt: Date.now() } }, { merge: true });
    });
    throw e;
  }
}
export async function readCvSnapshot(uid: string, current?: UserDocument | null, forceRecovery = false): Promise<{ document: UserDocument; binary: CvBinary | null; source: 'cloud' | 'cache' }> {
  requireUid(uid);
  const ref = doc(db, 'users', uid);
  let cloud: any;
  try { cloud = (await getDocFromServer(ref)).data() || {}; }
  catch (e) {
    const cached = current || cachedDocument(uid);
    if (!cached?.cvParsedData) throw e;
    return { document: cached, binary: null, source: 'cache' };
  }
  requireUid(uid);
  const cached = current || cachedDocument(uid);
  let raw = cloud.cvParsedData || cloud.extractedData;
  if (!raw && structuredLegacy(cloud.profile)) raw = cloud.profile;
  if (!raw && (cached?.schemaVersion === 2 || structuredLegacy(cached?.cvParsedData))) raw = cached?.cvParsedData;
  // Same-UID legacy backend import, only when Firestore has no extracted document.
  if (!raw) {
    try {
      const response = await apiFetch('/api/user/profile', {}, uid);
      const json = await response.json();
      if (response.ok && json.data?.user_id === uid) raw = json.data.cvParsedData || json.data.extractedData;
    } catch { /* Binary recovery may still be possible. */ }
  }
  // The old timeout fallback stored only email/phone plus invented permit text as a successful CV.
  // Such an unversioned record is not an extraction; recover it from the original once.
  if (raw && !completeSnapshot(cloud)) {
    const normalized = normalizeCvData(raw);
    if (!normalized.esperienze.length && !normalized.istruzione.length && !normalized.lingue.length &&
        !normalized.competenze.length && !normalized.profilo && !normalized.certificazioni?.length) raw = undefined;
  }
  let document: UserDocument = { ...cloud, uid, cvParsedData: null };
  if (raw && hasCvData(raw)) {
    const cv = completeSnapshot(cloud) ? normalizeCvData(raw) : mergeCvData(cached?.cvParsedData, raw);
    document = completeSnapshot(cloud) ? { ...cloud, uid, cvParsedData: cv, profile: profileFromCv(uid, cv, cloud.profile, cloud.cvMetadata) }
      : await writeCvSnapshot(uid, cv, cloud.cvMetadata);
  }
  let binary: CvBinary | null = null;
  try { binary = await loadCvBinary(uid, document.cvMetadata?.contentHash); }
  catch (e) { if (!document.cvParsedData) throw e; }
  if (document.cvParsedData && binary && !document.cvMetadata?.contentHash) {
    document = await writeCvSnapshot(uid, document.cvParsedData, { fileName: binary.filename, mimeType: binary.mimeType,
      contentHash: binary.contentHash, sizeBytes: binary.sizeBytes });
  }
  if (!document.cvParsedData && binary) {
    const recovered = await recoverCv(uid, binary, forceRecovery);
    if (recovered) document = recovered;
    else {
      const latest = (await getDocFromServer(ref)).data();
      if (completeSnapshot(latest)) document = latest as UserDocument;
      else throw new Error('Recupero del CV già in corso. Sincronizza tra poco.');
    }
  }
  if (binary && document.cvMetadata?.contentHash && binary.contentHash !== document.cvMetadata.contentHash) {
    binary = await loadCvBinary(uid, document.cvMetadata.contentHash);
  }
  cacheDocument(uid, document);
  return { document, binary, source: 'cloud' };
}
