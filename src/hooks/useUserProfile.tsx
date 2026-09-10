import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './useAuth';
import type { CVData } from '@/types/cv';
import { normalizeCvData, hasCvData, getEmptyCvData } from '@/lib/cvNormalizer';
import { persistCvFile, loadCvBinary, CvBinary } from '@/lib/cvStorage';
import { readCvSnapshot, writeCvSnapshot, UserDocument, profileFromCv, cachedDocument } from '@/lib/cvRepository';
import { requireUid } from '@/lib/api/client';

export type UserProfile = ReturnType<typeof profileFromCv>;
const ProfileContext = createContext<ReturnType<typeof useProfileState> | null>(null);
function useProfileState() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.id;
  const [document, setDocument] = useState<UserDocument | null>(null);
  const [cvData, updateCvData] = useState<Partial<CVData>>(getEmptyCvData);
  const dirty = useRef(false);
  const setCvData: React.Dispatch<React.SetStateAction<Partial<CVData>>> = useCallback(value => {
    dirty.current = true;
    updateCvData(previous => normalizeCvData(typeof value === "function" ? value(previous) : value));
  }, []);
  const [binary, setBinary] = useState<CvBinary | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isSaving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [source, setSource] = useState<'cloud' | 'cache' | null>(null);
  const revision = useRef(0);
  const pendingUpload = useRef<CvBinary | undefined>(undefined);
  const current = useRef(document);
  current.current = document;
  const fetchProfile = useCallback(async (forceRecovery = false) => {
    if (!uid) { setLoading(false); return null; }
    const request = ++revision.current;
    setLoading(true); setSyncError(null);
    try {
      const result = await readCvSnapshot(uid, current.current, forceRecovery);
      requireUid(uid);
      if (request !== revision.current) return null;
      setDocument(result.document);
      if (!dirty.current) updateCvData(result.document.cvParsedData || getEmptyCvData());
      setBinary(result.binary); setSource(result.source);
      return result.document.profile as UserProfile || null;
    } catch (error: any) {
      if (request === revision.current) setSyncError(error.message || 'Sincronizzazione non riuscita');
      throw error;
    } finally { if (request === revision.current) setLoading(false); }
  }, [uid]);
  useEffect(() => {
    if (!authLoading) void fetchProfile().catch(() => {});
    return () => { revision.current++; };
  }, [authLoading, fetchProfile]);
  const saveProfile = useCallback(async (input: Partial<CVData>, brief: string, full: string, uploaded?: CvBinary) => {
    if (!uid) return { success: false, error: 'Utente non autenticato' };
    ++revision.current; setSaving(true); setLoading(false); setSyncError(null);
    try {
      const data = normalizeCvData({ ...input, sintesiBreve: brief, sintesiCompleta: full });
      uploaded = uploaded || pendingUpload.current;
      const metadata = uploaded ? { fileName: uploaded.filename, mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes, contentHash: uploaded.contentHash, uploadedAt: new Date().toISOString() } : undefined;
      const saved = await writeCvSnapshot(uid, data, metadata, true);
      requireUid(uid);
      setDocument(saved); updateCvData(saved.cvParsedData || getEmptyCvData()); dirty.current = false; if (uploaded) setBinary(uploaded); setSource('cloud'); pendingUpload.current = undefined;
      return { success: true, data: saved.profile as UserProfile };
    } catch (error: any) {
      setSyncError(error.message); return { success: false, error: error.message };
    } finally { setSaving(false); }
  }, [uid]);
  const uploadCV = useCallback(async (file: File, data?: Partial<CVData>) => {
    if (!uid) throw new Error('Utente non autenticato');
    const uploaded = await persistCvFile(file, uid, data);
    requireUid(uid);
    pendingUpload.current = uploaded;
    return uploaded;
  }, [uid]);
  const downloadCV = useCallback(async () => {
    if (!uid) return null;
    const file = await loadCvBinary(uid, current.current?.cvMetadata?.contentHash);
    return file ? `data:${file.mimeType};base64,${file.base64}` : null;
  }, [uid]);
  const cvParsedData = document?.cvParsedData || null;
  return { cvData, setCvData, profile: document?.profile as UserProfile || null, cvParsedData, document, binary,
    isLoading, isSaving, syncError, source, fetchProfile, saveProfile, uploadCV, downloadCV,
    getCVDataFromProfile: () => cvParsedData,
    hasSavedCV: !!cvParsedData && hasCvData(cvParsedData), hasSavedProfile: !!cvParsedData && hasCvData(cvParsedData) };
}
export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const value = useProfileState();
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
export function useUserProfile() {
  const value = useContext(ProfileContext);
  if (!value) throw new Error('useUserProfile requires UserProfileProvider');
  return value;
}
