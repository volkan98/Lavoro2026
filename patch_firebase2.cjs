const fs = require('fs');
let code = fs.readFileSync('src/lib/firebase.ts', 'utf8');

const logFn = `export function logFirestoreReadDiagnostics(success: boolean, err?: any) {
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
}`;

code = code.replace(/export function logFirestoreReadDiagnostics[\s\S]*?\}\n\}/, logFn);
fs.writeFileSync('src/lib/firebase.ts', code, 'utf8');
