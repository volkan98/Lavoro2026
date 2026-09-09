import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import { requireUid } from './api/client';
import { verifyOriginalAttachment } from './cvStorage';
import firebaseConfigJson from '../../firebase-applet-config.json';

export const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'];
type GmailGrant = { uid: string; email: string; token: string; expiresAt: number };
const key = (uid: string) => `ais_workspace_gmail_${uid}`;
let activeUid: string | null = null;
const changed = () => window.dispatchEvent(new Event('gmail-authorization-changed'));
function grant(): GmailGrant | null {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const data = JSON.parse(sessionStorage.getItem(key(uid)) || 'null');
    if (data?.uid === uid && data.token && data.email && data.expiresAt > Date.now()) return data;
  } catch { /* Invalid cache is never a grant. */ }
  return null;
}
export const getCachedGmailToken = () => grant()?.token || null;
export const getCachedGmailEmail = () => grant()?.email || null;
export function clearGmailToken() {
  try {
    for (const uid of [activeUid, auth.currentUser?.uid]) if (uid) sessionStorage.removeItem(key(uid));
    for (const old of ['ais_workspace_gmail_token', 'ais_workspace_gmail_email', 'ais_workspace_gmail_expiry']) sessionStorage.removeItem(old);
  } catch { /* Cache access must not prevent Firebase logout. */ }
  activeUid = null;
  changed();
}
export function initWorkspaceAuth(onSuccess?: (user: User, token: string) => void, onFailure?: () => void) {
  return onAuthStateChanged(auth, user => {
    if (activeUid && activeUid !== user?.uid) clearGmailToken();
    activeUid = user?.uid || null;
    const token = getCachedGmailToken();
    if (user && token) onSuccess?.(user, token); else onFailure?.();
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
    const clientId = (firebaseConfigJson as any).oAuthClientId;
    if (!clientId) throw new Error('OAuth Client ID Gmail non configurato');
    const response: any = await new Promise((resolve, reject) => {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPES.join(' '),
        callback: (result: any) => result.access_token ? resolve(result) : reject(new Error(result.error_description || result.error || 'Autorizzazione non concessa')),
        error_callback: () => reject(new Error('Autorizzazione Gmail annullata o popup bloccato. Apri l’app in una nuova scheda e riprova.')),
      });
      client.requestAccessToken({ prompt: 'consent', login_hint: firebaseUser.email || undefined });
    });
    requireUid(uid);
    if (!(response.scope || '').split(' ').includes('https://www.googleapis.com/auth/gmail.send')) throw new Error('Permesso di invio Gmail non concesso');
    const result = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${response.access_token}` } });
    if (!result.ok) throw new Error('Impossibile verificare l’account Gmail autorizzato');
    const info = await result.json();
    requireUid(uid);
    const googleIdentity = firebaseUser.providerData.find(p => p.providerId === 'google.com');
    const sameAccount = googleIdentity ? info.sub === googleIdentity.uid
      : firebaseUser.emailVerified && info.email_verified && info.email?.toLowerCase() === firebaseUser.email?.toLowerCase();
    if (!sameAccount || !info.email) throw new Error('L’account Gmail deve corrispondere all’utente Firebase che ha effettuato l’accesso.');
    const data: GmailGrant = { uid, email: info.email, token: response.access_token,
      expiresAt: Date.now() + Math.max(0, Number(response.expires_in || 0) - 60) * 1000 };
    sessionStorage.setItem(key(uid), JSON.stringify(data)); activeUid = uid; changed();
    return { success: true, email: data.email, accessToken: data.token };
  } catch (error: any) { return { success: false, error: error.message }; }
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
  let token = getCachedGmailToken();

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
      const errBody = await response.json().catch(() => ({}));
      const errMsg = errBody?.error?.message || '';
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
          const retryData = await retryRes.json();
          return {
            success: true,
            messageId: retryData.id,
            threadId: retryData.threadId,
          };
        }

        const retryErrBody = await retryRes.json().catch(() => ({}));
        return {
          success: false,
          error: retryErrBody?.error?.message || 'Permesso di invio Gmail non concesso. Accetta il permesso nella finestra di autorizzazione.',
        };
      }

      return {
        success: false,
        error: 'Permessi Gmail insufficienti: accetta la richiesta di autorizzazione Google per inviare le candidature dal tuo account.',
      };
    }

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const msg = errorJson?.error?.message || `Errore Gmail API (${response.status} ${response.statusText})`;
      return { success: false, error: msg };
    }

    const data = await response.json();
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
