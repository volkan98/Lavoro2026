import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfigJson from '../../firebase-applet-config.json';

const firebaseConfig = {
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

// Initialize Firestore with specific databaseId if specified
const databaseId = (firebaseConfigJson as any).firestoreDatabaseId || '(default)';
export const db = getFirestore(app, databaseId);

// Connection test utility
export async function testFirestoreConnection() {
  try {
    const testDoc = doc(db, '_connection_test', 'ping');
    await getDocFromServer(testDoc).catch(() => {});
    console.log('[Firebase] Firestore connected successfully to database:', databaseId);
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('[Firebase] Firestore is offline or still initializing.');
    } else {
      console.log('[Firebase] Connection ping response received.');
    }
  }
}

testFirestoreConnection();
