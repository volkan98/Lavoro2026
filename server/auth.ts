import type { RequestHandler } from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import config from '../firebase-applet-config.json';

function getAdminApp() {
  const existing = getApps();
  if (existing.length > 0) return existing[0];
  const projectId = config?.projectId || process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'gen-lang-client-0591706177';
  return initializeApp(projectId ? { projectId } : undefined);
}

export function getAdminDb() {
  const app = getAdminApp();
  const databaseId = config?.firestoreDatabaseId || '(default)';
  return getFirestore(app, databaseId);
}

export function firebaseAuthMiddleware(verify = (token: string) => {
  const app = getAdminApp();
  return getAuth(app).verifyIdToken(token);
}): RequestHandler {
  return async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) { res.status(401).json({ success: false, error: 'Accesso Firebase richiesto' }); return; }
    try {
      const identity = await verify(token);
      if (!identity.uid) throw new Error('UID mancante');
      const claims = [req.query.userId, req.body?.userId, req.body?.user_id, req.body?.email_data?.userId];
      if (claims.some(uid => uid !== undefined && uid !== identity.uid)) {
        res.status(403).json({ success: false, error: 'UID diverso dalla sessione Firebase' }); return;
      }
      res.locals.uid = identity.uid;
      next();
    } catch { res.status(401).json({ success: false, error: 'Token Firebase non valido o scaduto' }); }
  };
}
