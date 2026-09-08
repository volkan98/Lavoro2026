import {
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import { auth } from './firebase';
import firebaseConfigJson from '../../firebase-applet-config.json';

// Workspace Scopes configured via set_up_oauth
export const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

const SESSION_TOKEN_KEY = 'ais_workspace_gmail_token';
const SESSION_EMAIL_KEY = 'ais_workspace_gmail_email';
const SESSION_EXPIRY_KEY = 'ais_workspace_gmail_expiry';

// In-memory token cache backed by sessionStorage for active browser sessions
let cachedAccessToken: string | null = null;
let cachedUserEmail: string | null = null;
let isSigningIn = false;

// Initialize Google Auth Provider with Gmail scopes
function createGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({
    prompt: 'consent select_account',
    access_type: 'offline',
  });
  return provider;
}

export function getCachedGmailToken(): string | null {
  if (cachedAccessToken) return cachedAccessToken;
  try {
    const saved = sessionStorage.getItem(SESSION_TOKEN_KEY);
    const expiry = sessionStorage.getItem(SESSION_EXPIRY_KEY);
    if (saved) {
      if (!expiry || Date.now() < parseInt(expiry, 10)) {
        cachedAccessToken = saved;
        const savedEmail = sessionStorage.getItem(SESSION_EMAIL_KEY);
        if (savedEmail) cachedUserEmail = savedEmail;
        return saved;
      } else {
        // Expired
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        sessionStorage.removeItem(SESSION_EXPIRY_KEY);
      }
    }
  } catch {}
  return null;
}

export function setCachedGmailToken(token: string | null, email?: string | null, expiresInSeconds = 3500) {
  cachedAccessToken = token;
  if (email) cachedUserEmail = email;
  try {
    if (token) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, token);
      sessionStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + expiresInSeconds * 1000));
      if (email) sessionStorage.setItem(SESSION_EMAIL_KEY, email);
    } else {
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      sessionStorage.removeItem(SESSION_EXPIRY_KEY);
      sessionStorage.removeItem(SESSION_EMAIL_KEY);
    }
  } catch {}
}

export function getCachedGmailEmail(): string | null {
  if (cachedUserEmail) return cachedUserEmail;
  try {
    const savedEmail = sessionStorage.getItem(SESSION_EMAIL_KEY);
    if (savedEmail) {
      cachedUserEmail = savedEmail;
      return savedEmail;
    }
  } catch {}
  return null;
}

export function clearGmailToken() {
  cachedAccessToken = null;
  cachedUserEmail = null;
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_EXPIRY_KEY);
    sessionStorage.removeItem(SESSION_EMAIL_KEY);
  } catch {}
}

// Ensure Google Identity Services script is available
function ensureGisLoaded(): Promise<boolean> {
  return new Promise((resolve) => {
    const w = window as any;
    if (w.google?.accounts?.oauth2) {
      return resolve(true);
    }
    let script = document.querySelector('script[src*="accounts.google.com/gsi/client"]') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }
    const timer = setInterval(() => {
      if (w.google?.accounts?.oauth2) {
        clearInterval(timer);
        resolve(true);
      }
    }, 100);
    setTimeout(() => {
      clearInterval(timer);
      resolve(!!w.google?.accounts?.oauth2);
    }, 3000);
  });
}

// Request token via Google Identity Services Token Client
function requestGisToken(): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const clientId = (firebaseConfigJson as any).oAuthClientId;
    if (!clientId) {
      return reject(new Error('OAuth Client ID non configurato in firebase-applet-config.json'));
    }

    const w = window as any;
    if (!w.google?.accounts?.oauth2) {
      const loaded = await ensureGisLoaded();
      if (!loaded || !w.google?.accounts?.oauth2) {
        return reject(new Error('Servizio Google Identity non disponibile'));
      }
    }

    try {
      const client = w.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        callback: (resp: any) => {
          if (resp && resp.access_token) {
            setCachedGmailToken(resp.access_token, undefined, resp.expires_in ? parseInt(resp.expires_in, 10) : 3500);
            resolve(resp.access_token);
          } else if (resp && resp.error) {
            const errDesc = resp.error_description || resp.error;
            reject(new Error(errDesc));
          } else {
            reject(new Error('Nessun token di accesso ricevuto da Google'));
          }
        },
        error_callback: (err: any) => {
          console.warn('[WorkspaceAuth] GIS error callback:', err);
          if (err?.type === 'popup_failed_to_open' || String(err?.message || '').includes('popup')) {
            reject(new Error('Popup bloccato dal browser. Consenti i popup per questa pagina o apri l\'app in una nuova scheda.'));
          } else {
            reject(new Error(err?.message || 'Errore nella finestra di autorizzazione Google'));
          }
        },
      });

      // Synchronously launch popup request
      client.requestAccessToken({ prompt: 'consent' });
    } catch (err: any) {
      reject(err);
    }
  });
}

// Listen to auth state to clear token on logout
export function initWorkspaceAuth(
  onSuccess?: (user: User, token: string) => void,
  onFailure?: () => void
) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      cachedUserEmail = user.email || null;
      if (cachedAccessToken) {
        if (onSuccess) onSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        if (onFailure) onFailure();
      }
    } else {
      cachedAccessToken = null;
      cachedUserEmail = null;
      if (onFailure) onFailure();
    }
  });
}

// Authenticate user and obtain Gmail Send OAuth token
export async function connectGmailAccount(forceConsent = false): Promise<{
  success: boolean;
  email?: string;
  accessToken?: string;
  error?: string;
}> {
  isSigningIn = true;
  try {
    // 1. First try Google Identity Services Token Client (dedicated for Workspace scopes & interactive popup)
    try {
      const gisToken = await requestGisToken();
      if (gisToken) {
        cachedAccessToken = gisToken;
        const userEmail = cachedUserEmail || auth.currentUser?.email || 'blunero90@gmail.com';
        return {
          success: true,
          email: userEmail,
          accessToken: gisToken,
        };
      }
    } catch (gisErr: any) {
      console.warn('[WorkspaceAuth] GIS error, falling back to Firebase popup:', gisErr?.message);
    }

    // 2. Fallback: Firebase Auth with GoogleAuthProvider
    const provider = createGoogleProvider();
    if (forceConsent) {
      provider.setCustomParameters({
        prompt: 'consent select_account',
        access_type: 'offline',
      });
    }

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);

    if (credential?.accessToken) {
      cachedAccessToken = credential.accessToken;
      cachedUserEmail = result.user.email || null;
      return {
        success: true,
        email: result.user.email || 'utente@gmail.com',
        accessToken: cachedAccessToken,
      };
    }

    if (result.user.email) {
      cachedUserEmail = result.user.email;
    }

    throw new Error('Permesso Gmail non rilasciato dal popup');
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Errore di autenticazione con Google',
    };
  } finally {
    isSigningIn = false;
  }
}

export async function disconnectGmailAccount() {
  cachedAccessToken = null;
  cachedUserEmail = null;
  await signOut(auth).catch(() => {});
}

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
  let token = getCachedGmailToken();

  // If token is missing, attempt interactive connect ONLY if requested
  if (!token) {
    if (!options.interactive) {
      // In non-interactive automode: do NOT attempt popup authorization because browser blocks popups without user gesture
      return {
        success: false,
        error: 'Token Gmail non presente in sessione; invio tramite canale proxy.',
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
