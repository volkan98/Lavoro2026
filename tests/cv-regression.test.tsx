import React from 'react';
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { File as NodeFile } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { rawCv, originalText } from './fixtures/cv';
import { originalPdfBytes } from './fixtures/pdf';

// Only external identity/cloud/model boundaries are controlled. The application, React views,
// parser endpoint, HTTP authorization, filesystem persistence and IndexedDB execute real code.
const external = vi.hoisted(() => ({
  auth: { currentUser: null as any }, docs: new Map<string, any>(), listeners: new Set<(user: any) => void>(),
  writes: [] as string[], reads: [] as string[], failRead: false, failWrite: false, nextUser: null as any,
}));
vi.mock('@/lib/firebase', () => ({ auth: external.auth, db: {} }));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onIdTokenChanged: (_auth: any, callback: any) => {
    external.listeners.add(callback); queueMicrotask(() => { if (external.listeners.has(callback)) callback(external.auth.currentUser); });
    return () => external.listeners.delete(callback);
  },
  onAuthStateChanged: (_auth: any, callback: any) => {
    external.listeners.add(callback); queueMicrotask(() => { if (external.listeners.has(callback)) callback(external.auth.currentUser); });
    return () => external.listeners.delete(callback);
  },
  signInWithPopup: async () => { external.auth.currentUser = external.nextUser; external.listeners.forEach(cb => cb(external.nextUser)); return { user: external.nextUser }; },
  signOut: async () => { external.auth.currentUser = null; external.listeners.forEach(cb => cb(null)); },
  signInWithEmailAndPassword: vi.fn(async () => { throw new Error('Password errata'); }),
  createUserWithEmailAndPassword: vi.fn(), updateProfile: vi.fn(),
}));
const snapshot = (ref: any) => ({ exists: () => external.docs.has(ref.path), data: () => structuredClone(external.docs.get(ref.path)) });
vi.mock('firebase/firestore', () => ({
  doc: (_db: any, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: any, ...segments: string[]) => ({ path: segments.join('/') }),
  getDocFromServer: async (ref: any) => {
    external.reads.push(ref.path);
    if (external.failRead) throw new Error('Cloud offline');
    return snapshot(ref);
  },
  runTransaction: async (_db: any, callback: any) => {
    const pending: any[] = [];
    const result = await callback({ get: async (ref: any) => snapshot(ref), set: (ref: any, data: any) => pending.push([ref, data]) });
    if (external.failWrite) throw new Error('permission-denied');
    for (const [ref, data] of pending) {
      const hasUndefined = (v: any): boolean => v === undefined || (v && typeof v === 'object' && Object.values(v).some(hasUndefined));
      if (hasUndefined(data)) throw new Error('Firestore rejects undefined');
      external.writes.push(ref.path);
      external.docs.set(ref.path, { ...external.docs.get(ref.path), ...structuredClone(data) });
    }
    return result;
  },
  setDoc: async (ref: any, data: any) => { external.writes.push(ref.path); external.docs.set(ref.path, structuredClone(data)); },
  getDocs: async (ref: any) => ({ empty: false, docs: [...external.docs.entries()].filter(([key]) => key.startsWith(ref.path + '/')).map(([key, value]) => ({ id: key.split('/').at(-1), data: () => value })) }),
  deleteDoc: async (ref: any) => { external.docs.delete(ref.path); },
}));
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { UserProfileProvider, useUserProfile } from '@/hooks/useUserProfile';
import { CVProvider, useCVContext } from '@/contexts/CVContext';
import { CVUploader } from '@/components/cv/CVUploader';
import { CVSummary } from '@/components/cv/CVSummary';
import { normalizeCvData, getEmptyCvData, summarizeCv } from '@/lib/cvNormalizer';
import { aiAgent } from '@/lib/api/ai-agent';
import { getCvFromIndexedDb, persistCvFile, getVerifiedCvAttachment, verifyOriginalAttachment, hashBase64, saveCvToIndexedDb } from '@/lib/cvStorage';
import { readCvSnapshot, writeCvSnapshot } from '@/lib/cvRepository';
import { apiFetch, userCacheKey } from '@/lib/api/client';
import { buildRfc2822Mime, sendViaGmailApi, getCachedGmailToken } from '@/lib/workspaceAuth';
import { generateVariedEmail } from '@/lib/campaignPacing';

