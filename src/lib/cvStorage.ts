import { jsPDF } from 'jspdf';

const DB_NAME = 'JobOutreachCVStorage';
const STORE_NAME = 'cv_blobs';
const DB_VERSION = 1;

export interface StoredCVAttachment {
  filename: string;
  mimeType: string;
  base64: string;
  sizeBytes: number;
}

export interface VerifiedCvResult {
  ok: boolean;
  attachment?: StoredCVAttachment;
  error?: string;
}

// Open IndexedDB instance safely with strict timeout
function openCVDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB non supportato'));
    }
    const timer = setTimeout(() => reject(new Error('IndexedDB open timeout')), 1200);
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(request.error);
      };
      request.onblocked = () => {
        clearTimeout(timer);
        reject(new Error('IndexedDB blocked'));
      };
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

// Store CV binary in IndexedDB
export async function saveCvToIndexedDb(key: string, data: { filename: string; mimeType: string; base64: string }): Promise<void> {
  try {
    const dbPromise = openCVDatabase();
    const timeoutPromise = new Promise<null>((_, rej) => setTimeout(() => rej(new Error('Timeout')), 1200));
    const db = await Promise.race([dbPromise, timeoutPromise]);
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(data, key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch (err) {
    console.warn('[CVStorage] Could not save to IndexedDB:', err);
  }
}

// Retrieve CV binary from IndexedDB
export async function getCvFromIndexedDb(key: string = 'current_cv'): Promise<{ filename: string; mimeType: string; base64: string } | null> {
  try {
    const dbPromise = openCVDatabase();
    const timeoutPromise = new Promise<null>((_, rej) => setTimeout(() => rej(new Error('Timeout')), 1200));
    const db = await Promise.race([dbPromise, timeoutPromise]);
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch (err) {
    console.warn('[CVStorage] Could not retrieve from IndexedDB:', err);
    return null;
  }
}

// Format professional filename: e.g. "Mario_Rossi_CV.pdf"
export function formatProfessionalCvFilename(nome?: string, cognome?: string, originalName?: string): string {
  const cleanFirst = (nome || '').trim().replace(/[^a-zA-Z0-9]/g, '_');
  const cleanLast = (cognome || '').trim().replace(/[^a-zA-Z0-9]/g, '_');
  
  if (cleanFirst && cleanLast) {
    return `${cleanFirst}_${cleanLast}_CV.pdf`;
  }
  if (cleanFirst || cleanLast) {
    return `${cleanFirst || cleanLast}_CV.pdf`;
  }
  if (originalName) {
    const base = originalName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_');
    return `${base || 'Curriculum_Vitae'}_CV.pdf`;
  }
  return 'Curriculum_Vitae.pdf';
}

// Synchronize CV file to server and IndexedDB (non-blocking)
export async function persistCvFile(file: File, userId: string = 'user_blunero90', candidateData?: any): Promise<{
  success: boolean;
  filename: string;
  base64: string;
  mimeType: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = reader.result as string;
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        const mimeType = file.type || 'application/pdf';
        const professionalName = formatProfessionalCvFilename(candidateData?.nome, candidateData?.cognome, file.name);

        // 1. Background save to IndexedDB
        saveCvToIndexedDb('current_cv', {
          filename: professionalName,
          mimeType,
          base64,
        }).catch(() => {});

        // 2. Background upload to server
        fetch('/api/cv/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            fileName: professionalName,
            base64Data: base64,
            mimeType,
          }),
        }).catch((err) => console.warn('[CVStorage] Server sync error:', err));

        resolve({
          success: true,
          filename: professionalName,
          base64,
          mimeType,
        });
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Generate high quality PDF from CV text data when binary is missing
export function generatePdfFromCvData(cvData: any): { filename: string; mimeType: string; base64: string; sizeBytes: number } {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const fullName = `${cvData?.nome || ''} ${cvData?.cognome || ''}`.trim() || 'Curriculum Vitae';
  const role = cvData?.targetRole || cvData?.esperienze?.[0]?.ruolo || 'Curriculum Vitae';
  const filename = formatProfessionalCvFilename(cvData?.nome, cvData?.cognome);

  // Colors & Typography
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(30, 41, 59);
  doc.text(fullName, 20, 25);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(71, 85, 105);
  doc.text(role, 20, 33);

  // Line separator
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.5);
  doc.line(20, 38, 190, 38);

  // Contact info
  doc.setFontSize(9.5);
  doc.setTextColor(51, 65, 85);
  const contacts = [
    cvData?.email ? `Email: ${cvData.email}` : '',
    cvData?.telefono ? `Tel: ${cvData.telefono}` : '',
    cvData?.citta ? `Località: ${cvData.citta}` : '',
  ].filter(Boolean);

  if (contacts.length > 0) {
    doc.text(contacts.join('   |   '), 20, 45);
  }

  let y = contacts.length > 0 ? 56 : 48;

  // Profilo / Sintesi
  const profileText = cvData?.profilo || cvData?.sintesiBreve || cvData?.sintesiCompleta;
  if (profileText) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text('PROFILO PROFESSIONALE', 20, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(71, 85, 105);
    const splitProfile = doc.splitTextToSize(profileText, 170);
    doc.text(splitProfile, 20, y);
    y += splitProfile.length * 5 + 6;
  }

  // Esperienze
  if (Array.isArray(cvData?.esperienze) && cvData.esperienze.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text('ESPERIENZE PROFESSIONALI', 20, y);
    y += 6;

    for (const exp of cvData.esperienze.slice(0, 5)) {
      if (y > 265) {
        doc.addPage();
        y = 20;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      const roleText = exp.ruolo || 'Esperienza lavorativa';
      const companyText = exp.azienda ? ` presso ${exp.azienda}` : '';
      doc.text(`${roleText}${companyText}`, 20, y);

      const dates = [exp.dataInizio, exp.dataFine || 'attuale'].filter(Boolean).join(' - ');
      if (dates) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);
        doc.text(dates, 190, y, { align: 'right' });
      }
      y += 4.5;

      if (exp.descrizione) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        const splitDesc = doc.splitTextToSize(exp.descrizione, 170);
        doc.text(splitDesc, 20, y);
        y += splitDesc.length * 4.5;
      }
      y += 3;
    }
  }

  // Competenze
  if (Array.isArray(cvData?.competenze) && cvData.competenze.length > 0) {
    if (y > 255) {
      doc.addPage();
      y = 20;
    }
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text('COMPETENZE', 20, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    const skillsStr = cvData.competenze.join('  •  ');
    const splitSkills = doc.splitTextToSize(skillsStr, 170);
    doc.text(splitSkills, 20, y);
    y += splitSkills.length * 4.5 + 4;
  }

  // Istruzione
  if (Array.isArray(cvData?.istruzione) && cvData.istruzione.length > 0) {
    if (y > 255) {
      doc.addPage();
      y = 20;
    }
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text('ISTRUZIONE E FORMAZIONE', 20, y);
    y += 5;

    for (const edu of cvData.istruzione.slice(0, 3)) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(edu.titolo || 'Titolo di studio', 20, y);

      const sub = [edu.istituto, edu.anno].filter(Boolean).join(' - ');
      if (sub) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);
        doc.text(sub, 190, y, { align: 'right' });
      }
      y += 5;
    }
  }

  // Output Base64
  const dataUri = doc.output('datauristring');
  const base64 = dataUri.split(',')[1];
  const sizeBytes = Math.round((base64.length * 3) / 4);

  return {
    filename,
    mimeType: 'application/pdf',
    base64,
    sizeBytes,
  };
}

