import { apiFetch, safeJsonResponse } from "./api/client";
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import { requireUid } from './api/client';
import { verifyOriginalAttachment } from './cvStorage';
import firebaseConfigJson from '../../firebase-applet-config.json';

export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];
export type GmailGrant = { uid: string; email: string; token: string; expiresAt: number; scopes?: string[] };
let activeUid: string | null = null;
let activeGrant: GmailGrant | null = null;
const changed = () => window.dispatchEvent(new Event('gmail-authorization-changed'));

let isReauthRequired = false;
let pendingTokenPromise: Promise<string | null> | null = null;

function grant(): GmailGrant | null {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  
  if (activeGrant && activeGrant.uid === uid && activeGrant.token && activeGrant.expiresAt > Date.now()) {
    return activeGrant;
  }
  
  return null;
}

export async function fetchValidGmailToken(): Promise<string | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  
  // Check if we have a valid token in memory
  if (activeGrant && activeGrant.uid === uid && activeGrant.token && activeGrant.expiresAt > Date.now()) {
    return activeGrant.token;
  }

  // Prevent spamming the backend if we already know re-authentication is required
  if (isReauthRequired) {
    return null;
  }

  // Request Collapsing: If there is already an active request fetching the token, reuse it!
  if (pendingTokenPromise) {
    return pendingTokenPromise;
  }

  pendingTokenPromise = (async () => {
    try {
      const tokenResponse = await apiFetch('/api/oauth/token', { method: 'GET' });
      const res = await safeJsonResponse(tokenResponse);
      
      if (res.success && res.access_token) {
        activeGrant = {
          uid,
          email: res.email,
          token: res.access_token,
          expiresAt: res.expires_at,
          scopes: res.scopes
        };
        activeUid = uid;
        isReauthRequired = false;
        changed();
        return res.access_token;
      } else if (res.requires_reauth || res.error === 'requires_reauth' || res.error === 'invalid_grant') {
        console.info('[workspaceAuth] Backend indicated re-authentication is required:', res);
        activeGrant = null;
        isReauthRequired = true;
        changed();
        return null;
      }
    } catch (e: any) {
      console.warn('[workspaceAuth] Error fetching valid gmail token from backend:', e?.message || e);
    } finally {
      pendingTokenPromise = null;
    }
    return null;
  })();

  return pendingTokenPromise;
}

export const getCachedGmailToken = () => grant()?.token || null;
export const getCachedGmailEmail = () => grant()?.email || null;
export const getCachedGmailGrant = () => grant();

export function hasGmailReadScope(): boolean {
  const g = grant();
  if (!g || !g.token) return false;
  if (!g.scopes || g.scopes.length === 0) return true; // optimist fallback if scope array wasn't recorded
  return g.scopes.some(s =>
    s.includes('gmail.readonly') ||
    s.includes('mail.google.com') ||
    s.includes('gmail.modify')
  );
}

