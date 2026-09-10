const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const encryptionCode = `
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY ? Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex') : randomBytes(32);
const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '90372536237-3brdejbh42jtjj5o4tlq7gs28ek7t3s7.apps.googleusercontent.com';
// Fallback client secret only for local dev purposes, do not use in prod without explicit configuration!
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'GOCSPX-dummy-secret-replace-me-in-production';

function encryptToken(token: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptToken(encryptedText: string): string {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) return encryptedText; // Legacy unencrypted fallback
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Failed to decrypt token', e);
    return '';
  }
}

async function refreshAccessToken(refreshToken: string) {
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to refresh token');
  }

  return res.json();
}
`;

const routeCode = `
  app.post("/api/oauth/exchange", firebaseAuthMiddleware, async (req: any, res: any) => {
    try {
      const { code } = req.body;
      const uid = req.user.uid;
      
      const params = new URLSearchParams({
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: 'postmessage',
      });

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        return res.status(400).json({ error: err.error || 'Failed to exchange code' });
      }

      const tokenData = await tokenRes.json();
      
      // Get user info to verify
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: \`Bearer \${tokenData.access_token}\` }
      });
      
      if (!infoRes.ok) {
        return res.status(400).json({ error: 'Failed to fetch user info' });
      }
      
      const userInfo = await infoRes.json();
      
      if (!rootDb.oauth_tokens) rootDb.oauth_tokens = {};
      
      // Preserve existing refresh token if Google didn't send a new one
      const existingToken = rootDb.oauth_tokens[uid];
      const refreshTokenToStore = tokenData.refresh_token 
        ? encryptToken(tokenData.refresh_token) 
        : (existingToken ? existingToken.refresh_token : '');

      rootDb.oauth_tokens[uid] = {
        access_token: encryptToken(tokenData.access_token),
        refresh_token: refreshTokenToStore,
        expiry_date: Date.now() + Math.max(0, Number(tokenData.expires_in || 3600) - 60) * 1000,
        email: userInfo.email,
        scopes: (tokenData.scope || '').split(' '),
      };
      
      saveDb(rootDb);
      
      res.json({
        success: true,
        email: userInfo.email,
        access_token: tokenData.access_token,
        expires_at: rootDb.oauth_tokens[uid].expiry_date,
        scopes: rootDb.oauth_tokens[uid].scopes
      });
    } catch (e: any) {
      console.error('OAuth exchange error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/oauth/token", firebaseAuthMiddleware, async (req: any, res: any) => {
    try {
      const uid = req.user.uid;
      if (!rootDb.oauth_tokens || !rootDb.oauth_tokens[uid]) {
        return res.status(404).json({ error: 'No token found' });
      }
      
      let tokenData = rootDb.oauth_tokens[uid];
      
      // Check if expired
      if (Date.now() >= tokenData.expiry_date) {
        const decryptedRefresh = decryptToken(tokenData.refresh_token);
        if (!decryptedRefresh) {
          delete rootDb.oauth_tokens[uid];
          saveDb(rootDb);
          return res.status(401).json({ error: 'Refresh token invalid or missing' });
        }
        
        try {
          const refreshRes = await refreshAccessToken(decryptedRefresh);
          tokenData.access_token = encryptToken(refreshRes.access_token);
          if (refreshRes.refresh_token) {
            tokenData.refresh_token = encryptToken(refreshRes.refresh_token);
          }
          tokenData.expiry_date = Date.now() + Math.max(0, Number(refreshRes.expires_in || 3600) - 60) * 1000;
          saveDb(rootDb);
        } catch (refreshErr: any) {
          // If invalid grant, user revoked access or it expired
          console.error('Refresh token failed:', refreshErr);
          if (refreshErr.message === 'invalid_grant') {
            delete rootDb.oauth_tokens[uid];
            saveDb(rootDb);
            return res.status(401).json({ error: 'invalid_grant' });
          }
          return res.status(500).json({ error: 'Temporary error refreshing token' });
        }
      }
      
      res.json({
        success: true,
        email: tokenData.email,
        access_token: decryptToken(tokenData.access_token),
        expires_at: tokenData.expiry_date,
        scopes: tokenData.scopes
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/oauth/token", firebaseAuthMiddleware, async (req: any, res: any) => {
    try {
      const uid = req.user.uid;
      if (rootDb.oauth_tokens && rootDb.oauth_tokens[uid]) {
        delete rootDb.oauth_tokens[uid];
        saveDb(rootDb);
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
`;

code = code.replace("import dotenv from \"dotenv\";", "import dotenv from \"dotenv\";\n" + encryptionCode);
code = code.replace(/app\.get\("\/health"/, routeCode + "\n  app.get(\"/health\"");

fs.writeFileSync('server.ts', code, 'utf8');
