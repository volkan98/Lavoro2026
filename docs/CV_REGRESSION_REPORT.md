**Report del fix CV, identità Firebase e allegato Auto Mode — 9 settembre 2026**

Analisi iniziale sul commit `a38f1c0a5b712dee02147f787b94630478940de6` di `volkan98/Lavoro2026`. Le nove modifiche dello screenshot erano già presenti: il fix prosegue da quella versione. Nessuna email reale è stata inviata durante le verifiche.

**Cause individuate nel codice**

1. `aiAgent.parseCV()` intercettava errori/timeout di Gemini e restituiva `success: true` con esperienze, istruzione e lingue vuote. Il frontend salvava questo risultato come CV analizzato.
2. `normalizeCvData()` produceva proprietà `undefined`: Firestore le rifiuta. `saveProfile()` nascondeva l’errore e dichiarava comunque successo. La regola è stata verificata anche con il vero SDK nell’emulatore.
3. `persistCvFile()` scriveva in IndexedDB sotto `current_cv`, mentre i loader cercavano `cv_${userId}`. Upload e recupero non condividevano la chiave.
4. `useAuth` accettava sessioni da localStorage e login email senza verificare la password, generava ID `usr_...` dall’email e token `token_...`. Altri moduli usavano un ID utente predefinito. Il login Google utilizzava invece il Firebase UID.
5. `POST /api/user/profile` sostituiva integralmente il record. I POST parziali del login potevano cancellare il profilo estratto. La conversione inversa dal profilo ricostruiva sempre tre array vuoti.
6. `CVContext`, ciascuna istanza di `useUserProfile` e `CVUploader` eseguivano caricamenti separati. I flag “pronto” accettavano anche il solo nome del file.
7. Parser, normalizzatore e Sintesi inserivano informazioni non dimostrate: idoneità al permesso G, anni calcolati dal numero di esperienze, disponibilità immediata e istruzione/lingue predefinite.
8. `getVerifiedCvAttachment()` creava un nuovo PDF dal profilo quando il file originale non era disponibile: con un profilo incompleto produceva il PDF quasi vuoto segnalato. Il server aveva anche un percorso che dichiarava un invio riuscito senza effettuare una chiamata al provider.

**Flusso corretto**

Il login Firebase risolve l’identità. L’upload manda il documento completo al parser: PDF come documento multimodale, DOCX estratto con Mammoth, TXT come testo. Non ci sono tagli alle prime tre pagine o ai primi 8.000 caratteri. La risposta JSON deve essere integra e viene normalizzata tramite la funzione unica condivisa anche dal backend. Un errore resta un errore.

Il binario originale viene salvato con nome, MIME, dimensione e SHA-256; i dati estratti e i metadati vengono salvati in una transazione Firestore. La cache viene aggiornata dopo la conferma della scrittura. La Sintesi legge lo stato del solo `UserProfileProvider`; non ricostruisce più un curriculum dal profilo anagrafico.

Al riavvio si legge prima Firestore. Le cache sono una copia di emergenza, segnalata come tale quando il cloud non è raggiungibile. I dati legacy parziali non sovrascrivono un documento completo più recente. Se mancano dati estratti validi ma esiste il binario associato allo stesso UID, il recupero riesegue il parsing una volta. Un tentativo fallito viene registrato, evitando cicli di parsing a ogni refresh; il pulsante “Riprova analisi” permette un nuovo tentativo esplicito.

**Strutture precedenti e corrette**

| Area | Prima | Dopo |
| --- | --- | --- |
| Identità | Firebase UID, ID dall’email, ID predefinito, sessione locale | Solo `auth.currentUser.uid`, esposto come `user.id` per compatibilità dei componenti |
| Documento utente | Campi piatti/profilo ridotto e `cvParsedData` non garantito | `users/{uid}` con `uid`, `schemaVersion: 2`, `profile`, `cvMetadata`, `cvParsedData`, `updatedAt` |
| CV strutturato | Schemi distinti nell’API e nella UI, array ricostruiti vuoti | Unico `CVData` e `normalizeCvData()`; stringhe vuote e array vuoti per fatti assenti, nessun `undefined` |
| IndexedDB | Scrittura `current_cv`, lettura `cv_{id}` | Database `JobOutreachCVStorage`, store `cv_blobs`, chiave `ais_job_outreach_cv_{uid}` |
| localStorage | Chiavi globali e locali non coordinate | `ais_job_outreach_profile_{uid}` e `ais_job_outreach_cv_{uid}`; anche le altre cache sono associate all’UID |
| Backend | Record globali e identità dichiarata nel payload | Bearer ID token verificato con Firebase Admin; archivio locale separato per UID |
| Storico email | `sent_emails`, `sentEmails` e cache globale | `users/{uid}/sentEmails/{id}`; import dello storico legacy solo dallo stesso UID |
| Allegato | File originale oppure PDF generato dal profilo | Solo originale: verifica dei byte tramite hash Firestore prima della chiamata Gmail |

**Percorso esatto di persistenza**

`cvParsedData` è un **campo mappa del documento** `users/{firebaseUser.uid}`, non una sottocollezione. Percorso SDK: `doc(db, 'users', uid)`; campo: `cvParsedData`. Il database è quello già indicato da `firebase-applet-config.json` (`firestoreDatabaseId`, con `(default)` se assente).

Il binario resta nella soluzione server già prevista, ora nel contenitore del medesimo UID: `app_data.json → users[uid].cv_files[uid]`. Le versioni precedenti sono mantenute per hash, così un nuovo upload non rende inutilizzabile l’originale del profilo precedente se il successivo salvataggio fallisce. `app_data.json` è escluso dal versionamento: contiene dati runtime, non codice.