export function clearGmailToken() {
  isReauthRequired = false;
  pendingTokenPromise = null;
  try {
    if (activeUid) localStorage.removeItem(`ais_workspace_gmail_${activeUid}`);
    if (auth.currentUser?.uid) localStorage.removeItem(`ais_workspace_gmail_${auth.currentUser.uid}`);
    for (const old of ['ais_workspace_gmail_token', 'ais_workspace_gmail_email', 'ais_workspace_gmail_expiry']) localStorage.removeItem(old);
  } catch { /* Cache access must not prevent Firebase logout. */ }
  activeUid = null;
  activeGrant = null;
  
  // Also delete from backend
  try {
    if (auth.currentUser) {
      apiFetch('/api/oauth/token', { method: 'DELETE' }).catch(() => {});
    }
  } catch {}
  
  changed();
}
export function initWorkspaceAuth(onSuccess?: (user: User, token: string) => void, onFailure?: () => void) {
  return onAuthStateChanged(auth, async user => {
    if (activeUid && activeUid !== user?.uid) clearGmailToken();
    activeUid = user?.uid || null;
    
    if (user) {
      const token = await fetchValidGmailToken();
      if (token) {
        onSuccess?.(user, token);
      } else {
        onFailure?.();
      }
    } else {
      onFailure?.();
    }
  });
}
async function ensureGisLoaded() {
  if ((window as any).google?.accounts?.oauth2) return;
  await new Promise<void>((resolve, reject) => {
    let script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]') as HTMLScriptElement;
    if (!script) { script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; document.head.appendChild(script); }
    const timer = setTimeout(() => reject(new Error('Servizio di autorizzazione Google non disponibile')), 10000);
    script.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
    script.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Caricamento Google non riuscito')); }, { once: true });
  });
}
export async function connectGmailAccount(_forceConsent = false): Promise<{ success: boolean; email?: string; accessToken?: string; error?: string }> {
  try {
    const uid = requireUid();
    const firebaseUser = auth.currentUser!;
    await ensureGisLoaded();
    const clientId = (firebaseConfigJson as any).oAuthClientId || (import.meta as any).env?.VITE_GOOGLE_OAUTH_CLIENT_ID || '90372536237-3brdejbh42jtjj5o4tlq7gs28ek7t3s7.apps.googleusercontent.com';
    if (!clientId) throw new Error('OAuth Client ID Gmail non configurato');
    
    console.info('[workspaceAuth] Initiating GIS code client request...');
    const gisResult: any = await new Promise((resolve, reject) => {
      const client = (window as any).google.accounts.oauth2.initCodeClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        ux_mode: 'popup',
        access_type: 'offline',
        prompt: 'consent',
        callback: (result: any) => result.code ? resolve(result) : reject(new Error(result.error_description || result.error || 'Autorizzazione non concessa')),
        error_callback: (err: any) => reject(new Error(err?.message || 'Autorizzazione Gmail annullata o popup bloccato. Apri l’app in una nuova scheda e riprova.')),
      });
      client.requestCode({ login_hint: firebaseUser.email || undefined });
    });
    
    if (!gisResult || !gisResult.code) {
      throw new Error('Nessun codice di autorizzazione ottenuto da Google.');
    }

    console.info('[workspaceAuth] Exchanging auth code with /api/oauth/exchange...');
    const exchangeResponse = await apiFetch('/api/oauth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: gisResult.code })
    });
    
    const res = await safeJsonResponse(exchangeResponse);
    
    if (!res.success) {
      console.error('[workspaceAuth] Code exchange error response:', res);
      throw new Error(res.error || res.message || 'Errore durante lo scambio del codice di autorizzazione col server.');
    }

    requireUid(uid);
    const data: GmailGrant = {
      uid,
      email: res.email,
      token: res.access_token,
      expiresAt: res.expires_at,
      scopes: res.scopes,
    };
    
    activeUid = uid; 
    activeGrant = data;
    isReauthRequired = false;
    pendingTokenPromise = null;
    changed();
    return { success: true, email: data.email, accessToken: data.token };
  } catch (error: any) {
    console.error('[workspaceAuth] connectGmailAccount error:', error);
    return { success: false, error: error.message || 'Errore durante l’autorizzazione Gmail' };
  }
}
export async function disconnectGmailAccount() { clearGmailToken(); }

export interface SendEmailPayload {
  to: string;
  subject: string;
  bodyHtml: string;
  fromEmail?: string;
  attachment?: {
    filename: string;
    mimeType: string;
    base64: string;
  };
}

