const fs = require('fs');
let code = fs.readFileSync('src/lib/workspaceAuth.ts', 'utf8');

// Replace connectGmailAccount to use code flow
const connectRegex = /export async function connectGmailAccount\(_forceConsent = false\): Promise<\{ success: boolean; email\?: string; accessToken\?: string; error\?: string \}> \{[\s\S]*?localStorage\.setItem\(key\(uid\), JSON\.stringify\(data\)\); activeUid = uid; changed\(\);\n    return \{ success: true, email: data\.email, accessToken: data\.token \};\n  \} catch \(error: any\) \{ return \{ success: false, error: error\.message \}; \}\n\}/;

const newConnectCode = `export async function connectGmailAccount(_forceConsent = false): Promise<{ success: boolean; email?: string; accessToken?: string; error?: string }> {
  try {
    const uid = requireUid();
    const firebaseUser = auth.currentUser!;
    await ensureGisLoaded();
    const clientId = (firebaseConfigJson as any).oAuthClientId || (import.meta as any).env?.VITE_GOOGLE_OAUTH_CLIENT_ID || '90372536237-3brdejbh42jtjj5o4tlq7gs28ek7t3s7.apps.googleusercontent.com';
    if (!clientId) throw new Error('OAuth Client ID Gmail non configurato');
    const response: any = await new Promise((resolve, reject) => {
      const client = (window as any).google.accounts.oauth2.initCodeClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        ux_mode: 'popup',
        access_type: 'offline',
        prompt: 'consent',
        callback: (result: any) => result.code ? resolve(result) : reject(new Error(result.error_description || result.error || 'Autorizzazione non concessa')),
        error_callback: () => reject(new Error('Autorizzazione Gmail annullata o popup bloccato. Apri l’app in una nuova scheda e riprova.')),
      });
      client.requestCode({ login_hint: firebaseUser.email || undefined });
    });
    
    // Send code to backend
    const res = await apiFetch('/api/oauth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: response.code })
    });
    
    if (!res.success) {
      throw new Error(res.error || 'Failed to exchange code');
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
    changed();
    return { success: true, email: data.email, accessToken: data.token };
  } catch (error: any) { return { success: false, error: error.message }; }
}`;

code = code.replace(connectRegex, newConnectCode);

// Replace getCachedGmailToken to use an activeGrant variable instead of localStorage
const grantRegex = /let activeUid: string \| null = null;\nconst changed = \(\) => window\.dispatchEvent\(new Event\('gmail-authorization-changed'\)\);\nfunction grant\(\): GmailGrant \| null \{\n  const uid = auth\.currentUser\?\.uid;\n  if \(!uid\) return null;\n  try \{\n    const data = JSON\.parse\(localStorage\.getItem\(key\(uid\)\) \|\| 'null'\);\n    if \(data\?\.uid === uid && data\.token && data\.email && data\.expiresAt > Date\.now\(\)\) return data;\n  \} catch \{ \/\* Invalid cache is never a grant\. \*\/ \}\n  return null;\n\}/;

const newGrantCode = `let activeUid: string | null = null;
let activeGrant: GmailGrant | null = null;
const changed = () => window.dispatchEvent(new Event('gmail-authorization-changed'));

function grant(): GmailGrant | null {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  
  if (activeGrant && activeGrant.uid === uid && activeGrant.token && activeGrant.expiresAt > Date.now()) {
    return activeGrant;
  }
  
  // Migration from localStorage (if backend token fails or hasn't loaded yet)
  try {
    const data = JSON.parse(localStorage.getItem(key(uid)) || 'null');
    if (data?.uid === uid && data.token && data.email && data.expiresAt > Date.now()) return data;
  } catch {}
  
  return null;
}

export async function fetchValidGmailToken(): Promise<string | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  
  // Check if we have a valid token in memory
  if (activeGrant && activeGrant.uid === uid && activeGrant.token && activeGrant.expiresAt > Date.now()) {
    return activeGrant.token;
  }
  
  try {
    const res = await apiFetch('/api/oauth/token', { method: 'GET' });
    if (res.success && res.access_token) {
      activeGrant = {
        uid,
        email: res.email,
        token: res.access_token,
        expiresAt: res.expires_at,
        scopes: res.scopes
      };
      activeUid = uid;
      changed();
      return res.access_token;
    }
  } catch (e: any) {
    if (e.message === 'invalid_grant') {
      // Refresh token revoked
      activeGrant = null;
      changed();
    }
    console.error('Failed to fetch valid gmail token from backend', e);
  }
  
  return grant()?.token || null;
}`;

code = code.replace(grantRegex, newGrantCode);

// Update initWorkspaceAuth to fetch from backend
const initRegex = /export function initWorkspaceAuth\(onSuccess\?: \(user: User, token: string\) => void, onFailure\?: \(\) => void\) \{\n  return onAuthStateChanged\(auth, user => \{\n    if \(activeUid && activeUid !== user\?\.uid\) clearGmailToken\(\);\n    activeUid = user\?\.uid \|\| null;\n    const token = getCachedGmailToken\(\);\n    if \(user && token\) onSuccess\?\.\(user, token\); else onFailure\?\.\(\);\n  \}\);\n\}/;

const newInitCode = `export function initWorkspaceAuth(onSuccess?: (user: User, token: string) => void, onFailure?: () => void) {
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
}`;

code = code.replace(initRegex, newInitCode);

// Update clearGmailToken to also delete from backend
const clearRegex = /export function clearGmailToken\(\) \{[\s\S]*?activeUid = null;\n  changed\(\);\n\}/;

const newClearCode = `export function clearGmailToken() {
  try {
    for (const uid of [activeUid, auth.currentUser?.uid]) if (uid) localStorage.removeItem(key(uid));
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
}`;

code = code.replace(clearRegex, newClearCode);

fs.writeFileSync('src/lib/workspaceAuth.ts', code, 'utf8');