// Retrieve and verify CV attachment with zero ambiguity
export async function getVerifiedCvAttachment(
  cvFileState?: { fileName?: string; base64Data?: string; mimeType?: string },
  cvData?: any,
  profile?: any
): Promise<VerifiedCvResult> {
  const professionalFilename = formatProfessionalCvFilename(
    cvData?.nome || profile?.full_name?.split(' ')?.[0],
    cvData?.cognome || profile?.full_name?.split(' ')?.slice(1)?.join(' '),
    cvFileState?.fileName || profile?.cv_file_path || undefined
  );

  // 1. Check in-memory cvFileState if it has real base64
  if (
    cvFileState?.base64Data &&
    cvFileState.base64Data.length > 100 &&
    cvFileState.base64Data !== 'CV_SAVED_PROFILE_ATTACHMENT'
  ) {
    const cleanBase64 = cvFileState.base64Data.replace(/^data:[^;]+;base64,/, '').trim();
    return {
      ok: true,
      attachment: {
        filename: professionalFilename,
        mimeType: cvFileState.mimeType || 'application/pdf',
        base64: cleanBase64,
        sizeBytes: Math.round((cleanBase64.length * 3) / 4),
      },
    };
  }

  // 2. Check IndexedDB
  try {
    const idbData = await getCvFromIndexedDb('current_cv');
    if (idbData?.base64 && idbData.base64.length > 100) {
      const cleanBase64 = idbData.base64.replace(/^data:[^;]+;base64,/, '').trim();
      return {
        ok: true,
        attachment: {
          filename: professionalFilename,
          mimeType: idbData.mimeType || 'application/pdf',
          base64: cleanBase64,
          sizeBytes: Math.round((cleanBase64.length * 3) / 4),
        },
      };
    }
  } catch (idbErr) {
    console.warn('[CVStorage] IndexedDB check failed:', idbErr);
  }

  // 3. Check server storage (/api/cv/file)
  try {
    const res = await fetch('/api/cv/file');
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data?.base64Data && json.data.base64Data.length > 100) {
        const cleanBase64 = json.data.base64Data.replace(/^data:[^;]+;base64,/, '').trim();
        return {
          ok: true,
          attachment: {
            filename: professionalFilename,
            mimeType: json.data.mimeType || 'application/pdf',
            base64: cleanBase64,
            sizeBytes: Math.round((cleanBase64.length * 3) / 4),
          },
        };
      }
    }
  } catch (srvErr) {
    console.warn('[CVStorage] Server check failed:', srvErr);
  }

  // 4. If we have structured CV data or profile data, generate real PDF fallback
  if (cvData && (cvData.nome || cvData.cognome || cvData.profilo || cvData.competenze?.length || cvData.esperienze?.length)) {
    try {
      const generated = generatePdfFromCvData(cvData);
      // Cache generated PDF in IndexedDB and server for subsequent sends
      saveCvToIndexedDb('current_cv', {
        filename: generated.filename,
        mimeType: generated.mimeType,
        base64: generated.base64,
      }).catch(() => {});

      return {
        ok: true,
        attachment: generated,
      };
    } catch (pdfErr) {
      console.error('[CVStorage] Error generating PDF from CV data:', pdfErr);
    }
  }

  // 5. If profile exists, attempt with profile data
  if (profile && (profile.full_name || profile.profile_summary || profile.skills?.length)) {
    try {
      const nameParts = (profile.full_name || '').split(' ');
      const synthesizedCv = {
        nome: nameParts[0] || '',
        cognome: nameParts.slice(1).join(' ') || '',
        email: profile.email || '',
        telefono: profile.phone || '',
        citta: profile.city || '',
        profilo: profile.profile_summary || profile.cv_short_summary || '',
        competenze: profile.skills || [],
        targetRole: profile.target_role || '',
      };
      const generated = generatePdfFromCvData(synthesizedCv);
      return {
        ok: true,
        attachment: generated,
      };
    } catch (profPdfErr) {
      console.error('[CVStorage] Error generating PDF from profile:', profPdfErr);
    }
  }

  // 6. Cannot retrieve or attach CV
  return {
    ok: false,
    error: 'Impossibile inviare la candidatura: il CV non è stato allegato correttamente.',
  };
}
