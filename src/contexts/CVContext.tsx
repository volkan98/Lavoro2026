import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Azienda, LogInvio } from '@/types/cv';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { userCacheKey } from '@/lib/api/client';
import { getEmptyCvData } from '@/lib/cvNormalizer';
import { loadCvBinary } from '@/lib/cvStorage';

interface CVFileState { file: File | null; uid?: string; fileName?: string; base64Data?: string; mimeType?: string; contentHash?: string }
const CVContext = createContext<ReturnType<typeof useCVState> | undefined>(undefined);
function useCVState() {
  const { user } = useAuth();
  const uid = user?.id;
  const { cvData, setCvData, binary } = useUserProfile();
  const read = <T,>(suffix: string, initial: T): T => {
    if (!uid) return initial;
    try { return JSON.parse(localStorage.getItem(userCacheKey(suffix, uid)) || 'null') ?? initial; } catch { return initial; }
  };
  const [cvFileState, setCvFileState] = useState<CVFileState>({ file: null });
  const [aziendeSelezionate, setAziendeSelezionate] = useState<Azienda[]>(() => read('aziende', []));
  const [logInvii, setLogInvii] = useState<LogInvio[]>(() => read('log_invii', []));
  const [currentStep, setCurrentStep] = useState<number>(() => read('step', 0));
  useEffect(() => {
    if (binary) {
      setCvFileState({
        file: null, uid: binary.uid, fileName: binary.filename,
        base64Data: binary.base64, mimeType: binary.mimeType, contentHash: binary.contentHash
      });
    } else if (uid) {
      void loadCvBinary(uid).then(loaded => {
        if (loaded?.base64) {
          setCvFileState(prev => prev.base64Data ? prev : {
            file: null, uid: loaded.uid, fileName: loaded.filename,
            base64Data: loaded.base64, mimeType: loaded.mimeType, contentHash: loaded.contentHash
          });
        }
      }).catch(() => {});
    }
  }, [binary, uid]);
  useEffect(() => {
    if (!uid) return;
    try {
      for (const [suffix, data] of [['aziende', aziendeSelezionate], ['log_invii', logInvii], ['step', currentStep]]) {
        localStorage.setItem(userCacheKey(suffix as string, uid), JSON.stringify(data));
      }
    } catch { /* Optional view cache. */ }
  }, [uid, aziendeSelezionate, logInvii, currentStep]);
  const setCvFile = (file: File | null) => setCvFileState(file ? { file, uid, fileName: file.name, mimeType: file.type } : { file: null });
  const addLogInvio = (log: LogInvio) => setLogInvii(previous => [log, ...previous]);
  const setSintesiBreve = (value: string) => setCvData(previous => ({ ...previous, sintesiBreve: value }));
  const setSintesiCompleta = (value: string) => setCvData(previous => ({ ...previous, sintesiCompleta: value }));
  const resetAll = () => { setCvData(getEmptyCvData()); setCvFile(null); setAziendeSelezionate([]); setCurrentStep(0); };
  return { cvData, setCvData, cvFile: cvFileState.file, setCvFile, cvFileState, setCvFileState,
    aziendeSelezionate, setAziendeSelezionate, logInvii, setLogInvii, addLogInvio, currentStep, setCurrentStep,
    sintesiBreve: cvData.sintesiBreve || '', setSintesiBreve,
    sintesiCompleta: cvData.sintesiCompleta || '', setSintesiCompleta, resetAll };
}
export function CVProvider({ children }: { children: React.ReactNode }) {
  const value = useCVState();
  return <CVContext.Provider value={value}>{children}</CVContext.Provider>;
}
export function useCVContext() {
  const value = useContext(CVContext);
  if (!value) throw new Error('useCVContext requires CVProvider');
  return value;
}