**UID effettivo**

Nel codice di produzione è esclusivamente il valore restituito da Firebase Authentication: `firebaseUser.uid`. Il backend lo ottiene da `verifyIdToken()` e respinge un UID discordante nel payload/query. Non è stato possibile leggere l’UID del vero account dell’utente da questa sessione GitHub: non viene inventato né dedotto dall’email. Nei test si usano esplicitamente identità di prova `firebase-fixture-*`; nell’emulatore delle regole `firebase-owner-a` e `firebase-owner-b`.

**File coinvolti**

- Identità e Gmail: `src/hooks/useAuth.tsx`, `src/lib/api/client.ts`, `src/lib/workspaceAuth.ts`, `src/hooks/useEmailOAuth.tsx`, `src/pages/Auth.tsx`, `src/pages/Index.tsx`, `src/pages/OAuthCallback.tsx`, `server/auth.ts`, `firestore.rules`.
- Parsing e persistenza: `server/cvParser.ts`, `server.ts`, `src/types/cv.ts`, `src/lib/cvNormalizer.ts`, `src/lib/cvRepository.ts`, `src/lib/cvStorage.ts`, `src/lib/api/ai-agent.ts`, `src/hooks/useUserProfile.tsx`, `src/lib/firebase.ts`.
- Stato e Sintesi: `src/App.tsx`, `src/contexts/CVContext.tsx`, `src/components/cv/CVUploader.tsx`, `src/components/cv/CVSummary.tsx`, `src/components/auth/AccountDetailsModal.tsx`, `src/components/layout/StepIndicator.tsx`.
- Auto Mode, invio e cache: `src/hooks/useAutoCampaign.tsx`, `src/components/auto/AutoCampaignDashboard.tsx`, `src/components/auto/ManualCompanySearch.tsx`, `src/components/email/EmailComposer.tsx`, `src/components/email/SentEmailsHistory.tsx`, `src/lib/campaignPacing.ts`, `src/lib/blacklist.ts`, i due componenti in `src/components/companies/`.
- Test e dipendenze: `tests/`, `vitest.config.ts`, `firebase.test.json`, `tsconfig.server.json`, `package.json`, `package-lock.json`, `.gitignore`.

**Risultati dei test richiesti**

I test eseguono i componenti React, il backend HTTP Express, il parser/normalizzatore applicativo, la persistenza su filesystem e IndexedDB di test. Firebase Auth, Firestore e la risposta del modello sono controllati nella suite di integrazione; le regole vengono inoltre provate separatamente con un vero emulatore Firestore. I documenti fixture sono sintetici e non vengono attribuiti al candidato.

| Test | Verifica | Esito |
| --- | --- | --- |
| 1 | Upload → endpoint parser → esperienze, istruzione e lingue → salvataggio | PASS |
| 2 | CV → Sintesi, uguaglianza completa e campi renderizzati nel DOM | PASS |
| 3 | Smontaggio/rimontaggio dell’intera app, localStorage svuotato, ripristino dal cloud di test | PASS |
| 4 | Logout, rifiuto della sola sessione locale e login con lo stesso UID | PASS |
| 5 | Nessun placeholder, anno/permesso/disponibilità inventato dal codice corretto | PASS |
| 6 | Stesso UID in Firestore, Bearer API, cache, file CV e `sentEmails`; altro UID respinto | PASS |
| 7 | “Sincronizza ora” e POST parziale/vuoto conservano il CV completo | PASS |
| 8 | Refresh conserva `cvParsedData`; il solo nome del file non abilita “CV salvato” | PASS |

La suite comprende inoltre recupero del binario una sola volta, riparazione del vecchio fallback già persistito, errori Gemini e Firestore, isolamento tra account, migrazione dello storico, migrazione tardiva contro dati nuovi e token Gmail scaduti. Il test PDF confronta il documento inviato al parser, quello salvato e il contenuto MIME dell’allegato byte per byte. Un PDF sostitutivo o l’assenza di allegato vengono bloccati prima di qualsiasi chiamata Gmail.

Comandi: `npm test`, `npm run test:rules`, `npm run lint`, `npm run build`.

Verifica finale: **19/19 test di integrazione superati**, **8 asserzioni superate nell’emulatore Firestore**, controlli TypeScript frontend/backend e build completati. La build segnala soltanto il bundle frontend superiore a 500 kB; non ci sono errori di compilazione. Anche `git diff --check` è passato.

**Limiti della verifica e attivazione**

Non sono stati eseguiti un consenso OAuth Google reale, chiamate Gemini a pagamento o invii Gmail reali. Non è stato fornito il file originale del candidato, ma soltanto screenshot. I test di ricaricamento/login della suite sono prove di integrazione controllate, non una dichiarazione di accesso riuscito all’account reale.

Per attivare il fix occorre usare il codice aggiornato e pubblicare le regole `firestore.rules` nel database configurato. Il push GitHub da solo non dimostra un aggiornamento dell’istanza Google AI Studio/Cloud Run o delle regole Firebase. La configurazione Firebase deve autorizzare il dominio dell’app; il backend deve poter verificare gli ID token del progetto. Gmail richiede un consenso separato per il medesimo account, senza modificare l’utente Firebase.

I file/storici globali privi di proprietario e quelli associati all’ID fittizio precedente non vengono automaticamente attribuiti a un nuovo UID. Se l’unica copia del CV è in tale archivio non identificabile, occorre ricaricare una volta l’originale; non viene creato un PDF sostitutivo.

Riferimenti tecnici utilizzati: [verifica degli ID token Firebase](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [scritture e merge Firestore](https://firebase.google.com/docs/firestore/manage-data/add-data), [consenso OAuth Google tramite token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).