const expected = normalizeCvData(rawCv);
let uid: string;
let counter = 0;
let server: Server;
let baseUrl: string;
let directory: string;
let modelFailure = false;
let modelCalls: any[] = [];
const requests: { path: string; token: string | null }[] = [];
const nativeFetch = globalThis.fetch;
const makeUser = (id: string) => ({ uid: id, email: 'fixture@example.test', displayName: 'Account fixture', emailVerified: true,
  providerData: [{ providerId: 'google.com', uid: 'google-fixture-sub' }], getIdToken: async () => `test-token:${id}` });
const file = () => new NodeFile([originalText], 'CV-originale-test.txt', { type: 'text/plain' }) as unknown as File;
function Probe() {
  const { user, loading, signOut, signInWithGoogle } = useAuth();
  const cv = useCVContext();
  const profile = useUserProfile();
  if (loading) return <p>Auth loading</p>;
  if (!user) return <button onClick={signInWithGoogle}>Login test</button>;
  return <>
    <button onClick={signOut}>Logout test</button>
    <button onClick={() => cv.setCurrentStep(0)}>Sezione CV</button>
    <button onClick={() => cv.setCurrentStep(1)}>Sezione Sintesi</button>
    <button onClick={() => { void profile.fetchProfile().catch(() => {}); }}>Sincronizza ora</button>
    <output data-testid="uid">{user.id}</output>
    <output data-testid="state">{JSON.stringify(cv.cvData)}</output>
    <output data-testid="saved">{String(profile.hasSavedCV)}</output>
    {cv.currentStep === 1 ? <CVSummary /> : <CVUploader />}
  </>;
}
const mount = () => render(<AuthProvider><UserProfileProvider><CVProvider><Probe /></CVProvider></UserProfileProvider></AuthProvider>);
const current = () => JSON.parse(screen.getByTestId('state').textContent!);
async function upload() {
  const app = mount();
  await screen.findByLabelText('File CV');
  await waitFor(() => expect((screen.getByLabelText('File CV') as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('File CV'), { target: { files: [file()] } });
  fireEvent.click(screen.getByRole('button', { name: 'Analizza CV' }));
  await screen.findByText('Sintesi del CV');
  await waitFor(() => expect(current()).toEqual(expected));
  return app;
}
beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'cv-regression-'));
  process.env.APP_DATA_FILE = path.join(directory, 'app_data.json');
  const { createApplication } = await import('../server');
  const app = await createApplication({ serveFrontend: false,
    verifyToken: async (token: string) => {
      if (!token.startsWith('test-token:')) throw new Error('invalid token');
      return { uid: token.slice('test-token:'.length) };
    },
    generateCv: async (input: any) => {
      modelCalls.push(input);
      if (modelFailure) throw new Error('Gemini quota test');
      return { text: JSON.stringify(rawCv) };
    },
  });
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});
beforeEach(() => {
  cleanup(); localStorage.clear(); sessionStorage.clear();
  external.docs.clear(); external.writes.length = 0; external.reads.length = 0; external.failRead = false; external.failWrite = false;
  uid = `firebase-fixture-${++counter}`;
  external.auth.currentUser = makeUser(uid); external.nextUser = makeUser(uid);
  modelFailure = false; modelCalls = []; requests.length = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (!String(url).startsWith('/api/')) throw new Error(`External send/network forbidden in tests: ${url}`);
    requests.push({ path: url, token: new Headers(init.headers).get('Authorization') });
    return nativeFetch(baseUrl + url, init);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
afterAll(async () => { await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); rmSync(directory, { recursive: true, force: true }); });

describe('User-requested CV regression tests', () => {
  it('TEST 1 — upload executes parser endpoint and preserves experiences, education and languages', async () => {
    await upload();
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0].contents).toContain(originalText);
    expect(current().esperienze).toHaveLength(2); expect(current().istruzione).toHaveLength(1); expect(current().lingue).toHaveLength(2);
    expect(external.docs.get(`users/${uid}`).cvParsedData).toEqual(expected);
  });
  it('TEST 2 — CV → Sintesi renders the identical complete structured data', async () => {
    await upload(); fireEvent.click(screen.getByText('Sezione CV')); fireEvent.click(screen.getByText('Sezione Sintesi'));
    expect(current()).toEqual(expected);
    for (const text of ['Azienda test A', 'Ruolo test B', 'Istituto test', 'Qualifica test', 'Italiano: C2', 'Inglese: B1', 'Certificazione test', 'Informazione test']) expect(screen.getByText(text)).toBeTruthy();
    expect((screen.getByLabelText('Indirizzo') as HTMLInputElement).value).toBe(expected.indirizzo);
  });
  it('TEST 3 — full application remount restores from Firestore with localStorage emptied', async () => {
    const app = await upload(); app.unmount(); localStorage.clear(); mount();
    await screen.findByText('Dati CV salvati'); fireEvent.click(screen.getByText('Sezione Sintesi'));
    expect(current()).toEqual(expected); expect(modelCalls).toHaveLength(1);
  });
  it('TEST 4 — logout rejects stale local sessions and same Firebase UID restores the CV', async () => {
    await upload(); fireEvent.click(screen.getByText('Logout test'));
    await screen.findByText('Login test');
    localStorage.setItem('ais_job_outreach_active_session', JSON.stringify({ id: uid, email: 'fixture@example.test' }));
    expect(screen.queryByTestId('state')).toBeNull();
    fireEvent.click(screen.getByText('Login test'));
    await screen.findByText('Sintesi del CV'); expect(current()).toEqual(expected);
  });
  it('TEST 5 — placeholders, invented dates/permits and invented summary facts never enter saved data', async () => {
    await upload();
    expect(JSON.stringify(current())).not.toMatch(/Candidato|Svizzera\/Ticino|Idoneo|Presente/);
    expect(current().esperienze[1].dataFine).toBe(''); expect(current().permessoG).toBe('');
    expect(normalizeCvData({ nome: 'Candidato', cognome: 'Svizzera/Ticino', permessoG: false }).permessoG).toBe(false);
    expect(normalizeCvData({ nome: 'Candidato', cognome: 'Svizzera/Ticino' }).nome).toBe('');
    expect(summarizeCv({}).sintesiCompleta).toBe('');
    expect(generateVariedEmail({ candidateName: '', companyName: 'Azienda test' }).bodyText).not.toMatch(/Permesso|cittadino|esperienza pratica/);
  });
  it('TEST 6 — Firebase UID is shared by Firestore, HTTP, IndexedDB, localStorage, CV and sentEmails', async () => {
    await upload();
    await aiAgent.recordSentEmail(null, 'Azienda test', 'recipient@example.test', 'Oggetto', '', '', uid);
    expect(external.writes.every(key => key.startsWith(`users/${uid}`))).toBe(true);
    expect(external.writes.some(key => key.startsWith(`users/${uid}/sentEmails/`))).toBe(true);
    expect(requests.every(r => r.token === `Bearer test-token:${uid}`)).toBe(true);
    expect((await getCvFromIndexedDb(userCacheKey('cv', uid)))?.uid).toBe(uid);
    expect(JSON.parse(localStorage.getItem(userCacheKey('profile', uid))!).user_id).toBe(uid);
    expect(JSON.parse(localStorage.getItem(userCacheKey('cv', uid))!).uid).toBe(uid);
    const forbidden = await apiFetch('/api/user/profile?userId=another-uid'); expect(forbidden.status).toBe(403);
    const noToken = await nativeFetch(baseUrl + '/api/cv/file'); expect(noToken.status).toBe(401);
  });
  it('TEST 7 — Sincronizza ora and empty/partial server POST never erase a complete CV', async () => {
    await upload();
    await apiFetch('/api/user/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uid, cvParsedData: expected }) });
    await apiFetch('/api/user/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uid, full_name: '', cvParsedData: getEmptyCvData() }) });
    expect((await (await apiFetch('/api/user/profile')).json()).data.cvParsedData).toEqual(expected);
    fireEvent.click(screen.getByText('Sincronizza ora'));
    await screen.findByText('Sintesi del CV'); expect(current()).toEqual(expected);
    external.docs.set(`users/${uid}`, { cvParsedData: { nome: expected.nome }, profile: {} });
    fireEvent.click(screen.getByText('Sincronizza ora'));
    await waitFor(() => expect(external.docs.get(`users/${uid}`).cvParsedData.esperienze).toHaveLength(2));
    expect(current()).toEqual(expected);
  });
  it('TEST 8 — after refresh readiness requires actual cvParsedData, never just a filename', async () => {
    const app = await upload(); app.unmount(); mount();
    await screen.findByText('Sintesi del CV'); expect(screen.getByTestId('saved').textContent).toBe('true'); expect(current()).toEqual(expected);
    cleanup(); localStorage.clear(); external.docs.set(`users/${uid}`, { uid, cvMetadata: { fileName: 'CV.pdf', contentHash: 'missing-file' } });
    mount(); await screen.findByLabelText('File CV');
    await waitFor(() => expect((screen.getByLabelText('File CV') as HTMLInputElement).disabled).toBe(false));
    expect(screen.getByTestId('saved').textContent).toBe('false'); expect(screen.queryByText('Dati CV salvati')).toBeNull();
  });
});

describe('Additional failure and original-attachment regression coverage', () => {
  it('recovers binary-only CV once, persists it, then refreshes without another parse', async () => {
    await persistCvFile(file(), uid); const first = await readCvSnapshot(uid);
    expect(first.document.cvParsedData).toEqual(expected); expect(modelCalls).toHaveLength(1);
    await readCvSnapshot(uid); expect(modelCalls).toHaveLength(1);
  });
  it('repairs the already-persisted legacy contact-only fallback from the original file', async () => {
    await persistCvFile(file(), uid);
    external.docs.set(`users/${uid}`, { cvParsedData: { email: 'fixture@example.test', esperienze: [], istruzione: [], lingue: [], permessoG: 'Idoneo' } });
    const loaded = await readCvSnapshot(uid);
    expect(loaded.document.cvParsedData).toEqual(expected);
    expect(modelCalls).toHaveLength(1);
  });
  it('parser quota failure is a failure and does not save a fabricated empty CV', async () => {
    modelFailure = true; const result = await aiAgent.parseCV(originalText);
    expect(result.success).toBe(false); expect(result.data).toBeUndefined(); expect(external.docs.has(`users/${uid}`)).toBe(false);
  });
  it('failed recovery does not loop on reload; explicit retry is allowed', async () => {
    await persistCvFile(file(), uid); modelFailure = true;
    await expect(readCvSnapshot(uid)).rejects.toThrow('Gemini quota test');
    await expect(readCvSnapshot(uid)).rejects.toThrow('Riprova analisi'); expect(modelCalls).toHaveLength(1);
    modelFailure = false; expect((await readCvSnapshot(uid, null, true)).document.cvParsedData).toEqual(expected);
  });
  it('Firestore write failure cannot be reported as successful persistence', async () => {
    external.failWrite = true;
    await expect(writeCvSnapshot(uid, expected)).rejects.toThrow('permission-denied');
    expect(localStorage.getItem(userCacheKey('cv', uid))).toBeNull();
  });
  it('account switch cannot load another account cache or unscoped current_cv', async () => {
    await upload(); cleanup();
    await saveCvToIndexedDb('current_cv', { filename: 'fake.pdf', mimeType: 'application/pdf', base64: btoa('fake'), sizeBytes: 4 });
    uid += '-different'; external.auth.currentUser = makeUser(uid); external.nextUser = makeUser(uid);
    mount(); await screen.findByLabelText('File CV');
    await waitFor(() => expect((screen.getByLabelText('File CV') as HTMLInputElement).disabled).toBe(false));
    expect(screen.getByTestId('saved').textContent).toBe('false'); expect(current()).toEqual(getEmptyCvData());
    expect((await getVerifiedCvAttachment()).ok).toBe(false);
  });
  it('Auto Mode attachment is byte-identical to the upload; generated/empty PDFs are blocked before Gmail', async () => {
    await upload();
    const attachment = await getVerifiedCvAttachment(); expect(attachment.ok).toBe(true);
    expect(Buffer.from(attachment.attachment!.base64, 'base64').toString('utf8')).toBe(originalText);
    expect(attachment.attachment!.filename).toBe('CV-originale-test.txt');
    const mime = buildRfc2822Mime({ to: 'recipient@example.test', subject: 'Test', bodyHtml: 'Test', attachment: attachment.attachment });
    const decoded = Buffer.from(mime.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const encodedAttachment = decoded.split('Content-Disposition: attachment;')[1].split('\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, '');
    expect(Buffer.from(encodedAttachment, 'base64').toString('utf8')).toBe(originalText);
    expect((await verifyOriginalAttachment(attachment.attachment)).ok).toBe(true);
    const result = await sendViaGmailApi({ to: 'recipient@example.test', subject: 'Test', bodyHtml: 'Test',
      attachment: { filename: 'cv.pdf', mimeType: 'application/pdf', base64: btoa('%PDF-1.4\nempty fake') } }, { interactive: false });
    expect(result.success).toBe(false); expect(result.error).toContain('non corrisponde');
    expect((await sendViaGmailApi({ to: 'recipient@example.test', subject: 'Test', bodyHtml: 'Test' }, { interactive: false })).success).toBe(false);
  });
  it('PDF upload keeps the entire original PDF in the parser request, storage and MIME attachment', async () => {
    const pdf = originalPdfBytes();
    const original = new NodeFile([pdf], 'CV-originale.pdf', { type: 'application/pdf' }) as unknown as File;
    mount(); await screen.findByLabelText('File CV');
    await waitFor(() => expect((screen.getByLabelText('File CV') as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('File CV'), { target: { files: [original] } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizza CV' }));
    await screen.findByText('Sintesi del CV');
    const originalBase64 = Buffer.from(pdf).toString('base64');
    expect(modelCalls[0].contents[0].parts[1].inlineData.data).toBe(originalBase64);
    const result = await getVerifiedCvAttachment();
    expect(result.attachment?.base64).toBe(originalBase64);
    expect(result.attachment?.filename).toBe('CV-originale.pdf');
    const mime = buildRfc2822Mime({ to: 'recipient@example.test', subject: 'Test', bodyHtml: 'Test', attachment: result.attachment });
    const decoded = Buffer.from(mime.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const encoded = decoded.split('Content-Disposition: attachment;')[1].split('\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, '');
    expect(encoded).toBe(originalBase64);
    expect((await verifyOriginalAttachment(result.attachment)).ok).toBe(true);
  });
  it('late legacy migration cannot overwrite a newer complete cloud CV', async () => {
    const newer = { ...expected, nome: 'Nome aggiornato test' };
    await writeCvSnapshot(uid, newer, undefined, true);
    await writeCvSnapshot(uid, expected);
    expect(external.docs.get(`users/${uid}`).cvParsedData.nome).toBe('Nome aggiornato test');
  });
  it('same-UID sent_emails history migrates to sentEmails without another user', async () => {
    external.docs.set(`users/${uid}/sent_emails/legacy-test`, { id: 'legacy-test', user_id: uid, email: 'fixture@example.test' });
    external.docs.set('users/other-user/sent_emails/private-test', { id: 'private-test', user_id: 'other-user' });
    const history = await aiAgent.getSentEmails(uid);
    expect(history.some(row => row.id === 'legacy-test')).toBe(true);
    expect(history.some(row => row.id === 'private-test')).toBe(false);
    expect(external.docs.get(`users/${uid}/sentEmails/legacy-test`).user_id).toBe(uid);
  });
  it('Gmail authorization alone is not inferred from Firebase login; expired tokens are ignored', () => {
    expect(getCachedGmailToken()).toBeNull();
    sessionStorage.setItem(`ais_workspace_gmail_${uid}`, JSON.stringify({ uid, email: 'fixture@example.test', token: 'expired', expiresAt: Date.now() - 1 }));
    expect(getCachedGmailToken()).toBeNull();
  });
});
