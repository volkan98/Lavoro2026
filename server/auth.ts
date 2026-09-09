import type { RequestHandler } from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import config from '../firebase-applet-config.json';

export function firebaseAuthMiddleware(verify = (token: string) => {
  const app = getApps()[0] || initializeApp({ projectId: config.projectId });
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