// UTF-8 safe Base64 URL converter
function toBase64UrlSafe(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Builds an RFC 2822 compliant MIME message string for Gmail API
export function buildRfc2822Mime({
  to,
  subject,
  bodyHtml,
  fromEmail,
  attachment,
}: SendEmailPayload): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const encodedSubject = `=?UTF-8?B?${toBase64UrlSafe(subject).replace(/-/g, '+').replace(/_/g, '/')}?=`;

  const headers: string[] = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
  ];

  if (fromEmail) {
    headers.unshift(`From: ${fromEmail}`);
  }

  // Format HTML with line breaks and styles, ensuring newlines in signature or text are converted to <br>
  const formattedHtmlBody = bodyHtml
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('<br>')
    .replace(/(<br\s*\/?>){3,}/gi, '<br><br>');

  const cleanHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #222; margin: 0; padding: 12px; }
    b { font-weight: 600; color: #111; }
    p { margin: 0 0 12px 0; }
  </style>
</head>
<body>
  <div>${formattedHtmlBody}</div>
</body>
</html>`;

  let mimeContent = '';

  if (attachment && attachment.base64) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    // Clean base64 string
    const cleanBase64 = attachment.base64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    const chunkedBase64 = cleanBase64.match(/.{1,76}/g)?.join('\r\n') || cleanBase64;

    const parts = [
      headers.join('\r\n'),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      cleanHtml,
      '',
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType || 'application/pdf'}; name="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      chunkedBase64,
      '',
      `--${boundary}--`,
    ];

    mimeContent = parts.join('\r\n');
  } else {
    headers.push('Content-Type: text/html; charset="UTF-8"');
    headers.push('Content-Transfer-Encoding: 8bit');

    mimeContent = `${headers.join('\r\n')}\r\n\r\n${cleanHtml}`;
  }

  return toBase64UrlSafe(mimeContent);
}

export interface SendEmailOptions {
  interactive?: boolean;
}

// Send real email using Google Gmail API
export async function sendViaGmailApi(
  payload: SendEmailPayload,
  options: SendEmailOptions = { interactive: true }
): Promise<{
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
  needsInteractiveAuth?: boolean;
}> {
  const checked = await verifyOriginalAttachment(payload.attachment);
  if (!checked.ok) return { success: false, error: checked.error };
  const sendingUid = requireUid();
  let token = await fetchValidGmailToken();

  // If token is missing, attempt interactive connect ONLY if requested
  if (!token) {
    if (!options.interactive) {
      // In non-interactive automode: do NOT attempt popup authorization because browser blocks popups without user gesture
      return {
        success: false,
        error: 'Autorizzazione Gmail assente o scaduta. Ricollega Gmail per riprendere.',
        needsInteractiveAuth: true,
      };
    }

    const connectRes = await connectGmailAccount(true);
    if (!connectRes.success || !connectRes.accessToken) {
      return {
        success: false,
        error: 'Autorizzazione Gmail richiesta. Clicca su "Invia Email" o "Connetti Gmail" e consenti il permesso di invio.',
        needsInteractiveAuth: true,
      };
    }
    token = connectRes.accessToken;
  }

  requireUid(sendingUid);
  const rawMessage = buildRfc2822Mime(payload);

  try {
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: rawMessage }),
    });

    // If unauthorized or insufficient scopes, clear cached token
    if (response.status === 401 || response.status === 403) {
      const errBody = await safeJsonResponse(response);
      const errMsg = errBody?.error?.message || errBody?.error || '';
      console.warn('[GmailApi] Auth error from Gmail API:', response.status, errMsg);

      clearGmailToken();

      if (!options.interactive) {
        return {
          success: false,
          error: 'Token Gmail scaduto o non valido.',
          needsInteractiveAuth: true,
        };
      }

      // Automatically try to request fresh consent once in interactive mode
      const retryAuth = await connectGmailAccount(true);
      if (retryAuth.success && retryAuth.accessToken) {
        requireUid(sendingUid);
        const retryRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${retryAuth.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw: rawMessage }),
        });

        if (retryRes.ok) {
          const retryData = await safeJsonResponse(retryRes);
          return {
            success: true,
            messageId: retryData.id,
            threadId: retryData.threadId,
          };
        }

        const retryErrBody = await safeJsonResponse(retryRes);
        return {
          success: false,
          error: retryErrBody?.error?.message || retryErrBody?.error || 'Permesso di invio Gmail non concesso. Accetta il permesso nella finestra di autorizzazione.',
        };
      }

      return {
        success: false,
        error: 'Permessi Gmail insufficienti: accetta la richiesta di autorizzazione Google per inviare le candidature dal tuo account.',
      };
    }

    if (!response.ok) {
      const errorJson = await safeJsonResponse(response);
      const msg = errorJson?.error?.message || errorJson?.error || `Errore Gmail API (${response.status} ${response.statusText})`;
      return { success: false, error: msg };
    }

    const data = await safeJsonResponse(response);
    return {
      success: true,
      messageId: data.id,
      threadId: data.threadId,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Errore di connessione con il servizio Gmail',
    };
  }
}

export interface GmailSentMessageInfo {
  id: string;
  threadId: string;
  internalDate: string;
  sentAt: string;
  to: string;
  recipientEmail: string;
  recipientName: string;
  domain: string;
  subject: string;
  bodySnippet: string;
  bodyText?: string;
  bodyHtml?: string;
  attachments: string[];
  cvFilename?: string;
  isOutreach: boolean;
}

function decodeBase64Url(base64UrlStr: string): string {
  try {
    const base64 = base64UrlStr.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

function parseRecipient(toHeader: string): { email: string; name: string } {
  if (!toHeader) return { email: '', name: '' };
  const match = toHeader.match(/(.*?)\s*<([^>]+)>/);
  if (match) {
    const name = match[1].replace(/["']/g, '').trim();
    const email = match[2].trim().toLowerCase();
    return { email, name };
  }
  return { email: toHeader.replace(/["']/g, '').trim().toLowerCase(), name: '' };
}

function extractPartsInfo(payload: any): { attachments: string[]; textBody: string; htmlBody: string } {
  const attachments: string[] = [];
  let textBody = '';
  let htmlBody = '';

  function walk(part: any) {
    if (!part) return;
    if (part.filename && part.filename.length > 0) {
      attachments.push(part.filename);
    }
    if (part.mimeType === 'text/plain' && part.body?.data && !textBody) {
      textBody = decodeBase64Url(part.body.data);
    }
    if (part.mimeType === 'text/html' && part.body?.data && !htmlBody) {
      htmlBody = decodeBase64Url(part.body.data);
    }
    if (Array.isArray(part.parts)) {
      for (const sub of part.parts) {
        walk(sub);
      }
    }
  }

  if (payload) {
    walk(payload);
  }

  return { attachments, textBody, htmlBody };
}

export async function fetchSentGmailMessages(options?: {
  maxResults?: number;
  newerThanDays?: number;
  knownCompanyDomains?: Set<string>;
  knownCompanyEmails?: Set<string>;
}): Promise<{
  success: boolean;
  messages: GmailSentMessageInfo[];
  needsReadAuth?: boolean;
  error?: string;
}> {
  const token = await fetchValidGmailToken();
  if (!token) {
    return {
      success: false,
      messages: [],
      error: 'Account Gmail non collegato o sessione scaduta',
      needsReadAuth: true,
    };
  }

  try {
    // Strictly cap window to max 3 days
    const days = Math.min(Math.max(Number(options?.newerThanDays) || 3, 1), 3);
    const query = encodeURIComponent(`in:sent newer_than:${days}d`);
    const limit = Math.min(options?.maxResults || 50, 50);

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      }
    );

    if (listRes.status === 401 || listRes.status === 403) {
      const err = await safeJsonResponse(listRes);
      return {
        success: false,
        messages: [],
        needsReadAuth: true,
        error: err?.error?.message || err?.error || 'Permesso di lettura Gmail non concesso. Autorizza l’accesso per recuperare lo storico.',
      };
    }

    if (!listRes.ok) {
      const err = await safeJsonResponse(listRes);
      return {
        success: false,
        messages: [],
        error: err?.error?.message || err?.error || `Errore lettura Gmail (${listRes.status})`,
      };
    }

    const listData = await safeJsonResponse(listRes);
    const rawList: { id: string; threadId: string }[] = listData.messages || [];
    if (rawList.length === 0) {
      return { success: true, messages: [] };
    }

    // Code-level hard boundary: exactly 72 hours / 3 days
    const MAX_LOOKBACK_MS = days * 24 * 60 * 60 * 1000;
    const cutoffTimeMs = Date.now() - MAX_LOOKBACK_MS;

    const results: GmailSentMessageInfo[] = [];
    const batchSize = 6;
    for (let i = 0; i < rawList.length; i += batchSize) {
      const chunk = rawList.slice(i, i + batchSize);
      const chunkResults = await Promise.all(
        chunk.map(async (item) => {
          try {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: 'application/json',
                },
              }
            );
            if (!msgRes.ok) return null;
            const msgData = await safeJsonResponse(msgRes);
            const headers = msgData.payload?.headers || [];
            const getHeader = (name: string) =>
              headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

            const to = getHeader('To');
            const subject = getHeader('Subject');
            const dateStr = getHeader('Date');
            const { email: recipientEmail, name: recipientName } = parseRecipient(to);
            const domain = recipientEmail.includes('@') ? recipientEmail.split('@')[1].toLowerCase().trim() : '';

            const internalMs = Number(msgData.internalDate);
            const messageTimeMs = !isNaN(internalMs) && internalMs > 0
              ? internalMs
              : (dateStr ? new Date(dateStr).getTime() : 0);

            // HARD CODE-LEVEL BARRIER: Discard anything older than 3 days / 72 hours
            if (!messageTimeMs || messageTimeMs < cutoffTimeMs) {
              return null;
            }

            const sentAt = new Date(messageTimeMs).toISOString();

            const { attachments, textBody, htmlBody } = extractPartsInfo(msgData.payload);
            const bodySnippet = (msgData.snippet || textBody || htmlBody || '').slice(0, 1000);

            // Check if recipient is a saved company in the app
            const matchesKnownCompany = Boolean(
              (options?.knownCompanyEmails && options.knownCompanyEmails.has(recipientEmail.toLowerCase())) ||
              (domain && options?.knownCompanyDomains && options.knownCompanyDomains.has(domain))
            );

            // Check if sent using the Lavoro2026 app
            const matchesAppTemplate = Boolean(
              getHeader('X-Mailer').includes('Lavoro2026') ||
              htmlBody.includes('Lavoro2026') ||
              textBody.includes('Lavoro2026') ||
              (htmlBody.includes('-apple-system, BlinkMacSystemFont') && htmlBody.includes('font-family'))
            );

            // Filter out obvious administrative, municipal, or utility emails (unless sent via the app)
            const isAdministrativeOrPersonal =
              /comoacqua|oxford|comune\.|demografic|servizio.*clienti|fattur|bollett|utenza|recupero.*credit|newsletter|no-?reply|assistenza|support@|ricevuta|ordine|conferma.*ordine|bonifico|inps|agenzia.*entrate/i.test(
                `${recipientEmail} ${recipientName} ${subject}`
              );

            const subjectLower = (subject || '').toLowerCase();
            const bodyLower = `${bodySnippet} ${textBody}`.toLowerCase();

            const hasApplicationSubject =
              subjectLower.includes('candidatura') ||
              subjectLower.includes('curriculum') ||
              subjectLower.includes('cv') ||
              subjectLower.includes('lettera di presentazione') ||
              subjectLower.includes('application') ||
              subjectLower.includes('autocandidatura');

            const hasApplicationBody =
              bodyLower.includes('candidatura') ||
              bodyLower.includes('curriculum vitae') ||
              bodyLower.includes('allego il mio cv') ||
              bodyLower.includes('allego curriculum') ||
              bodyLower.includes('in allegato il mio cv') ||
              bodyLower.includes('risorse umane') ||
              bodyLower.includes('spontaneous application');

            const cvFilename = attachments.find((f) => {
              const fn = f.toLowerCase();
              return fn.endsWith('.pdf') && (fn.includes('cv') || fn.includes('curriculum') || fn.includes('resume') || fn.includes('profilo'));
            }) || attachments.find((f) => f.toLowerCase().endsWith('.pdf'));

            // Balanced outreach classification:
            // 1. Matches app template/headers -> always outreach
            // 2. Matches known company saved by user -> always outreach
            // 3. Otherwise: must NOT be administrative/personal AND must have genuine application signals
            const isOutreach = Boolean(
              matchesAppTemplate ||
              matchesKnownCompany ||
              (!isAdministrativeOrPersonal && (
                (hasApplicationSubject && (Boolean(cvFilename) || hasApplicationBody)) ||
                (hasApplicationSubject) ||
                (Boolean(cvFilename) && hasApplicationBody)
              ))
            );

            return {
              id: msgData.id,
              threadId: msgData.threadId || item.threadId,
              internalDate: msgData.internalDate,
              sentAt,
              to,
              recipientEmail,
              recipientName,
              domain,
              subject,
              bodySnippet,
              bodyText: textBody,
              bodyHtml: htmlBody,
              attachments,
              cvFilename,
              isOutreach,
            };
          } catch {
            return null;
          }
        })
      );

      for (const res of chunkResults) {
        if (res) results.push(res);
      }
    }

    return { success: true, messages: results };
  } catch (err: any) {
    return {
      success: false,
      messages: [],
      error: err?.message || 'Errore di comunicazione con Gmail',
    };
  }
}
