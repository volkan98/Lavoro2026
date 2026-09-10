import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore, type Firestore } from 'firebase/firestore';
import firebaseConfigJson from '../../firebase-applet-config.json';
import { BUILD_VERSION, BUILD_TIMESTAMP } from './version';

export const firebaseConfig = {
  apiKey: firebaseConfigJson.apiKey,
  authDomain: firebaseConfigJson.authDomain,
  projectId: firebaseConfigJson.projectId,
  storageBucket: firebaseConfigJson.storageBucket,
  messagingSenderId: firebaseConfigJson.messagingSenderId,
  appId: firebaseConfigJson.appId,
};

// Initialize Firebase App
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize Auth
export const auth = getAuth(app);

// Determine databaseId: respect configured firestoreDatabaseId if present in config or env, else '(default)'
export const databaseId: string =
  (firebaseConfigJson as any).firestoreDatabaseId ||
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIRESTORE_DATABASE_ID) ||
  '(default)';

// Initialize Firestore explicitly with transport options compatible with hosting/proxy and public deployments
export const db: Firestore = getFirestore(app, databaseId);

/**
 * Diagnostic logger for public deployment verification.
 * Does NOT log any OAuth tokens, passwords, or secret credentials.
 */
export function logFirebaseConfigDiagnostics() {
  if (typeof window === 'undefined') return;
  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || null;
  const email = currentUser?.email || null;

  console.groupCollapsed ? console.groupCollapsed('[FIREBASE & DATA DIAGNOSTICS]') : console.info('--- DIAGNOSTICS ---');

  console.info('[APP VERSION]');
  console.info('buildVersion:', BUILD_VERSION);
  console.info('buildTimestamp:', BUILD_TIMESTAMP);

  console.info('[FIREBASE]');
  console.info('hostname:', window.location.hostname);
  console.info('projectId:', firebaseConfig.projectId);
  console.info('databaseId:', databaseId);
  console.info('authDomain:', firebaseConfig.authDomain);
  console.info('authenticated email:', email ? email : 'none');
  console.info('authenticated uid:', uid ? uid : 'none');

  console.info('[DATA]');
  console.info('campaign document path:', uid ? `users/${uid}/campaigns/current` : 'none (unauthenticated)');
  console.info('queue source:', uid ? `users/${uid}/campaigns/current/queue (Firestore Subcollection)` : 'none');
  console.info('sent history source:', uid ? `users/${uid}/sentEmails (Firestore Collection)` : 'none');
  console.info('blacklist source:', uid ? `users/${uid}/blacklist (Firestore Collection)` : 'none');
  console.info('CV source:', uid ? `users/${uid}/cv_binary/current & users/${uid}.cvParsedData (Firestore)` : 'none');

  console.groupEnd ? console.groupEnd() : console.info('--- END DIAGNOSTICS ---');
}

export function logFirestoreReadDiagnostics(success: boolean, err?: any) {
  if (success) {
    console.info('[FIRESTORE] read users/{uid}: success');
  } else {
    const errMsg = err?.message || String(err);
    if (errMsg.includes('timeout')) {
      console.warn('[FIRESTORE] read users/{uid}: connection timeout, falling back securely.');
      return;
    }
    console.error('[FIRESTORE] read users/{uid}: error');
    console.error('[FIRESTORE] error.code:', err?.code || 'unknown');
    console.error('[FIRESTORE] error.message:', errMsg);
  }
}

// Run initial diagnostic log on client start
if (typeof window !== 'undefined') {
  try {
    logFirebaseConfigDiagnostics();
  } catch {
    // Suppress SSR/init issues
  }
}
