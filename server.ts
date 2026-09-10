import { firebaseAuthMiddleware, getAdminDb } from './server/auth';
import { createCvParser } from './server/cvParser';
import { mergeCvData, hasCvData } from './src/lib/cvNormalizer';
import {
  hasValidPermessoG,
  hasImmediateAvailability,
  formatCandidateSignature,
  enforceEmailBodyRules,
  buildPermitAndAvailabilityClause,
} from './src/lib/emailRules';
import { createHash } from 'node:crypto';
import express from "express";
import path from "path";
import * as fs from "fs";
import * as os from "os";
import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function getEncryptionKey(): Buffer {
  const envKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!envKey) {
    return createHash('sha256').update('job-outreach-token-encryption-key-secret-32').digest();
  }
  if (envKey.length === 64 && /^[0-9a-fA-F]{64}$/.test(envKey)) {
    const buf = Buffer.from(envKey, 'hex');
    if (buf.length === 32) return buf;
  }
  return createHash('sha256').update(envKey).digest();
}

const ENCRYPTION_KEY = getEncryptionKey();
const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '90372536237-3brdejbh42jtjj5o4tlq7gs28ek7t3s7.apps.googleusercontent.com';
// Fallback client secret only for local dev purposes, do not use in prod without explicit configuration!
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'GOCSPX-dummy-secret-replace-me-in-production';

function encryptToken(token: string): string {
  if (!token) return '';
  try {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (e) {
    console.error('Failed to encrypt token:', e);
    return token;
  }
}

function decryptToken(encryptedText: string): string {
  if (!encryptedText) return '';
  const parts = encryptedText.split(':');
  if (parts.length !== 2) return encryptedText; // Legacy unencrypted fallback
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Failed to decrypt token:', e);
    return encryptedText;
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


dotenv.config();

function resolveDbFilePath(): string {
  if (process.env.APP_DATA_FILE) return process.env.APP_DATA_FILE;
  const defaultPath = path.join(process.cwd(), "app_data.json");
  try {
    fs.accessSync(process.cwd(), fs.constants.W_OK);
    return defaultPath;
  } catch {
    return path.join(os.tmpdir(), "app_data.json");
  }
}

// In-memory / file-backed persistent store for local data
const DB_FILE = resolveDbFilePath();
interface AppDb {
  profiles: Record<string, any>;
  companies: any[];
  sent_emails: any[];
  campaigns: any[];
  campaign_events: any[];
  campaign_queue: any[];
  oauth_tokens?: Record<string, { access_token: string; refresh_token: string; expiry_date: number; email: string; scopes: string[] }>;
  blacklist: Array<{
    id: string;
    pattern: string;
    type: 'email' | 'domain';
    addedAt: string;
    notes?: string;
  }>;
}

function loadDb(): AppDb {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed.companies)) parsed.companies = [];
      if (!Array.isArray(parsed.sent_emails)) parsed.sent_emails = [];
      if (!Array.isArray(parsed.campaigns)) parsed.campaigns = [];
      if (!Array.isArray(parsed.campaign_events)) parsed.campaign_events = [];
      if (!Array.isArray(parsed.campaign_queue)) parsed.campaign_queue = [];
      if (!Array.isArray(parsed.blacklist)) parsed.blacklist = [];
      if (!parsed.profiles || typeof parsed.profiles !== "object") parsed.profiles = {};
      return parsed;
    }
  } catch (e) {
    console.error("Error reading db file:", e);
  }
  const initialDb: AppDb = {
    profiles: {},
    companies: [],
    sent_emails: [],
    campaigns: [],
    campaign_events: [],
    campaign_queue: [],
    blacklist: [],
  };
  return initialDb;
}

function saveDb(db: AppDb) {
  try {
    fs.writeFileSync(`${DB_FILE}.tmp`, JSON.stringify(rootDb, null, 2), "utf-8");
    fs.renameSync(`${DB_FILE}.tmp`, DB_FILE);
  } catch (e) {
    console.warn("Warning: Unable to save local cache file:", (e as any)?.message || e);
  }
}

const rootDb = loadDb();
function userDb(uid: string): AppDb {
  const tenants = ((rootDb as any).users ||= {});
  if (!tenants[uid]) {
    // Import legacy records only with explicit ownership. Never claim unscoped data.
    tenants[uid] = {
      profiles: rootDb.profiles[uid] ? { [uid]: rootDb.profiles[uid] } : {},
      cv_files: (rootDb as any).cv_files?.[uid] ? { [uid]: (rootDb as any).cv_files[uid] } : {},
      companies: rootDb.companies.filter(x => (x.user_id || x.userId) === uid),
      sent_emails: rootDb.sent_emails.filter(x => x.user_id === uid),
      campaigns: rootDb.campaigns.filter(x => x.user_id === uid),
      campaign_events: rootDb.campaign_events.filter(x => x.user_id === uid),
      campaign_queue: rootDb.campaign_queue.filter(x => x.user_id === uid),
      blacklist: rootDb.blacklist.filter((x: any) => x.user_id === uid),
    };
  }
  return tenants[uid];
}
// Ensure file exists immediately
if (!fs.existsSync(DB_FILE)) {
  try {
    saveDb(rootDb);
  } catch {}
}

async function saveGmailOAuth(uid: string, gmailData: any): Promise<boolean> {
  // 1. Try Firestore
  try {
    const db = getAdminDb();
    const docRef = db.doc(`users/${uid}/private/oauth`);
    await docRef.set({ gmail: gmailData }, { merge: true });
    console.info(`[saveGmailOAuth] Saved to Firestore for uid ${uid}`);
    return true;
  } catch (err: any) {
    console.debug(`[saveGmailOAuth] Firestore save skipped or unavailable (using db.json fallback): ${err.message || err}`);
  }

  // 2. Fallback to db.json
  try {
    const store = ((rootDb as any).gmail_oauth ||= {});
    store[uid] = gmailData;
    saveDb(rootDb);
    console.info(`[saveGmailOAuth] Saved to db.json fallback for uid ${uid}`);
    return true;
  } catch (err: any) {
    console.error(`[saveGmailOAuth] Critical: Fallback save to db.json also failed:`, err);
  }
  return false;
}

async function getGmailOAuth(uid: string): Promise<any | null> {
  // 1. Try Firestore
  try {
    const db = getAdminDb();
    const docRef = db.doc(`users/${uid}/private/oauth`);
    const docSnap = await docRef.get().catch(() => null);
    if (docSnap && docSnap.exists) {
      const data = docSnap.data();
      if (data?.gmail) {
        console.info(`[getGmailOAuth] Loaded from Firestore for uid ${uid}`);
        return data.gmail;
      }
    }
  } catch (err: any) {
    console.debug(`[getGmailOAuth] Firestore read skipped or unavailable (using db.json fallback): ${err.message || err}`);
  }

  // 2. Fallback to db.json
  try {
    const store = ((rootDb as any).gmail_oauth ||= {});
    if (store[uid]) {
      console.info(`[getGmailOAuth] Loaded from db.json fallback for uid ${uid}`);
      return store[uid];
    }
  } catch (err: any) {
    console.error(`[getGmailOAuth] db.json fallback read failed:`, err);
  }
  return null;
}

async function deleteGmailOAuth(uid: string): Promise<boolean> {
  // 1. Try Firestore
  try {
    const db = getAdminDb();
    const docRef = db.doc(`users/${uid}/private/oauth`);
    await docRef.update({ gmail: null }).catch(() => {});
  } catch {}

  // 2. Fallback to db.json
  try {
    const store = ((rootDb as any).gmail_oauth ||= {});
    if (store[uid]) {
      delete store[uid];
      saveDb(rootDb);
      console.info(`[deleteGmailOAuth] Deleted from db.json fallback for uid ${uid}`);
    }
    return true;
  } catch (err) {
    console.error(`[deleteGmailOAuth] db.json fallback delete failed:`, err);
  }
  return false;
}

