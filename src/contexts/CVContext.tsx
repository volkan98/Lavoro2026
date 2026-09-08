import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { CVData, Azienda, LogInvio } from '@/types/cv';
import { persistCvFile, getCvFromIndexedDb, formatProfessionalCvFilename } from '@/lib/cvStorage';
import { useAuth } from '@/hooks/useAuth';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { normalizeCvData, getEmptyCvData } from '@/lib/cvNormalizer';

interface CVFileState {
  file: File | null;
  fileName?: string;
  base64Data?: string;
  mimeType?: string;
}

interface CVContextType {
  cvData: Partial<CVData>;
  setCvData: React.Dispatch<React.SetStateAction<Partial<CVData>>>;
  cvFile: File | null;
  setCvFile: (file: File | null) => void;
  cvFileState: CVFileState;
  setCvFileState: React.Dispatch<React.SetStateAction<CVFileState>>;
  aziendeSelezionate: Azienda[];
  setAziendeSelezionate: React.Dispatch<React.SetStateAction<Azienda[]>>;
  logInvii: LogInvio[];
  setLogInvii: React.Dispatch<React.SetStateAction<LogInvio[]>>;
  addLogInvio: (log: LogInvio) => void;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  sintesiBreve: string;
  setSintesiBreve: (s: string) => void;
  sintesiCompleta: string;
  setSintesiCompleta: (s: string) => void;
  resetAll: () => void;
}

const CVContext = createContext<CVContextType | undefined>(undefined);

