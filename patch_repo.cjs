const fs = require('fs');
let code = fs.readFileSync('src/lib/cvRepository.ts', 'utf8');

const readSnapshotOriginal = `  try {
    cloud = (await Promise.race([
      getDocFromServer(ref),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Firestore connection timeout')), 10000))
    ])).data() || {};
    logFirestoreReadDiagnostics(true);
  } catch (e: any) {
    fetchError = e;
    logFirestoreReadDiagnostics(false, e);
  }`;

const readSnapshotNew = `  // Tenta PRIMA il backend veloce
  try {
    const response = await apiFetch('/api/user/profile', {}, uid);
    if (response.ok) {
      const json = await response.json();
      if (json.success && json.data) {
        cloud = json.data;
        // Se il backend ha i dati completi, non interroghiamo nemmeno Firestore
        if (cloud.cvParsedData) {
          fetchError = null;
        }
      }
    }
  } catch { /* Ignora e passa a Firestore */ }

  if (!cloud || !cloud.cvParsedData) {
    try {
      cloud = (await Promise.race([
        getDocFromServer(ref),
        // Timeout molto più breve per non bloccare l'UI
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Firestore connection timeout')), 2500))
      ])).data() || {};
      logFirestoreReadDiagnostics(true);
      fetchError = null;
    } catch (e: any) {
      fetchError = e;
      logFirestoreReadDiagnostics(false, e);
    }
  }`;

code = code.replace(readSnapshotOriginal, readSnapshotNew);

fs.writeFileSync('src/lib/cvRepository.ts', code, 'utf8');