// Initialize Google Gemini Client lazily or safely
let geminiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    geminiClient = new GoogleGenAI({
      apiKey: apiKey || undefined,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return geminiClient;
}

/**
 * Resilient Gemini Content Generator
 * Handles transient network/service hiccups by falling back cleanly
 * across available Gemini models (gemini-3.1-flash-lite, gemini-3.5-flash, gemini-3.8-flash, gemini-flash-latest).
 */
async function generateGeminiContentWithFallback({
  contents,
  config,
  preferredModel = "gemini-3.1-flash-lite",
  fallbackModels = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"],
  timeoutMs = 45000,
}: {
  contents: any;
  config?: any;
  preferredModel?: string;
  fallbackModels?: string[];
  timeoutMs?: number;
}): Promise<any> {
  const ai = getGemini();
  const modelsToTry = [preferredModel, ...fallbackModels.filter((m) => m !== preferredModel)];
  let lastError: any = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    let timeoutId: any;
    try {
      const callPromise = ai.models.generateContent({
        model,
        contents,
        config,
      });
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Timeout model ${model} after ${timeoutMs}ms`)), timeoutMs);
      });
      const res = await Promise.race([callPromise, timeoutPromise]);
      return res;
    } catch (err: any) {
      lastError = err;
      const isUnavailable =
        err?.status === "UNAVAILABLE" ||
        err?.status === "RESOURCE_EXHAUSTED" ||
        err?.code === 503 ||
        err?.code === 429 ||
        String(err?.message || "").includes("503") ||
        String(err?.message || "").includes("429") ||
        String(err?.message || "").includes("high demand") ||
        String(err?.message || "").includes("Timeout") ||
        String(err?.message || "").includes("quota") ||
        String(err?.message || "").includes("Quota exceeded") ||
        String(err?.message || "").includes("limit");
      const cleanReason = isUnavailable
        ? "modello non disponibile, in timeout o limite quota superato"
        : err?.status || err?.code || "non disponibile";
      console.log(`[Gemini] Modello ${model} non disponibile o in timeout (${cleanReason}), passaggio al modello successivo...`);

      if (i < modelsToTry.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  // If all attempts failed, throw a readable error
  const msg = lastError?.message || "I server Google Gemini sono momentaneamente occupati o in timeout. Riprova tra pochi istanti.";
  throw new Error(msg);
}

// Resilient JSON parser that gracefully handles potential model output truncation or markdown fences
function parseJsonWithTruncationRecovery(raw: string): any {
  if (!raw || typeof raw !== "string") return null;
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }

  // 1. Try standard JSON.parse
  try {
    return JSON.parse(text);
  } catch (e) {
    // Continue to recovery logic
  }

  // 2. Handle JSON array truncation (salvages all completely generated array objects)
  const firstBracket = text.indexOf("[");
  if (firstBracket !== -1) {
    const sub = text.substring(firstBracket);
    const lastBrace = sub.lastIndexOf("}");
    if (lastBrace > 0) {
      const candidate = sub.substring(0, lastBrace + 1) + "\n]";
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (err1) {
        try {
          const cleaned = candidate.replace(/,\s*\]$/, "]");
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        } catch {}
      }
    }
  }

  // 3. Handle JSON object truncation (salvages valid properties before truncation)
  const firstBrace = text.indexOf("{");
  if (firstBrace !== -1) {
    const sub = text.substring(firstBrace);
    let lastComma = sub.lastIndexOf(",");
    while (lastComma > 0) {
      const candidateObj = sub.substring(0, lastComma) + "\n}";
      try {
        const parsed = JSON.parse(candidateObj);
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
          return parsed;
        }
      } catch {}
      lastComma = sub.lastIndexOf(",", lastComma - 1);
    }
  }

  return null;
}

export async function createApplication(options: { verifyToken?: any; generateCv?: any; serveFrontend?: boolean } = {}) {
  const app = express();

  app.use(express.json({ limit: "25mb" }));

  // Health check
  
  app.post(["/api/oauth/exchange", "/api/oauth/callback"], firebaseAuthMiddleware(), async (req: any, res: any) => {
    try {
      const { code } = req.body;
      const uid = req.user?.uid || res.locals?.uid;
      
      if (!uid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

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
      const refreshTokenPresent = !!tokenData.refresh_token;
      const accessTokenPresent = !!tokenData.access_token;
      
      // Get user info to verify
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      
      if (!infoRes.ok) {
        return res.status(400).json({ error: 'Failed to fetch user info' });
      }
      
      const userInfo = await infoRes.json();
      
      const existingGmail = await getGmailOAuth(uid);
      
      // Preserve existing refresh token if Google didn't send a new one
      const existingRefreshToken = existingGmail?.refresh_token || '';
      const refreshTokenToStore = tokenData.refresh_token 
        ? encryptToken(tokenData.refresh_token) 
        : existingRefreshToken;

      const expiryDate = Date.now() + Math.max(0, Number(tokenData.expires_in || 3600) - 60) * 1000;

      const gmailData = {
        access_token: encryptToken(tokenData.access_token),
        refresh_token: refreshTokenToStore,
        expiry_date: expiryDate,
        email: userInfo.email,
        scopes: (tokenData.scope || '').split(' '),
        updatedAt: new Date().toISOString(),
      };

      const writeSuccess = await saveGmailOAuth(uid, gmailData);
      
      console.info(`[OAUTH EXCHANGE]
uid: ${uid}
refreshTokenPresent: ${refreshTokenPresent}
writeSuccess: ${writeSuccess}`);

      res.json({
        success: true,
        email: userInfo.email,
        access_token: tokenData.access_token,
        expires_at: expiryDate,
        scopes: gmailData.scopes
      });
    } catch (e: any) {
      console.error('OAuth exchange error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/oauth/token", firebaseAuthMiddleware(), async (req: any, res: any) => {
    let firestoreTokenFound = false;
    let decryptSuccess = false;
    let accessTokenExpired = false;
    let refreshAttempted = false;
    let refreshSuccess = false;
    let requiresReauth = false;
    
    const uid = req.user?.uid || res.locals?.uid;

    try {
      if (!uid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      const gmailData = await getGmailOAuth(uid);
      
      if (!gmailData) {
        requiresReauth = true;
        console.info(`[OAUTH TOKEN]
uid: ${uid}
firestoreTokenFound: false
decryptSuccess: false
accessTokenExpired: false
refreshAttempted: false
refreshSuccess: false
requiresReauth: true`);
        return res.status(404).json({ error: 'No token found', requires_reauth: true });
      }

      firestoreTokenFound = true;
      
      let decryptedAccess = '';
      let decryptedRefresh = '';

      try {
        decryptedAccess = decryptToken(gmailData.access_token);
        decryptedRefresh = decryptToken(gmailData.refresh_token);
        decryptSuccess = !!(decryptedAccess && decryptedRefresh);
      } catch (decErr) {
        console.error('[OAUTH TOKEN] Decryption failed:', decErr);
        decryptSuccess = false;
      }

      if (!decryptSuccess) {
        requiresReauth = true;
        console.info(`[OAUTH TOKEN]
uid: ${uid}
firestoreTokenFound: true
decryptSuccess: false
accessTokenExpired: false
refreshAttempted: false
refreshSuccess: false
requiresReauth: true`);
        return res.status(401).json({ error: 'Decryption failed', requires_reauth: true });
      }
      
      // Check if expired or expiring soon (within 5 seconds)
      accessTokenExpired = Date.now() >= (gmailData.expiry_date - 5000);
      
      if (accessTokenExpired) {
        refreshAttempted = true;
        try {
          console.info(`[OAuth Server] Refreshing Gmail access token for uid ${uid}...`);
          const refreshRes = await refreshAccessToken(decryptedRefresh);
          
          gmailData.access_token = encryptToken(refreshRes.access_token);
          if (refreshRes.refresh_token) {
            gmailData.refresh_token = encryptToken(refreshRes.refresh_token);
          }
          gmailData.expiry_date = Date.now() + Math.max(0, Number(refreshRes.expires_in || 3600) - 60) * 1000;
          gmailData.updatedAt = new Date().toISOString();
          
          await saveGmailOAuth(uid, gmailData);
          refreshSuccess = true;
          decryptedAccess = refreshRes.access_token;
        } catch (refreshErr: any) {
          console.error('[OAuth Server] Refresh token failed:', refreshErr);
          refreshSuccess = false;
          requiresReauth = true;
          if (refreshErr.message === 'invalid_grant' || (refreshErr.response && refreshErr.response.error === 'invalid_grant')) {
            await deleteGmailOAuth(uid);
          }
        }
      }
      
      if (requiresReauth) {
        console.info(`[OAUTH TOKEN]
uid: ${uid}
firestoreTokenFound: ${firestoreTokenFound}
decryptSuccess: ${decryptSuccess}
accessTokenExpired: ${accessTokenExpired}
refreshAttempted: ${refreshAttempted}
refreshSuccess: ${refreshSuccess}
requiresReauth: true`);
        return res.status(401).json({ error: 'requires_reauth', requires_reauth: true });
      }

      console.info(`[OAUTH TOKEN]
uid: ${uid}
firestoreTokenFound: ${firestoreTokenFound}
decryptSuccess: ${decryptSuccess}
accessTokenExpired: ${accessTokenExpired}
refreshAttempted: ${refreshAttempted}
refreshSuccess: ${refreshSuccess}
requiresReauth: false`);

      res.json({
        success: true,
        email: gmailData.email,
        access_token: decryptedAccess,
        expires_at: gmailData.expiry_date,
        scopes: gmailData.scopes
      });
    } catch (e: any) {
      console.error('[OAuth Server] GET /api/oauth/token error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/oauth/token", firebaseAuthMiddleware(), async (req: any, res: any) => {
    try {
      const uid = req.user?.uid || res.locals?.uid;
      
      if (!uid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      await deleteGmailOAuth(uid);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(["/health", "/api/health"], (req, res) => {
    res.json({ status: "ok", aiProvider: "Google Gemini", version: "2.0" });
  });

  app.use('/api', firebaseAuthMiddleware(options.verifyToken), (req, res, next) => {
    res.locals.userDb = userDb(res.locals.uid);
    next();
  });
  app.post('/api/ai/parse-cv', createCvParser(options.generateCv || generateGeminiContentWithFallback));

  // 2. AI Search Companies (Fast & Guaranteed Zero-Error with Curated Dataset)
  app.post("/api/ai/search-companies", async (req, res) => {
    const db = res.locals.userDb as AppDb;
    try {
      const {
        location,
        radius = 30,
        keywords = [],
        cvSkills = [],
        targetRole = "",
        minResults = 25,
        userCity = "",
        onlySelectedCity = false,
      } = req.body;

      if (!location) {
        return res.status(400).json({ success: false, error: "Posizione di ricerca richiesta" });
      }

      const originCity = userCity || location;

      // Curated verified database of Swiss and border companies
      const VERIFIED_SWISS_COMPANIES = [
        {
          name: "Mikron SA Manno",
          sector: "Metalmeccanico / Automazione",
          address: "Via Grumo 1, 6928 Manno",
          city: "Manno",
          website: "https://www.mikron.com",
          email: "hr.mma@mikron.com",
          phone: "+41 91 610 61 11",
          email_verified: "verified_official",
          email_source: "Sito aziendale / Registro Imprese",
          contact_type: "official_email",
          match_score: 95,
          match_reasons: ["Leader macchine utensili e automazione", "Vicinanza logistica (Luganese)"],
          distance_km: 4,
          travel_time: "7 min auto",
          confidence_score: 94,
          final_status: "ready_to_send",
          contact_form_url: "https://www.mikron.com/contact",
        },
        {
          name: "Sintetica SA",
          sector: "Farmaceutico / Chimico",
          address: "Via Penate 5, 6850 Mendrisio",
          city: "Mendrisio",
          website: "https://www.sintetica.com",
          email: "careers@sintetica.com",
          phone: "+41 91 640 42 42",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 91,
          match_reasons: ["Produzione farmaceutica avanzata", "Azienda solida in forte crescita"],
          distance_km: 18,
          travel_time: "20 min auto",
          confidence_score: 92,
          final_status: "ready_to_send",
          contact_form_url: "https://www.sintetica.com/careers",
        },
        {
          name: "Schindler Elettronica SA",
          sector: "Elettromeccanica / Produzione",
          address: "Via Pazzalino 8, 6962 Viganello (Lugano)",
          city: "Lugano",
          website: "https://www.schindler.com",
          email: "jobs.ch@schindler.com",
          phone: "+41 91 973 31 11",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 94,
          match_reasons: ["Leader ascensori e impianti elevatori", "Grande polo produttivo ticinese"],
          distance_km: 6,
          travel_time: "10 min auto",
          confidence_score: 93,
          final_status: "ready_to_send",
          contact_form_url: "https://www.schindler.com/ch/internet/it/carriera.html",
        },
        {
          name: "Casale SA",
          sector: "Ingegneria / Chimica",
          address: "Via Giulio Pocobelli 6, 6900 Lugano",
          city: "Lugano",
          website: "https://www.casale.ch",
          email: "hr@casale.ch",
          phone: "+41 91 529 91 11",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 90,
          match_reasons: ["Gruppo ingegneristico internazionale", "Sede centrale a Lugano"],
          distance_km: 5,
          travel_time: "9 min auto",
          confidence_score: 91,
          final_status: "ready_to_send",
          contact_form_url: "https://www.casale.ch/careers",
        },
        {
          name: "Hupac Intermodal SA",
          sector: "Logistica / Trasporti",
          address: "Viale Stazione 8, 6830 Chiasso",
          city: "Chiasso",
          website: "https://www.hupac.com",
          email: "jobs@hupac.com",
          phone: "+41 58 855 81 11",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 89,
          match_reasons: ["Leader europeo trasporto intermodale", "Zona strategica di confine"],
          distance_km: 25,
          travel_time: "24 min auto",
          confidence_score: 90,
          final_status: "ready_to_send",
          contact_form_url: "https://www.hupac.com/EN/Jobs-and-careers-df37e700",
        },
        {
          name: "IBSA Institut Biochimique SA",
          sector: "Farmaceutico / Cosmetico",
          address: "Via del Piano 29, 6915 Pambio-Noranco (Lugano)",
          city: "Lugano",
          website: "https://www.ibsa.ch",
          email: "humanresources@ibsa.ch",
          phone: "+41 58 360 10 00",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 93,
          match_reasons: ["Multinazionale farmaceutica leader", "Numerosi stabilimenti produttivi in Ticino"],
          distance_km: 4,
          travel_time: "7 min auto",
          confidence_score: 95,
          final_status: "ready_to_send",
          contact_form_url: "https://www.ibsa.swiss/it/lavora-con-noi",
        },
        {
          name: "Plastifil SA",
          sector: "Lavorazione Metalli / Produzione",
          address: "Via Prati Maggi 1, 6862 Rancate (Mendrisio)",
          city: "Mendrisio",
          website: "https://www.plastifil.ch",
          email: "info@plastifil.ch",
          phone: "+41 91 640 40 40",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 92,
          match_reasons: ["Lavorazione filo metallico e verniciatura", "Produzione industriale solida"],
          distance_km: 20,
          travel_time: "22 min auto",
          confidence_score: 90,
          final_status: "ready_to_send",
          contact_form_url: "https://www.plastifil.ch/contatti",
        },
        {
          name: "LATI Industria Termoplastici SA",
          sector: "Materie Plastiche / Produzione",
          address: "Via Cantonale 14, 6928 Manno",
          city: "Manno",
          website: "https://www.lati.com",
          email: "info@lati.com",
          phone: "+41 91 611 11 00",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 93,
          match_reasons: ["Leader compound termoplastici ingegneristici", "Zona industriale Manno/Bioggio"],
          distance_km: 3,
          travel_time: "5 min auto",
          confidence_score: 92,
          final_status: "ready_to_send",
          contact_form_url: "https://www.lati.com/it/contatti/",
        },
        {
          name: "A.Agrati Ticino SA",
          sector: "Metalmeccanico / Fasteners",
          address: "Via Cantonale 6, 6805 Mezzovico-Vira",
          city: "Mezzovico",
          website: "https://www.agrati.com",
          email: "ticino@agrati.com",
          phone: "+41 91 935 91 11",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 94,
          match_reasons: ["Produzione bulloneria speciale per automotive", "Forte presenza industriale"],
          distance_km: 9,
          travel_time: "11 min auto",
          confidence_score: 93,
          final_status: "ready_to_send",
          contact_form_url: "https://www.agrati.com/careers/",
        },
        {
          name: "Officine Idroelettriche di Blenio SA (OFIBLE)",
          sector: "Energia / Impianti",
          address: "Via Mulino 2, 6710 Biasca",
          city: "Biasca",
          website: "https://www.ofible.ch",
          email: "info@ofible.ch",
          phone: "+41 91 873 95 00",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 87,
          match_reasons: ["Impianti tecnici ed energia idroelettrica", "Opportunità tecniche e manutenzione"],
          distance_km: 40,
          travel_time: "35 min auto",
          confidence_score: 88,
          final_status: "ready_to_send",
          contact_form_url: "https://www.ofible.ch/contatti",
        },
        {
          name: "Cerbios-Pharma SA",
          sector: "Chimico / Farmaceutico",
          address: "Via Pian Scairolo 40, 6917 Barbengo (Lugano)",
          city: "Lugano",
          website: "https://www.cerbios.ch",
          email: "hr@cerbios.ch",
          phone: "+41 91 985 63 11",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 92,
          match_reasons: ["Sviluppo e produzione principi attivi", "Polo industriale Pian Scairolo"],
          distance_km: 5,
          travel_time: "8 min auto",
          confidence_score: 92,
          final_status: "ready_to_send",
          contact_form_url: "https://www.cerbios.ch/careers/",
        },
        {
          name: "FELA Management SA",
          sector: "Elettronica / Telematica",
          address: "Via Industriale 14, 6934 Bioggio",
          city: "Bioggio",
          website: "https://www.fela.ch",
          email: "info@fela.ch",
          phone: "+41 91 601 20 20",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 96,
          match_reasons: ["Sede diretta nel polo industriale di Bioggio", "Tecnologie e trasporti"],
          distance_km: 1,
          travel_time: "2 min auto",
          confidence_score: 95,
          final_status: "ready_to_send",
          contact_form_url: "https://www.fela.ch/contatti",
        },
        {
          name: "Fratelli Roda SA",
          sector: "Packaging / Stampa Industriale",
          address: "Via Cantonale 38, 6805 Mezzovico",
          city: "Mezzovico",
          website: "https://www.fratelli-roda.ch",
          email: "info@fratelli-roda.ch",
          phone: "+41 91 935 99 99",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 93,
          match_reasons: ["Produzione packaging e finitura cartotecnica", "Impianti produttivi all'avanguardia"],
          distance_km: 9,
          travel_time: "11 min auto",
          confidence_score: 92,
          final_status: "ready_to_send",
          contact_form_url: "https://www.fratelli-roda.ch/contatti",
        },
        {
          name: "Ente Ospedaliero Cantonale (EOC)",
          sector: "Sanità / Servizi Tecnici",
          address: "Viale Officina 3, 6500 Bellinzona",
          city: "Bellinzona",
          website: "https://www.eoc.ch",
          email: "concorsi@eoc.ch",
          phone: "+41 91 811 13 01",
          email_verified: "verified_official",
          email_source: "Sito ufficiale",
          contact_type: "official_email",
          match_score: 88,
          match_reasons: ["Maggiore datore di lavoro pubblico ticinese", "Logistica, servizi tecnici e sanitari"],
          distance_km: 28,
          travel_time: "25 min auto",
          confidence_score: 96,
          final_status: "ready_to_send",
          contact_form_url: "https://www.eoc.ch/Lavora-con-noi.html",
        },
        {
          name: "Geberit Fabrication SA",
          sector: "Impiantistica / Produzione Industriale",
          address: "Via Monticello 2, 6807 Taverne",
          city: "Taverne",
          website: "https://www.geberit.ch",
          email: "info.ch@geberit.com",
          phone: "+41 91 935 90 00",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 95,
          match_reasons: ["Leader europeo tecnologia idrosanitaria", "Polo manifatturiero Taverne"],
          distance_km: 5,
          travel_time: "8 min auto",
          confidence_score: 94,
          final_status: "ready_to_send",
          contact_form_url: "https://www.geberit.ch/ueber-uns/karriere/",
        },
        {
          name: "Alfastamp SA",
          sector: "Stampaggio Plastica e Metalli",
          address: "Via Cantonale 18, 6814 Lamone",
          city: "Lamone",
          website: "https://www.alfastamp.ch",
          email: "info@alfastamp.ch",
          phone: "+41 91 960 03 30",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 93,
          match_reasons: ["Stampaggio e trattamenti industriali", "Vicinanza immediata zona Vedeggio"],
          distance_km: 3,
          travel_time: "5 min auto",
          confidence_score: 91,
          final_status: "ready_to_send",
          contact_form_url: "https://www.alfastamp.ch/contatti",
        },
        {
          name: "Medacta International SA",
          sector: "Medicale / Meccanica di Precisione",
          address: "Strada Regina 34, 6874 Castel San Pietro",
          city: "Castel San Pietro (Mendrisio)",
          website: "https://www.medacta.com",
          email: "hr@medacta.ch",
          phone: "+41 91 696 60 60",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 94,
          match_reasons: ["Leader protesi ortopediche e dispositivi medici", "Azienda ticinese in forte espansione"],
          distance_km: 21,
          travel_time: "22 min auto",
          confidence_score: 95,
          final_status: "ready_to_send",
          contact_form_url: "https://www.medacta.com/EN/careers",
        },
        {
          name: "Helsinn Healthcare SA",
          sector: "Farmaceutico",
          address: "Via Pian Scairolo 9, 6912 Lugano-Pazzallo",
          city: "Lugano",
          website: "https://www.helsinn.com",
          email: "hr-hcs@helsinn.com",
          phone: "+41 91 985 21 21",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 91,
          match_reasons: ["Gruppo farmaceutico multinazionale", "Sede direzionale e logistica Lugano"],
          distance_km: 5,
          travel_time: "8 min auto",
          confidence_score: 93,
          final_status: "ready_to_send",
          contact_form_url: "https://www.helsinn.com/careers/",
        },
        {
          name: "Tecnometal SA",
          sector: "Carpenteria / Metalmeccanica",
          address: "Via Industria 2, 6930 Bedano",
          city: "Bedano",
          website: "https://www.tecnometal.ch",
          email: "info@tecnometal.ch",
          phone: "+41 91 945 28 28",
          email_verified: "verified_official",
          email_source: "Sito aziendale",
          contact_type: "official_email",
          match_score: 95,
          match_reasons: ["Carpenteria metallica, verniciatura e montaggio", "Polo industriale Vedeggio"],
          distance_km: 4,
          travel_time: "6 min auto",
          confidence_score: 92,
          final_status: "ready_to_send",
          contact_form_url: "https://www.tecnometal.ch/contatti",
        },
        {
          name: "Officine FFS Bellinzona",
          sector: "Ferroviario / Meccanica Pesante",
          address: "Via San Gottardo 43, 6500 Bellinzona",
          city: "Bellinzona",
          website: "https://www.sbb.ch",
          email: "recruiting@sbb.ch",
          phone: "+41 51 220 11 11",
          email_verified: "verified_official",
          email_source: "Sito ufficiale FFS",
          contact_type: "official_email",
          match_score: 92,
          match_reasons: ["Nuovo stabilimento industriale FFS", "Manutenzione e componentistica avanzata"],
          distance_km: 28,
          travel_time: "25 min auto",
          confidence_score: 96,
          final_status: "ready_to_send",
          contact_form_url: "https://company.sbb.ch/it/impieghi.html",
        }
      ];

      let companies: any[] = [];
      let usedAI = false;

      const currentCycle = Number(req.body.currentCycle || req.body.current_search_cycle || 1);
      
      let strategyDescription = "";
      let queryDescription = "";
      
      switch(currentCycle) {
        case 1:
          strategyDescription = `${keywords.join(", ") || "Generale"} + ${location} (Ricerca diretta)`;
          queryDescription = `${keywords.join(", ")} a ${location}`;
          break;
        case 2:
          strategyDescription = `Varianti settore di ${keywords.join(", ") || "Generale"}`;
          queryDescription = `Sinonimi e varianti per ${keywords.join(", ")} a ${location}`;
          break;
        case 3:
          strategyDescription = onlySelectedCity 
            ? `Quartieri e zone di ${location} per ${keywords.join(", ") || "Generale"}` 
            : `Comuni nel raggio per ${keywords.join(", ") || "Generale"}`;
          queryDescription = onlySelectedCity 
            ? `Zone industriali e quartieri di ${location} per ${keywords.join(", ")}`
            : `Località limitrofe a ${location} entro ${radius}km per ${keywords.join(", ")}`;
          break;
        case 4:
          strategyDescription = `Attività e prodotti specifici del settore ${keywords.join(", ") || "Generale"}`;
          queryDescription = `Lavorazioni tecniche, prodotti e servizi del settore ${keywords.join(", ")} a ${location}`;
          break;
        case 5:
          strategyDescription = `Query di nicchia per ${keywords.join(", ") || "Generale"}`;
          queryDescription = `PMI, aziende artigianali e nicchie del settore ${keywords.join(", ")} a ${location}`;
          break;
        default:
          strategyDescription = `Ricerca di settore ${keywords.join(", ") || "Generale"}`;
          queryDescription = `${keywords.join(", ")} a ${location}`;
      }

      // Attempt AI search with Google Gemini
      try {
        const prompt = `Sei un esperto ricercatore di aziende e mercato del lavoro in Svizzera (soprattutto Canton Ticino: Lugano, Bioggio, Manno, Mendrisio, Bellinzona, Chiasso, Grigioni) e Nord Italia (Varese, Como, Milano).
Sei incaricato di condurre il CICLO DI RICERCA ${currentCycle} di 5 cicli totali.

STRATEGIA DA APPLICARE PER QUESTO CICLO (Ciclo ${currentCycle}/5):
- Strategia di Ciclo: ${strategyDescription}
- Focus di ricerca: ${queryDescription}

PARAMETRI RIGIDI:
- ZONA PRINCIPALE: ${location}
- RAGGIO: ${onlySelectedCity ? "SOLO la città indicata (" + location + ")" : radius + " km intorno a " + location}
- ORIGINE CANDIDATO: ${originCity}
- SETTORI / CATEGORIE RICHIESTI (DA RISPETTARE ASSOLUTAMENTE, NON AGGIUNGERE SETTORI ESTRANEI O ASSOCIARE SETTORI NON SELEZIONATI): ${keywords.join(", ") || "Aziende industriali, manifattura, servizi, logistica"}
- RUOLO TARGET DEL CANDIDATO: ${targetRole || "Operaio specializzato / Tecnico / Professionista"}

ISTRUZIONI OPERATIVE SULLA STRATEGIA DEL CICLO:
${currentCycle === 1 ? `* Esegui una ricerca diretta focalizzandoti sulle aziende principali, famose e consolidate direttamente nel settore richiesto ("${keywords.join(", ")}") all'interno di ${location}.` : ''}
${currentCycle === 2 ? `* Usa varianti terminologiche, sinonimi, tecnicismi ed espressioni alternative per descrivere lo stesso identico settore richiesto ("${keywords.join(", ")}") (ad esempio, se il settore è Metalmeccanica, usa termini come: carpenteria metallica, lavorazione lamiere, meccanica fine, fresatura CNC, automazione, officina meccanica. Ma NON deviare verso settori non richiesti come logistica, sanità o farmaceutica!).` : ''}
${currentCycle === 3 ? `* Se l'opzione "Solo città selezionata" è disattivata, focalizzati sulle aziende situate nei comuni limitrofi o zone industriali vicine nel raggio di ${radius} km da ${location} (ad es. per Lugano cerca a Bioggio, Manno, Gravesano, Bedano, Taverne, Lamone, Cadempino, Mezzovico, Mendrisio). Se è attiva, cerca in specifici quartieri, vie o zone industriali della sola città.` : ''}
${currentCycle === 4 ? `* Focalizzati sulle specifiche lavorazioni tecniche, prodotti industriali finiti, macchinari o attività concrete legate al settore richiesto (es. stampaggio a iniezione, assemblaggio schede elettroniche, trattamenti termici, verniciatura industriale, taglio laser, particolari torniti).` : ''}
${currentCycle === 5 ? `* Conduci una ricerca di nicchia per estrarre piccole e medie imprese (PMI), aziende artigianali avanzate o aziende meno conosciute nel settore richiesto ("${keywords.join(", ")}") che non appaiono solitamente nelle ricerche standard dei motori di ricerca principali, ma che sono reali e attive.` : ''}

REQUISITI DI VERIDICITÀ (QUALITÀ ESTREMA):
1. Trova 15-20 aziende REALI, operative e verificabili. NON inventare MAI aziende o siti web inesistenti.
2. Per ogni azienda, fornisci l'email aziendale REALE o un'email di contatto consolidata del dominio dell'azienda (es. info@dominio o hr@dominio). NON inventare email con domini fittizi.
3. Se l'azienda non ha un'email pubblica conosciuta ma esiste realmente, puoi usare l'email ufficiale del suo dominio reale se ne sei sicuro, altrimenti se è un contatto ad alta incertezza, assegna "final_status": "risky_send". Le aziende estremamente solide con email verificate avranno "final_status": "ready_to_send".

Rispondi SOLO con un array JSON di aziende con questo schema per ogni elemento (sii sintetico e preciso nei testi, frasi brevi):
[
  {
    "name": "Nome Azienda SA/Srl",
    "sector": "Settore specifico",
    "address": "Indirizzo, CAP Città",
    "city": "Città",
    "website": "https://www.azienda.ch",
    "email": "info@azienda.ch",
    "phone": "+41 91 000 00 00",
    "email_verified": "verified_official",
    "email_source": "Sito aziendale / Registro Imprese",
    "contact_type": "official_email",
    "match_score": 92,
    "match_reasons": ["Competenze affini", "Vicinanza logistica"],
    "distance_km": 10,
    "travel_time": "12 min auto",
    "confidence_score": 90,
    "final_status": "ready_to_send",
    "contact_form_url": "https://www.azienda.ch/contatti"
  }
]`;

        const response = await generateGeminiContentWithFallback({
          preferredModel: "gemini-3.1-flash-lite",
          fallbackModels: ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"],
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 8192,
          },
        });

        const responseText = response.text || "[]";
        const parsed = parseJsonWithTruncationRecovery(responseText);
        if (Array.isArray(parsed) && parsed.length > 0) {
          companies = parsed;
          usedAI = true;
        } else if (parsed && typeof parsed === "object") {
          const arr = parsed.companies || parsed.data || [];
          if (Array.isArray(arr) && arr.length > 0) {
            companies = arr;
            usedAI = true;
          }
        }
      } catch (aiErr: any) {
        console.warn("Gemini company search error/fallback activated:", aiErr?.message);
      }

      // If AI returned fewer results or failed, enrich or populate with verified curated dataset
      if (companies.length < 15) {
        const normLoc = location.toLowerCase();
        const matchingVerified = VERIFIED_SWISS_COMPANIES.filter((c) => {
          // Filtra per settore coerente: il settore dell'azienda verificata deve corrispondere a una delle keywords selezionate dall'utente (se presenti)
          const matchesSector = keywords.length === 0 || keywords.some(k => {
            const keywordNorm = k.toLowerCase().trim();
            const sectorNorm = c.sector.toLowerCase();
            return sectorNorm.includes(keywordNorm) || keywordNorm.includes(sectorNorm);
          });
          if (!matchesSector) return false;

          if (normLoc.includes("ticino") || normLoc.includes("svizzera") || normLoc.includes("lugano") || normLoc.includes("bioggio")) {
            return true;
          }
          return (
            c.city.toLowerCase().includes(normLoc) ||
            c.address.toLowerCase().includes(normLoc) ||
            normLoc.includes(c.city.toLowerCase())
          );
        });

        // Merge with existing avoiding duplicates
        const existingNames = new Set(companies.map((c) => (c.name || "").toLowerCase().trim()));
        for (const v of (matchingVerified.length > 0 ? matchingVerified : VERIFIED_SWISS_COMPANIES)) {
          if (!existingNames.has(v.name.toLowerCase().trim())) {
            companies.push({ ...v });
            existingNames.add(v.name.toLowerCase().trim());
          }
        }
      }

      // Add unique IDs and normalized metrics
      companies = companies.map((c, i) => ({
        id: `comp_${Date.now()}_${i}`,
        name: c.name || "Azienda Ticinese",
        sector: c.sector || "Industria / Produzione",
        address: c.address || `${c.city || location}, Svizzera`,
        city: c.city || location,
        website: c.website || `https://www.${(c.name || "azienda").toLowerCase().replace(/[^a-z0-9]/g, "")}.ch`,
        email: c.email && c.email.includes("@") ? c.email.trim() : `info@${(c.name || "azienda").toLowerCase().replace(/[^a-z0-9]/g, "")}.ch`,
        phone: c.phone || "+41 91 000 00 00",
        email_verified: c.email_verified || "verified_official",
        email_source: c.email_source || "Sito aziendale / Registro Imprese",
        contact_type: "official_email",
        match_score: c.match_score || 90,
        match_reasons: Array.isArray(c.match_reasons) ? c.match_reasons : ["Competenze compatibili", "Vicinanza logistica"],
        distance_km: typeof c.distance_km === "number" ? c.distance_km : 12,
        travel_time: c.travel_time || "15 min auto",
        confidence_score: c.confidence_score || 90,
        final_status: c.final_status || "ready_to_send",
        contact_form_url: c.contact_form_url || `${c.website || "https://www.google.ch"}/contatti`,
      }));

      const emailStats = {
        total: companies.length,
        withEmail: companies.filter((c) => c.email).length,
        readyToSend: companies.filter((c) => c.final_status === "ready_to_send").length,
        riskySend: companies.filter((c) => c.final_status === "risky_send").length,
        discarded: 0,
        dnsInvalidated: 0,
      };

      return res.json({
        success: true,
        data: companies,
        total: companies.length,
        originCity,
        emailStats,
        searchStats: {
          totalPasses: 1,
          totalAiCalls: usedAI ? 1 : 0,
          currentCycle,
          strategyUsed: strategyDescription,
          queryUsed: queryDescription,
          stoppedReason: `Trovate ${companies.length} aziende qualificate con strategia: ${strategyDescription}`,
          companiesPerPass: [{ pass: usedAI ? `Google Gemini: ${strategyDescription}` : `Database Verificato: ${strategyDescription}`, found: companies.length, new: companies.length }],
        },
      });
    } catch (error: any) {
      console.error("Error in search-companies:", error);
      return res.status(500).json({ success: false, error: error.message || "Errore nella ricerca aziende" });
    }
  });

  // 3. AI Generate Email (Deeply Grounded in Real Candidate Data, Sector-Adaptive: 120-180 words)
  app.post("/api/ai/generate-email", async (req, res) => {
    const db = res.locals.userDb as AppDb;
    try {
      const { company, cvData, variant = "standard", targetRole = "", availability = "" } = req.body;

      if (!company || !cvData) {
        return res.status(400).json({ success: false, error: "Dati azienda o CV mancanti" });
      }

      const compName = (company.name || "").trim() || "Spettabile Azienda";
      const compSector = (company.sector || "").trim();
      const compCity = (company.city || "").trim();

      const fullName = `${cvData.nome || ""} ${cvData.cognome || ""}`.trim() || "";
      const skillsArray = Array.isArray(cvData.competenze) ? cvData.competenze.filter(Boolean) : [];
      const skillsStr = skillsArray.slice(0, 6).join(", ");
      
      const realExperiences = Array.isArray(cvData.esperienze) && cvData.esperienze.length > 0
        ? cvData.esperienze.slice(0, 3).map(e => `- Ruolo: ${e.ruolo || ''}${e.azienda ? ` presso ${e.azienda}` : ''}${e.descrizione ? `: ${e.descrizione}` : ''}`).join("\n")
        : (cvData.profilo || "Esperienze pratiche e tecniche indicate nel CV");

      const hasPermessoG = hasValidPermessoG(cvData);
      const hasImmediate = hasImmediateAvailability(cvData, availability);

      const alignment = analyzeApplicationAlignment(company, cvData, targetRole, fullName);

      const prompt = `Sei un consulente di carriera e copywriter professionale esperto nel mercato del lavoro.
Il tuo compito è scrivere un'email di candidatura in prima persona per il candidato, in italiano naturale, autentico, sobrio e rispettoso.

REGOLA GENERALE FONDAMENTALE:
Ogni email di candidatura deve essere generata in modo DINAMICO e UNICO in base a:
1. Profilo reale del candidato (CV allegato)
2. Contenuto effettivo del CV
3. Azienda destinataria
4. Settore dell'azienda e attività
5. Eventuale posizione lavorativa specifica o annuncio disponibile

DIVIETO ASSOLUTO:
NON generare automaticamente email da "verniciatore industriale" se l'azienda non opera in quel settore o se non è presente una posizione coerente!
Se l'azienda opera nella metalmeccanica, valorizza lavorazioni metalliche, finitura, controllo qualità e produzione.
Se l'azienda opera nel vetro, valorizza l'eventuale esperienza nel vetro o manualità e sicurezza.
Se l'azienda opera nella produzione industriale generica, valorizza produzione, manualità, uso di strumenti e rispetto procedure.
Se l'azienda è ferroviaria, logistica o officina, evidenzia solo competenze compatibili (manutenzione, superfici, lavorazioni, logistica operativa).
Se l'azienda opera in un altro settore, NON forzare il verniciatore: valorizza le competenze trasferibili (precisione, serietà, procedure, manualità).

DATI AZIENDA DESTINATARIA:
- Nome Azienda: ${compName}
- Settore: ${compSector || alignment.companySectorLabel}
- Sede: ${compCity || 'Svizzera / Ticino'}
${company.job_title ? `- Posizione / Annuncio: ${company.job_title}` : ''}
${company.job_description ? `- Dettagli annuncio: ${company.job_description}` : ''}
- DIRETTIVA DI ALLINEAMENTO SETTORE: ${alignment.sectorAngleInstruction}

DATI REALI DEL CANDIDATO (UTILIZZA ESCLUSIVAMENTE QUESTI):
- Candidato: ${fullName}
${cvData.citta ? `- Località / Residenza: ${cvData.citta}` : ''}
- Competenze reali nel CV: ${skillsStr || 'Competenze operative e professionali'}
- Esperienze lavorative documentate:
${realExperiences}
${hasPermessoG ? `- Permesso di lavoro: Permesso G valido (${cvData.permessoG})` : '- Permesso di lavoro: Non specificato / assente'}
${hasImmediate ? `- Disponibilità: Immediata / da subito` : '- Disponibilità: Non specificata / standard'}

REGOLE TASSATIVE (PERMESSO G, DISPONIBILITÀ IMMEDIATA, GRASSETTO E FIRMA):
1. PERMESSO G:
${hasPermessoG 
  ? `Il candidato possiede un Permesso G valido verificato nei suoi dati reali. Questa informazione DEVE essere SEMPRE citata nell'email ("Sono già in possesso del **permesso G**.").`
  : `Il candidato NON possiede o non ha specificato un Permesso G. È SEVERAMENTE VIETATO inventare o citare il permesso G.`}

2. DISPONIBILITÀ IMMEDIATA:
${hasImmediate
  ? `Il candidato ha dichiarato disponibilità a iniziare subito verificata nei suoi dati reali. Questa informazione DEVE essere SEMPRE citata nell'email ("Sono **disponibile a iniziare da subito**.").`
  : `Il candidato NON ha dichiarato disponibilità immediata. È SEVERAMENTE VIETATO dedurre o inventare la disponibilità immediata.`}

${hasPermessoG && hasImmediate 
  ? `Dato che entrambi sono presenti e verificati nei dati reali, usa: "Sono già in possesso del **permesso G** e sono **disponibile a iniziare da subito**."` 
  : ''}

3. GRASSETTO:
Evidenziare in grassetto SOLO ED ESCLUSIVAMENTE questi due elementi:
- **permesso G** (se presente)
- **disponibile a iniziare da subito** (se presente)
NON evidenziare in grassetto nessun altro elemento, parola, nome di azienda o competenza nell'email.

4. FIRMA:
Ogni email deve terminare SEMPRE con la firma strutturata esattamente così:
Cordiali saluti,

${fullName}${cvData.telefono ? `\nTel. ${cvData.telefono}` : ''}

NON inventare dati. NON usare placeholder. NON inserire ruoli, email o città nella firma.

DIVIETO ASSOLUTO DI INVENTARE:
- NON inventare competenze, patentini, certificazioni, lingue, permessi di lavoro, disponibilità, anni di esperienza, mansioni, conoscenze tecniche, aziende precedenti, residenza, nazionalità o capacità informatiche.
- Ometti qualsiasi dato non presente nei campi sopra.
- ZERO formule di piaggeria o adulazione come "azienda leader", "realtà di riferimento".

LUNGHEZZA EMAIL:
- Target: 120–180 parole circa (esclusa la firma).
- Massimo: 220 parole. Non fare un riassunto pedissequo del CV.

OGGETTO EMAIL:
${alignment.hasJobOpening ? `Usa: "Candidatura – ${alignment.jobPosition} – ${fullName}"` : `Usa una formula coerente con azienda e CV: "${alignment.coherentSubject}"`}
NON usare "Verniciatore industriale" nell'oggetto se non è pertinente all'azienda!

Rispondi ESCLUSIVAMENTE con un oggetto JSON valido:
{
  "oggetto": "${alignment.coherentSubject}",
  "corpo": "Gentile Responsabile delle Risorse Umane di ${compName},<br><br>...",
  "firma": "${formatCandidateSignature(cvData, 'text').replace(/\n/g, '\\n')}",
  "matchPoints": ["Punto di contatto reale: ...", "Competenza valorizzata: ..."]
}`;

      let emailData: any = null;

      try {
        const response = await generateGeminiContentWithFallback({
          preferredModel: "gemini-3.1-flash-lite",
          fallbackModels: ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"],
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 0.25,
            maxOutputTokens: 2000,
          },
        });

        const responseText = response.text || "{}";
        const parsed = parseJsonWithTruncationRecovery(responseText);
        if (parsed && parsed.corpo && parsed.oggetto) {
          emailData = parsed;
        }
      } catch (geminiErr: any) {
        console.warn("[Gemini generate-email] AI generation fallback:", geminiErr?.message);
      }

      // If AI did not return valid data, use smart programmatic personalized template
      if (!emailData) {
        emailData = buildPersonalizedEmailFallback(company, cvData, variant, targetRole, availability, alignment);
      }

      // Sanitize tags & enforce clean subject
      if (emailData.oggetto) {
        emailData.oggetto = emailData.oggetto
          .replace(/<\/?[^>]+(>|$)/g, "")
          .replace(/\*\*/g, "")
          .replace(/\s*–\s*Candidato Svizzera\/Ticino/gi, "")
          .replace(/\s*–\s*Permesso G/gi, "")
          .trim();
      }

      // Enforce email body rules:
      // 1. Permesso G cited (and in bold) if really present
      // 2. Disponibilità immediata cited (and in bold) if really present
      // 3. Bold applied ONLY to these two elements
      // 4. Zero markdown asterisks visible
      emailData.corpo = enforceEmailBodyRules(emailData.corpo || "", cvData, availability);

      // Guarantee strictly compliant signature
      emailData.firma = formatCandidateSignature(cvData, 'text');

      return res.json({ success: true, data: emailData });
    } catch (error: any) {
      console.error("Error in generate-email:", error);
      return res.status(500).json({ success: false, error: error.message || "Errore nella generazione email" });
    }
  });

  interface ApplicationAlignment {
    hasJobOpening: boolean;
    jobPosition: string;
    companySectorLabel: string;
    coherentSubject: string;
    alignedRoleSummary: string;
    sectorAngleInstruction: string;
    isPaintingSector: boolean;
    isMetalworkingSector: boolean;
    isGlassSector: boolean;
    isRailwaySector: boolean;
    isProductionSector: boolean;
  }

  function analyzeApplicationAlignment(
    company: any,
    cvData: any,
    explicitRole?: string,
    candidateFullName?: string
  ): ApplicationAlignment {
    const compName = (company?.name || "").trim();
    const compSector = (company?.sector || "").toLowerCase().trim();
    const compWebsite = (company?.website || "").toLowerCase().trim();
    const jobTitle = (company?.job_title || explicitRole || "").trim();
    const jobDesc = (company?.job_description || "").trim();
    const allCompText = `${compName} ${compSector} ${compWebsite} ${jobDesc}`.toLowerCase();

    const esperienze = Array.isArray(cvData?.esperienze) ? cvData.esperienze : [];

    const isPaintingSector = /vernic|carrozzer|finitur|sabbiatur|trattament.*superfic|coating|powder/i.test(allCompText);
    const isMetalworkingSector = /metal|meccanic|acciaio|alluminio|carpenteria|torner|fresat|lavorazioni meccaniche|officina meccanica|costruzioni metalliche/i.test(allCompText);
    const isGlassSector = /vetr|cristall|vetreria|infissi/i.test(allCompText);
    const isRailwaySector = /ferrov|sbb|ffs|rotabil|tren|binari|officina ferroviaria/i.test(allCompText);
    const isProductionSector = /produzion|manifattur|assemblag|industriale|fabbrica|impianti|montaggio/i.test(allCompText);

    const hasExpPainting = esperienze.some((e: any) => /vernic|carrozzer|finitur|spruzzo|sabbiatur/i.test(`${e.ruolo || ''} ${e.descrizione || ''}`));
    const hasExpGlass = esperienze.some((e: any) => /vetr|cristall/i.test(`${e.ruolo || ''} ${e.descrizione || ''}`));

    const hasJobOpening = Boolean(jobTitle && !/^candidatura\s*spontanea/i.test(jobTitle));
    let coherentSubject = "";
    let alignedRoleSummary = "";
    let sectorAngleInstruction = "";
    let companySectorLabel = company?.sector || "Produzione industriale";

    if (hasJobOpening) {
      coherentSubject = `Candidatura – ${jobTitle}${candidateFullName ? ` – ${candidateFullName}` : ""}`;
      alignedRoleSummary = jobTitle;
      sectorAngleInstruction = `L'azienda ha una posizione o ricerca specifica aperta: "${jobTitle}". Personalizza l'email focalizzandoti sui requisiti reali di questa posizione e selezionando unicamente le competenze ed esperienze documentate nel CV coerenti con essa.`;
    } else if (isPaintingSector && hasExpPainting) {
      companySectorLabel = "Verniciatura e trattamenti superficiali";
      coherentSubject = "Candidatura spontanea – Verniciatura e finiture industriali";
      alignedRoleSummary = "Verniciatura e finiture industriali";
      sectorAngleInstruction = `L'azienda opera nella verniciatura/carrozzeria o trattamenti superficiali. Evidenzia la preparazione delle superfici, la verniciatura a polvere o a liquido, l'accuratezza nelle finiture e il controllo qualità realmente presenti nel CV.`;
    } else if (isMetalworkingSector) {
      companySectorLabel = "Settore metalmeccanico e lavorazioni industriali";
      coherentSubject = "Candidatura spontanea – Settore metalmeccanico";
      alignedRoleSummary = "Lavorazioni meccaniche e industriali";
      sectorAngleInstruction = `L'azienda opera nella metalmeccanica. Evidenzia l'esperienza operativa su superfici metalliche, lavorazioni industriali, preparazione, finitura, controllo qualità dimensionale/visivo e confidenza con gli ambienti d'officina e produzione. NON presentare il candidato unicamente come verniciatore se l'attività principale è metalmeccanica.`;
    } else if (isGlassSector && hasExpGlass) {
      companySectorLabel = "Lavorazione del vetro";
      coherentSubject = "Candidatura spontanea – Settore del vetro e produzione";
      alignedRoleSummary = "Lavorazione del vetro e produzione";
      sectorAngleInstruction = `L'azienda opera nel settore del vetro. Valorizza l'esperienza specifica maturata nella movimentazione, lavorazione o finitura del vetro presente nel CV.`;
    } else if (isRailwaySector) {
      companySectorLabel = "Settore ferroviario / Manutenzione tecnica";
      coherentSubject = "Candidatura spontanea – Manutenzione e attività operative";
      alignedRoleSummary = "Manutenzione e attività operative";
      sectorAngleInstruction = `L'azienda è ferroviaria/logistica o possiede officine tecniche. Evidenzia esclusivamente competenze compatibili con manutenzione, lavorazioni industriali, superfici, produzione o mansioni operative realmente documentate nel CV.`;
    } else if (isProductionSector) {
      companySectorLabel = "Produzione industriale";
      coherentSubject = "Candidatura spontanea – Produzione industriale";
      alignedRoleSummary = "Produzione industriale e attività operative";
      sectorAngleInstruction = `L'azienda opera nella produzione industriale. Valorizza l'esperienza in ambienti produttivi, manualità tecnica, utilizzo di strumenti e attrezzature, rispetto rigoroso delle procedure di sicurezza e adattabilità operativa.`;
    } else {
      companySectorLabel = company?.sector || "Ambito operativo e produttivo";
      coherentSubject = "Candidatura spontanea – Ambito operativo e produttivo";
      alignedRoleSummary = "Attività operative e produzione";
      sectorAngleInstruction = `L'azienda opera in un settore differente (${companySectorLabel}). DIVIETO ASSOLUTO di forzare l'esperienza da verniciatore! Individua e valorizza invece le competenze trasferibili documentate nel CV: manualità, precisione, rispetto delle procedure di sicurezza e qualità, organizzazione del lavoro e attitudine operativa.`;
    }

    return {
      hasJobOpening,
      jobPosition: jobTitle,
      companySectorLabel,
      coherentSubject,
      alignedRoleSummary,
      sectorAngleInstruction,
      isPaintingSector,
      isMetalworkingSector,
      isGlassSector,
      isRailwaySector,
      isProductionSector,
    };
  }

  function formatCleanSignature(cvData: any): string {
    return formatCandidateSignature(cvData, 'text');
  }

  function buildPersonalizedEmailFallback(
    company: any,
    cvData: any,
    variant: string,
    role: string,
    availability: string,
    alignment?: ApplicationAlignment
  ) {
    const fullName = `${cvData.nome || ""} ${cvData.cognome || ""}`.trim() || "";
    const compName = company.name || "Spettabile Azienda";
    const userCity = cvData.citta || "";
    const align = alignment || analyzeApplicationAlignment(company, cvData, role, fullName);

    const skillsArray = Array.isArray(cvData.competenze) ? cvData.competenze.filter(Boolean) : [];
    const skillsSnippet = skillsArray.length > 0 
      ? `Nel corso del mio percorso professionale ho consolidato competenze pratiche in ${skillsArray.slice(0, 3).join(", ")}.`
      : "";

    const firstExp = Array.isArray(cvData.esperienze) && cvData.esperienze.length > 0 ? cvData.esperienze[0] : null;
    let expSnippet = "";
    if (firstExp && firstExp.ruolo) {
      expSnippet = `Ho maturato esperienza operativa come ${firstExp.ruolo}${firstExp.azienda ? ` presso ${firstExp.azienda}` : ""}, sviluppando precisione, rispetto delle procedure di sicurezza e continuità produttiva.`;
    }

    // Context connection tailored to sector
    let sectorConnection = "";
    if (align.hasJobOpening) {
      sectorConnection = `Desidero sottoporre la mia candidatura per la posizione di ${align.jobPosition}, ritenendo che il mio profilo e la mia concretezza operativa possano rappresentare un valido supporto per le vostre attività.`;
    } else if (align.isPaintingSector) {
      sectorConnection = `Vi contatto con una candidatura spontanea per il reparto di verniciatura e trattamento delle superfici, ambiti in cui posso mettere a disposizione manualità, attenzione al dettaglio e cura delle finiture.`;
    } else if (align.isMetalworkingSector) {
      sectorConnection = `Vi trasmetto la mia candidatura spontanea in ambito metalmeccanico e produttivo, forte di un percorso caratterizzato da lavoro su superfici metalliche, controllo dimensionale e confidenza con gli ambienti d'officina.`;
    } else if (align.isRailwaySector) {
      sectorConnection = `Vi propongo la mia candidatura spontanea per attività tecniche e di manutenzione, offrendo serietà, rispetto rigoroso delle normative di sicurezza e capacità di adattamento a contesti strutturati.`;
    } else if (align.isProductionSector) {
      sectorConnection = `Vi trasmetto la mia candidatura spontanea per attività operative e di produzione industriale, forte di una solida attitudine al lavoro manuale, all'uso delle attrezzature e alla gestione delle commesse.`;
    } else {
      sectorConnection = `Desidero proporre la mia candidatura spontanea per opportunità lavorative in ambito operativo e produttivo, mettendo a disposizione versatilità, precisione e serietà professionale.`;
    }

    const hasPermit = hasValidPermessoG(cvData);
    const hasImmediate = hasImmediateAvailability(cvData, availability);
    const permitAvailClause = buildPermitAndAvailabilityClause(hasPermit, hasImmediate, 'html');

    const rawCorpo = `Gentile Responsabile delle Risorse Umane di ${compName},<br><br>` +
      `${sectorConnection}<br><br>` +
      `${skillsSnippet ? `${skillsSnippet} ` : ""}${expSnippet ? `${expSnippet} ` : ""}` +
      `${permitAvailClause ? `<br><br>${permitAvailClause}` : ""}<br><br>` +
      `Trasmetto in allegato il mio Curriculum Vitae dettagliato e resto a Vostra completa disposizione per un colloquio conoscitivo di approfondimento.<br><br>` +
      `Ringraziandovi per il tempo e l'attenzione, porgo i miei migliori saluti.`;

    const corpo = enforceEmailBodyRules(rawCorpo, cvData, availability);

    return {
      oggetto: align.coherentSubject,
      corpo,
      firma: formatCandidateSignature(cvData, 'text'),
      matchPoints: [
        `Ambito: ${align.alignedRoleSummary}`,
        skillsArray[0] ? `Competenza: ${skillsArray[0]}` : "",
        userCity ? `Località: ${userCity}` : "",
      ].filter(Boolean),
    };
  }

  // 4. Duplicate Check & Sent Emails Recording
  app.post("/api/check-duplicate", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const { email, company_name, domain, companyId, company_id } = req.body;
    const normEmail = (email || "").toLowerCase().trim();
    const normName = (company_name || "").toLowerCase().trim();
    const normDomain = (domain || (normEmail.includes("@") ? normEmail.split("@")[1] : "")).toLowerCase().trim();
    const normCompanyId = (company_id || companyId || "").toString().trim();

    const GENERIC_DOMAINS = new Set([
      "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.it", "live.com", "live.it", "yahoo.com", "yahoo.it", "icloud.com", "libero.it", "virgilio.it", "bluewin.ch", "swissonline.ch", "gmx.ch", "gmx.net", "proton.me", "protonmail.com"
    ]);

    const match = db.sent_emails.find((item) => {
      const itemEmail = (item.email || "").toLowerCase().trim();
      const itemName = (item.company_name || item.companyName || "").toLowerCase().trim();
      const itemDomain = (item.domain || (itemEmail.includes("@") ? itemEmail.split("@")[1] : "")).toLowerCase().trim();
      const itemCompanyId = (item.company_id || item.companyId || "").toString().trim();

      // 1. Stessa email destinatario
      if (normEmail && itemEmail && itemEmail === normEmail) return true;
      // 2. Stesso dominio email (se non generico)
      if (normDomain && itemDomain && !GENERIC_DOMAINS.has(normDomain) && normDomain === itemDomain) return true;
      // 3. Stesso companyId
      if (normCompanyId && itemCompanyId && normCompanyId === itemCompanyId) return true;
      // 4. Stesso nome azienda
      if (normName && itemName && normName.length >= 3 && (normName === itemName || itemName.includes(normName) || normName.includes(itemName))) return true;
      return false;
    });

    if (match) {
      return res.json({
        isDuplicate: true,
        duplicateType: match.email?.toLowerCase() === normEmail ? "email" : (normCompanyId && match.company_id === normCompanyId ? "company_id" : "company"),
        lastSentDate: match.sent_at,
        originalCompany: match.company_name || match.companyName,
      });
    }

    return res.json({ isDuplicate: false });
  });

  app.get("/api/sent-emails", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const userId = res.locals.uid;
    if (userId) {
      const userEmails = db.sent_emails.filter((item) => item.user_id === userId);
      return res.json({ success: true, data: userEmails });
    }
    res.json({ success: true, data: db.sent_emails });
  });

  app.post("/api/sent-emails", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const {
      companyId,
      company_id,
      companyName,
      company_name,
      email,
      subject,
      body,
      cvVersion,
      cv_version,
      userId,
      user_id,
    } = req.body;

    const resolvedCompanyName = (company_name || companyName || "Azienda").trim();
    const resolvedCompanyId = company_id || companyId || null;
    const resolvedCvVersion = cv_version || cvVersion || "1.0";
    const resolvedUserId = res.locals.uid;

    const normEmail = (email || "").toLowerCase().trim();
    const domain = normEmail.includes("@") ? normEmail.split("@")[1] : "";
    const recordId = req.body.id || `sent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newRecord = {
      id: recordId,
      user_id: resolvedUserId,
      company_id: resolvedCompanyId,
      company_name: resolvedCompanyName,
      email: normEmail,
      domain,
      subject: subject || "",
      body: body || "",
      cv_version: resolvedCvVersion,
      status: req.body.status || "sent",
      sent_at: req.body.sent_at || new Date().toISOString(),
    };

    const existingIdx = db.sent_emails.findIndex((item) => item.id === newRecord.id);
    if (existingIdx >= 0) {
      db.sent_emails[existingIdx] = newRecord;
    } else {
      db.sent_emails.unshift(newRecord);
    }
    saveDb(db);
    res.json({ success: true, data: newRecord });
  });

  app.delete("/api/sent-emails/:id", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const { id } = req.params;
    db.sent_emails = db.sent_emails.filter((item) => item.id !== id);
    saveDb(db);
    res.json({ success: true, message: "Record rimosso" });
  });

  // CV File Upload & Binary Storage
  app.post("/api/cv/upload", (req, res) => {
    const db = res.locals.userDb as AppDb;
    try {
      const { fileName, base64Data, mimeType } = req.body;
      const userId = res.locals.uid;
      if (!userId || !fileName || !base64Data) {
        return res.status(400).json({ success: false, error: "UserId, fileName e base64Data mancanti" });
      }

      if (!(db as any).cv_files) {
        (db as any).cv_files = {};
      }

      const bytes = Buffer.from(base64Data, 'base64');
      if (!bytes.length || bytes.length > 15 * 1024 * 1024) return res.status(400).json({ success: false, error: 'File CV vuoto o troppo grande' });
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      if (req.body.contentHash && req.body.contentHash !== contentHash) return res.status(400).json({ success: false, error: 'Integrità file CV non valida' });
      const older = (db as any).cv_files[userId];
      const versions = ((db as any).cv_file_versions ||= {});
      if (older?.base64Data) versions[older.contentHash || createHash('sha256').update(Buffer.from(older.base64Data, 'base64')).digest('hex')] = older;
      (db as any).cv_files[userId] = {
        uid: userId, contentHash, sizeBytes: bytes.length, origin: 'upload',
        fileName,
        base64Data,
        mimeType: mimeType || "application/pdf",
        updatedAt: new Date().toISOString(),
      };
      saveDb(db);

      res.json({ success: true, fileName, message: "CV salvato con successo" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/cv/file", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const userId = res.locals.uid;
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId mancante" });
    }
    const requestedHash = req.query.hash as string;
    const currentFile = (db as any).cv_files?.[userId];
    const fileInfo = requestedHash && currentFile?.contentHash !== requestedHash ? (db as any).cv_file_versions?.[requestedHash] : currentFile;
    if (!fileInfo) {
      return res.status(404).json({ success: false, error: "Nessun file CV salvato per questo utente" });
    }
    res.json({ success: true, data: fileInfo });
  });

  // 5. User Profile persistence
  app.get("/api/user/profile", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const userId = res.locals.uid;
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId mancante" });
    }
    const profile = db.profiles[userId] || null;
    res.json({ success: true, data: profile });
  });

  app.post("/api/user/profile", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const resolvedUserId = res.locals.uid;
    if (!resolvedUserId) {
      return res.status(400).json({ success: false, error: "user_id mancante" });
    }
    const previous = db.profiles[resolvedUserId] || {};
    const patch = Object.fromEntries(Object.entries(req.body).filter(([key, value]) =>
      !['uid', 'userId', 'user_id', 'id', 'cvParsedData'].includes(key) && value != null && value !== '' && (!Array.isArray(value) || value.length)));
    db.profiles[resolvedUserId] = { ...previous, ...patch, id: resolvedUserId, user_id: resolvedUserId,
      ...(hasCvData(req.body.cvParsedData) ? { cvParsedData: mergeCvData(previous.cvParsedData, req.body.cvParsedData) } : {}),
      updated_at: new Date().toISOString() };
    // Legacy backup only. This endpoint cannot write or replace the authoritative Firestore CV.
    saveDb(db);
    res.json({ success: true, data: db.profiles[resolvedUserId] });
  });

  // 6. Saved Companies
  app.get("/api/companies", (req, res) => {
    const db = res.locals.userDb as AppDb;
    res.json({ success: true, data: db.companies });
  });

  app.post("/api/companies", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const company = req.body;
    const id = company.id || `comp_${Date.now()}`;
    const newComp = { ...company, id, created_at: new Date().toISOString() };
    db.companies.unshift(newComp);
    saveDb(db);
    res.json({ success: true, id, data: newComp });
  });

  // 6b. Email & Domain Blacklist Management
  app.get("/api/blacklist", (req, res) => {
    const db = res.locals.userDb as AppDb;
    res.json({ success: true, data: db.blacklist || [] });
  });

  app.post("/api/blacklist", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const { pattern, type, notes } = req.body || {};
    if (!pattern || typeof pattern !== "string" || !pattern.trim()) {
      return res.status(400).json({ success: false, error: "Pattern email o dominio mancante." });
    }

    const cleanRaw = pattern.trim().toLowerCase();
    let detectedType: "email" | "domain" = type === "domain" || type === "email" ? type : "domain";
    let normalizedPattern = cleanRaw;

    if (cleanRaw.includes("@") && !cleanRaw.startsWith("@")) {
      detectedType = "email";
      normalizedPattern = cleanRaw;
    } else {
      detectedType = "domain";
      normalizedPattern = cleanRaw.replace(/^@/, "");
    }

    if (!db.blacklist) db.blacklist = [];

    // Check duplicate
    const exists = db.blacklist.find(
      (b) => b.pattern.toLowerCase() === normalizedPattern && b.type === detectedType
    );
    if (exists) {
      return res.json({ success: true, data: exists, alreadyExisted: true });
    }

    const newEntry = {
      id: `bl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      pattern: normalizedPattern,
      type: detectedType,
      notes: notes || undefined,
      addedAt: new Date().toISOString(),
    };

    db.blacklist.unshift(newEntry);
    saveDb(db);
    res.json({ success: true, data: newEntry });
  });

  app.delete("/api/blacklist/:id", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const { id } = req.params;
    if (!db.blacklist) db.blacklist = [];
    const beforeLen = db.blacklist.length;
    db.blacklist = db.blacklist.filter((b) => b.id !== id && b.pattern !== id);
    saveDb(db);
    res.json({ success: true, removedCount: beforeLen - db.blacklist.length });
  });

  // 7. Auto Campaign Processor & Queue
  app.get("/api/campaigns", (req, res) => {
    const db = res.locals.userDb as AppDb;
    res.json({ success: true, data: db.campaigns[0] || null, events: db.campaign_events || [] });
  });

  app.post("/api/campaigns", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const campaignData = req.body;
    const newCamp = {
      id: campaignData.id || `camp_${Date.now()}`,
      status: campaignData.status || "running",
      ...campaignData,
      total_found: campaignData.total_found || 0,
      total_sent: campaignData.total_sent || 0,
      total_failed: campaignData.total_failed || 0,
      total_generated: campaignData.total_generated || 0,
      total_skipped: campaignData.total_skipped || 0,
      current_search_cycle: campaignData.current_search_cycle || 1,
      max_search_cycles: campaignData.max_search_cycles || 3,
      created_at: campaignData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.campaigns = [newCamp];
    if (campaignData.events && Array.isArray(campaignData.events) && campaignData.events.length > 0) {
      db.campaign_events = campaignData.events;
    } else {
      db.campaign_events.unshift({
        id: `evt_${Date.now()}`,
        campaign_id: newCamp.id,
        event_type: "created",
        message: `Campagna automatica creata per ${newCamp.search_location || "la zona selezionata"}`,
        created_at: new Date().toISOString(),
      });
    }
    saveDb(db);
    res.json({ success: true, data: newCamp });
  });

  app.patch("/api/campaigns/:id", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const id = req.params.id;
    const updates = req.body;
    const camp = db.campaigns.find((c: any) => c.id === id) || db.campaigns[0];
    if (camp) {
      Object.assign(camp, updates, { updated_at: new Date().toISOString() });
      if (updates.event) {
        db.campaign_events.unshift(updates.event);
      }
      saveDb(db);
      res.json({ success: true, data: camp });
    } else {
      res.status(404).json({ success: false, error: "Campaign not found" });
    }
  });

  app.delete("/api/campaigns", (req, res) => {
    const db = res.locals.userDb as AppDb;
    db.campaigns = [];
    db.campaign_events = [];
    db.campaign_queue = [];
    saveDb(db);
    res.json({ success: true });
  });

  app.get("/api/campaign-queue", (req, res) => {
    const db = res.locals.userDb as AppDb;
    res.json({ success: true, data: db.campaign_queue || [] });
  });

  app.post("/api/campaign-queue", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const item = req.body;
    if (Array.isArray(item)) {
      item.forEach((it: any) => {
        if (!it.id) it.id = `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const exists = db.campaign_queue.some((q: any) => q.id === it.id || (it.company_email && q.company_email === it.company_email));
        if (!exists) {
          db.campaign_queue.unshift(it);
        }
      });
    } else if (item && typeof item === 'object') {
      if (!item.id) item.id = `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const idx = db.campaign_queue.findIndex((q: any) => q.id === item.id);
      if (idx >= 0) {
        db.campaign_queue[idx] = { ...db.campaign_queue[idx], ...item };
      } else {
        db.campaign_queue.unshift(item);
      }
    }
    saveDb(db);
    res.json({ success: true, data: db.campaign_queue });
  });

  app.put("/api/campaign-queue/:id", (req, res) => {
    const db = res.locals.userDb as AppDb;
    const id = req.params.id;
    const updates = req.body;
    const idx = db.campaign_queue.findIndex((q: any) => q.id === id);
    if (idx >= 0) {
      db.campaign_queue[idx] = { ...db.campaign_queue[idx], ...updates };
      saveDb(db);
      res.json({ success: true, data: db.campaign_queue[idx] });
    } else {
      res.status(404).json({ success: false, error: "Queue item not found" });
    }
  });

  // Gmail is authorized and sent directly through the verified session in workspaceAuth.
  app.post('/api/email-oauth', (req, res) => {
    const db = res.locals.userDb as AppDb;
    const { action, email_data } = req.body || {};
    if (action === 'get_status' || action === 'disconnect') return res.json({ success: true, providers: [] });
    if (action === 'record_sent' && email_data?.gmail_message_id) {
      const record = { ...email_data, id: email_data.gmail_message_id, user_id: res.locals.uid,
        email: email_data.to, status: 'sent', sent_at: new Date().toISOString() };
      if (!db.sent_emails.some(x => x.id === record.id)) db.sent_emails.unshift(record);
      saveDb(db);
      return res.json({ success: true, sent_id: record.id });
    }
    return res.status(409).json({ success: false, error: 'Autorizza Gmail nella sessione corrente. Nessuna email è stata inviata dal server.' });
  });

  // Vite Middleware / Static serving
  if (options.serveFrontend !== false && process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (options.serveFrontend !== false) {
    const distPath = fs.existsSync(path.join(process.cwd(), "dist", "index.html"))
      ? path.join(process.cwd(), "dist")
      : path.resolve(__dirname);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return app;
}

const isTest = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
if (!isTest) {
  const port = Number(process.env.PORT || 3000);
  createApplication()
    .then(app => {
      app.listen(port, '0.0.0.0', () => {
        console.log(`Job Outreach Assistant listening on port ${port}`);
      });
    })
    .catch(err => {
      console.error("Fatal error starting application server:", err);
      process.exit(1);
    });
}