export function CVProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id || '';

  const getScopedKey = useCallback((suffix: string) => {
    return userId ? `ais_job_outreach_${suffix}_${userId}` : `ais_job_outreach_${suffix}_anon`;
  }, [userId]);

  const [cvData, setCvData] = useState<Partial<CVData>>(() => {
    return getEmptyCvData();
  });

  const [cvFileState, setCvFileState] = useState<CVFileState>({ file: null });
  const [aziendeSelezionate, setAziendeSelezionate] = useState<Azienda[]>([]);
  const [logInvii, setLogInvii] = useState<LogInvio[]>([]);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [sintesiBreve, setSintesiBreve] = useState<string>('');
  const [sintesiCompleta, setSintesiCompleta] = useState<string>('');

  // Primary loader: when user changes or on mount, restore data from Firestore & user-scoped cache
  useEffect(() => {
    if (!userId) {
      setCvData(getEmptyCvData());
      setAziendeSelezionate([]);
      setLogInvii([]);
      setCurrentStep(0);
      setSintesiBreve('');
      setSintesiCompleta('');
      setCvFileState({ file: null });
      return;
    }

    let isSubscribed = true;

    async function loadUserData() {
      // 1. First check local user-scoped cache for immediate rendering
      try {
        const cachedCv = localStorage.getItem(getScopedKey('cv'));
        if (cachedCv && isSubscribed) {
          const parsed = JSON.parse(cachedCv);
          if (parsed && (parsed.nome || parsed.esperienze?.length || parsed.email)) {
            setCvData(normalizeCvData(parsed));
          }
        }

        const cachedAziende = localStorage.getItem(getScopedKey('aziende'));
        if (cachedAziende && isSubscribed) {
          setAziendeSelezionate(JSON.parse(cachedAziende));
        }

        const cachedLogs = localStorage.getItem(getScopedKey('log_invii'));
        if (cachedLogs && isSubscribed) {
          setLogInvii(JSON.parse(cachedLogs));
        }

        const cachedStep = localStorage.getItem(getScopedKey('step'));
        if (cachedStep && isSubscribed) {
          setCurrentStep(parseInt(cachedStep, 10) || 0);
        }

        const cachedSb = localStorage.getItem(getScopedKey('sintesi_b'));
        if (cachedSb && isSubscribed) {
          setSintesiBreve(cachedSb);
        }

        const cachedSc = localStorage.getItem(getScopedKey('sintesi_c'));
        if (cachedSc && isSubscribed) {
          setSintesiCompleta(cachedSc);
        }
      } catch (e) {
        console.warn('Error reading scoped localStorage:', e);
      }

      // 2. Fetch authoritative document from Cloud Firestore: users/{uid}
      try {
        const userDocRef = doc(db, 'users', userId);
        const docSnap = await getDoc(userDocRef).catch(() => null);

        if (docSnap && docSnap.exists() && isSubscribed) {
          const data = docSnap.data();

          if (data.cvParsedData) {
            const normalized = normalizeCvData(data.cvParsedData);
            setCvData(normalized);
            localStorage.setItem(getScopedKey('cv'), JSON.stringify(normalized));
          }

          if (data.cv_short_summary || data.cvParsedData?.sintesiBreve) {
            const sb = data.cv_short_summary || data.cvParsedData?.sintesiBreve;
            setSintesiBreve(sb);
            localStorage.setItem(getScopedKey('sintesi_b'), sb);
          }

          if (data.cv_full_summary || data.cvParsedData?.sintesiCompleta) {
            const sc = data.cv_full_summary || data.cvParsedData?.sintesiCompleta;
            setSintesiCompleta(sc);
            localStorage.setItem(getScopedKey('sintesi_c'), sc);
          }

          if (data.cvMetadata) {
            setCvFileState((prev) => ({
              ...prev,
              fileName: data.cvMetadata.fileName,
              mimeType: data.cvMetadata.mimeType || 'application/pdf',
            }));
          }
        }
      } catch (fbErr) {
        console.warn('Firestore loadUserData warning:', fbErr);
      }

      // 3. Restore binary file if needed
      try {
        const idb = await getCvFromIndexedDb(`cv_${userId}`);
        if (idb && idb.base64 && isSubscribed) {
          setCvFileState((prev) => ({
            ...prev,
            fileName: idb.filename || prev.fileName || 'Curriculum_Vitae.pdf',
            base64Data: idb.base64,
            mimeType: idb.mimeType || 'application/pdf',
          }));
        } else {
          // Check server endpoint with userId
          const res = await fetch(`/api/cv/file?userId=${encodeURIComponent(userId)}`);
          if (res.ok && isSubscribed) {
            const json = await res.json();
            if (json.success && json.data?.base64Data) {
              setCvFileState((prev) => ({
                ...prev,
                fileName: json.data.fileName || prev.fileName || 'Curriculum_Vitae.pdf',
                base64Data: json.data.base64Data,
                mimeType: json.data.mimeType || 'application/pdf',
              }));
            }
          }
        }
      } catch {
        // non-blocking
      }
    }

    loadUserData();

    return () => {
      isSubscribed = false;
    };
  }, [userId, getScopedKey]);

  // Sync state changes to user-scoped local storage
  useEffect(() => {
    if (!userId) return;
    try {
      if (cvData && (cvData.nome || cvData.esperienze?.length || cvData.email)) {
        localStorage.setItem(getScopedKey('cv'), JSON.stringify(cvData));
      }
    } catch (e) {
      console.warn('Scoped localStorage save cvData error:', e);
    }
  }, [cvData, userId, getScopedKey]);

  useEffect(() => {
    if (!userId) return;
    try {
      localStorage.setItem(getScopedKey('aziende'), JSON.stringify(aziendeSelezionate));
    } catch {}
  }, [aziendeSelezionate, userId, getScopedKey]);

  useEffect(() => {
    if (!userId) return;
    try {
      localStorage.setItem(getScopedKey('log_invii'), JSON.stringify(logInvii));
    } catch {}
  }, [logInvii, userId, getScopedKey]);

  useEffect(() => {
    if (!userId) return;
    localStorage.setItem(getScopedKey('step'), currentStep.toString());
  }, [currentStep, userId, getScopedKey]);

  useEffect(() => {
    if (!userId || !sintesiBreve) return;
    localStorage.setItem(getScopedKey('sintesi_b'), sintesiBreve);
  }, [sintesiBreve, userId, getScopedKey]);

  useEffect(() => {
    if (!userId || !sintesiCompleta) return;
    localStorage.setItem(getScopedKey('sintesi_c'), sintesiCompleta);
  }, [sintesiCompleta, userId, getScopedKey]);

  const setCvFile = (file: File | null) => {
    if (!file) {
      setCvFileState({ file: null });
      if (userId) localStorage.removeItem(getScopedKey('cv_file_meta'));
      return;
    }

    const professionalName = formatProfessionalCvFilename(cvData?.nome, cvData?.cognome, file.name);

    persistCvFile(file, userId || 'current_user', cvData)
      .then((persisted) => {
        setCvFileState({
          file,
          fileName: persisted.filename,
          base64Data: persisted.base64,
          mimeType: persisted.mimeType,
        });

        // Also update cvMetadata in Firestore
        if (userId) {
          const userDocRef = doc(db, 'users', userId);
          setDoc(
            userDocRef,
            {
              cvMetadata: {
                fileName: persisted.filename,
                uploadedAt: new Date().toISOString(),
                mimeType: persisted.mimeType,
              },
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          ).catch(() => {});
        }
      })
      .catch(() => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          setCvFileState({
            file,
            fileName: professionalName,
            base64Data: base64,
            mimeType: file.type || 'application/pdf',
          });
        };
        reader.readAsDataURL(file);
      });
  };

  const addLogInvio = (log: LogInvio) => {
    setLogInvii((prev) => [log, ...prev]);

    // Also persist log to Firestore subcollection users/{uid}/sentEmails/{id}
    if (userId) {
      try {
        const logId = log.id || `log_${Date.now()}`;
        const logRef = doc(db, 'users', userId, 'sentEmails', logId);
        setDoc(logRef, {
          ...log,
          timestamp: log.dataInvio || new Date().toISOString(),
        }).catch(() => {});
      } catch {
        // non-blocking
      }
    }
  };

  const resetAll = () => {
    setCvData(getEmptyCvData());
    setCvFile(null);
    setAziendeSelezionate([]);
    setCurrentStep(0);
    setSintesiBreve('');
    setSintesiCompleta('');

    if (userId) {
      localStorage.removeItem(getScopedKey('cv'));
      localStorage.removeItem(getScopedKey('aziende'));
      localStorage.removeItem(getScopedKey('step'));
      localStorage.removeItem(getScopedKey('sintesi_b'));
      localStorage.removeItem(getScopedKey('sintesi_c'));
      localStorage.removeItem(getScopedKey('log_invii'));
      localStorage.removeItem(getScopedKey('cv_file_meta'));
    }
  };

  return (
    <CVContext.Provider
      value={{
        cvData,
        setCvData,
        cvFile: cvFileState.file,
        setCvFile,
        cvFileState,
        setCvFileState,
        aziendeSelezionate,
        setAziendeSelezionate,
        logInvii,
        setLogInvii,
        addLogInvio,
        currentStep,
        setCurrentStep,
        sintesiBreve,
        setSintesiBreve,
        sintesiCompleta,
        setSintesiCompleta,
        resetAll,
      }}
    >
      {children}
    </CVContext.Provider>
  );
}

export function useCVContext() {
  const context = useContext(CVContext);
  if (!context) {
    throw new Error('useCVContext must be used within a CVProvider');
  }
  return context;
}
