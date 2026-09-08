import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { CVData } from '@/types/cv';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { persistCvFile, getCvFromIndexedDb } from '@/lib/cvStorage';
import { normalizeCvData } from '@/lib/cvNormalizer';

export interface UserProfile {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  cap: string | null;
  indirizzo?: string | null;
  data_nascita?: string | null;
  patente?: string | null;
  skills: string[] | null;
  profile_summary: string | null;
  permesso_g?: string | boolean | null;
  stato_permesso?: string | null;
  cv_short_summary: string | null;
  cv_full_summary: string | null;
  cv_file_path: string | null;
  target_role: string | null;
  search_radius_km: number | null;
  exclude_same_domain: boolean | null;
}

export function useUserProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [cvParsedData, setCvParsedData] = useState<CVData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const userId = user?.id || '';
  const profileStorageKey = userId ? `ais_job_outreach_profile_${userId}` : '';
  const cvStorageKey = userId ? `ais_job_outreach_cv_${userId}` : '';

  const fetchProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setCvParsedData(null);
      setIsLoading(false);
      return null;
    }

    setIsLoading(true);

    // 1. Try Firebase Firestore as primary persistent store
    try {
      const userDocRef = doc(db, 'users', userId);
      const docSnap = await getDoc(userDocRef).catch(() => null);

      if (docSnap && docSnap.exists()) {
        const docData = docSnap.data() as any;

        // Restore parsed CV structured data
        if (docData.cvParsedData) {
          const normalizedCv = normalizeCvData(docData.cvParsedData);
          setCvParsedData(normalizedCv);
          if (cvStorageKey) {
            try {
              localStorage.setItem(cvStorageKey, JSON.stringify(normalizedCv));
            } catch {}
          }
        }

        // Restore profile
        const profData: UserProfile = {
          id: docData.id || `prof_${userId}`,
          user_id: userId,
          full_name: docData.profile?.full_name || docData.full_name || null,
          email: docData.profile?.email || docData.email || user?.email || null,
          phone: docData.profile?.phone || docData.phone || docData.cvParsedData?.telefono || null,
          city: docData.profile?.city || docData.city || docData.cvParsedData?.citta || null,
          cap: docData.profile?.cap || docData.cap || docData.cvParsedData?.cap || null,
          indirizzo: docData.profile?.indirizzo || docData.indirizzo || docData.cvParsedData?.indirizzo || null,
          data_nascita: docData.profile?.data_nascita || docData.data_nascita || docData.cvParsedData?.dataNascita || null,
          patente: docData.profile?.patente || docData.patente || docData.cvParsedData?.patente || null,
          skills: docData.profile?.skills || docData.skills || docData.cvParsedData?.competenze || null,
          profile_summary: docData.profile?.profile_summary || docData.profile_summary || docData.cvParsedData?.profilo || null,
          permesso_g: docData.profile?.permesso_g || docData.permesso_g || docData.cvParsedData?.permessoG || null,
          stato_permesso: docData.profile?.stato_permesso || docData.stato_permesso || docData.cvParsedData?.statoPermesso || null,
          cv_short_summary: docData.cv_short_summary || docData.profile?.cv_short_summary || docData.cvParsedData?.sintesiBreve || null,
          cv_full_summary: docData.cv_full_summary || docData.profile?.cv_full_summary || docData.cvParsedData?.sintesiCompleta || null,
          cv_file_path: docData.cv_file_path || docData.cvMetadata?.fileName || null,
          target_role: docData.target_role || docData.profile?.target_role || docData.cvParsedData?.targetRole || null,
          search_radius_km: docData.search_radius_km ?? 35,
          exclude_same_domain: docData.exclude_same_domain ?? true,
        };

        setProfile(profData);
        if (profileStorageKey) {
          try {
            localStorage.setItem(profileStorageKey, JSON.stringify(profData));
          } catch {}
        }
        setIsLoading(false);
        return profData;
      }
    } catch (e) {
      console.warn('[Firebase] Firestore fetch profile error:', e);
    }

    // 2. Try server API
    try {
      const res = await fetch(`/api/user/profile?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.user_id === userId) {
          setProfile(json.data);
          if (json.data.cvParsedData) {
            const normalized = normalizeCvData(json.data.cvParsedData);
            setCvParsedData(normalized);
            if (cvStorageKey) {
              try {
                localStorage.setItem(cvStorageKey, JSON.stringify(normalized));
              } catch {}
            }
          }
          if (profileStorageKey) {
            try {
              localStorage.setItem(profileStorageKey, JSON.stringify(json.data));
            } catch {}
          }
          setIsLoading(false);
          return json.data;
        }
      }
    } catch {
      // ignore
    }

    // 3. Fallback to user-scoped localStorage cache
    try {
      if (cvStorageKey) {
        const cachedCv = localStorage.getItem(cvStorageKey);
        if (cachedCv) {
          const parsed = JSON.parse(cachedCv);
          setCvParsedData(normalizeCvData(parsed));
        }
      }

      if (profileStorageKey) {
        const userStored = localStorage.getItem(profileStorageKey);
        if (userStored) {
          const parsed = JSON.parse(userStored);
          setProfile(parsed);
          setIsLoading(false);
          return parsed;
        }
      }
    } catch (e) {
      console.error('Error loading stored profile:', e);
    }

    // 4. Initial clean user profile (NO fake candidate data)
    if (user?.email) {
      const initialProfile: UserProfile = {
        id: `prof_${userId}`,
        user_id: userId,
        full_name: user.user_metadata?.full_name || null,
        email: user.email,
        phone: null,
        city: user.user_metadata?.city || null,
        cap: null,
        indirizzo: null,
        data_nascita: null,
        patente: null,
        skills: null,
        profile_summary: null,
        permesso_g: null,
        stato_permesso: null,
        cv_short_summary: null,
        cv_full_summary: null,
        cv_file_path: null,
        target_role: null,
        search_radius_km: 35,
        exclude_same_domain: true,
      };
      setProfile(initialProfile);
      setIsLoading(false);
      return initialProfile;
    }

    setIsLoading(false);
    return null;
  }, [userId, user?.email, user?.user_metadata?.full_name, user?.user_metadata?.city, profileStorageKey, cvStorageKey]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const saveProfile = useCallback(
    async (cvInput: CVData, sintesiBreve: string, sintesiCompleta: string) => {
      if (!userId) {
        return { success: false, error: 'Utente non autenticato' };
      }

      setIsSaving(true);
      try {
        const normalizedCv = normalizeCvData(cvInput);
        setCvParsedData(normalizedCv);

        const fullName = `${normalizedCv.nome || ''} ${normalizedCv.cognome || ''}`.trim() || profile?.full_name || null;

        const profileData: UserProfile = {
          id: `prof_${userId}`,
          user_id: userId,
          full_name: fullName,
          email: normalizedCv.email || user?.email || profile?.email || null,
          phone: normalizedCv.telefono || profile?.phone || null,
          city: normalizedCv.citta || profile?.city || null,
          cap: normalizedCv.cap || profile?.cap || null,
          indirizzo: normalizedCv.indirizzo || profile?.indirizzo || null,
          data_nascita: normalizedCv.dataNascita || profile?.data_nascita || null,
          patente: normalizedCv.patente || profile?.patente || null,
          skills: normalizedCv.competenze && normalizedCv.competenze.length > 0 ? normalizedCv.competenze : profile?.skills || null,
          profile_summary: normalizedCv.profilo || profile?.profile_summary || null,
          permesso_g: normalizedCv.permessoG || profile?.permesso_g || null,
          stato_permesso: normalizedCv.statoPermesso || profile?.stato_permesso || null,
          cv_short_summary: sintesiBreve || profile?.cv_short_summary || null,
          cv_full_summary: sintesiCompleta || profile?.cv_full_summary || null,
          cv_file_path: profile?.cv_file_path || null,
          target_role: normalizedCv.targetRole || profile?.target_role || null,
          search_radius_km: profile?.search_radius_km || 35,
          exclude_same_domain: profile?.exclude_same_domain ?? true,
        };

        // 1. Save to user-scoped local cache
        try {
          if (profileStorageKey) {
            localStorage.setItem(profileStorageKey, JSON.stringify(profileData));
          }
          if (cvStorageKey) {
            localStorage.setItem(cvStorageKey, JSON.stringify(normalizedCv));
          }
        } catch (storageErr) {
          console.warn('[Storage] Local storage save warning:', storageErr);
        }
        setProfile(profileData);

        // 2. Primary persistence: Firebase Firestore users/{uid}
        try {
          const userDocRef = doc(db, 'users', userId);
          await setDoc(
            userDocRef,
            {
              id: userId,
              profile: profileData,
              cvParsedData: normalizedCv,
              cv_short_summary: sintesiBreve || null,
              cv_full_summary: sintesiCompleta || null,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        } catch (fbErr) {
          console.warn('[Firebase] Firestore save error:', fbErr);
        }

        // 3. Backup sync to server DB
        fetch('/api/user/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...profileData,
            cvParsedData: normalizedCv,
          }),
        }).catch(() => {});

        return { success: true, data: profileData };
      } catch (error: any) {
        console.error('Error saving profile:', error);
        return { success: false, error: error.message };
      } finally {
        setIsSaving(false);
      }
    },
    [userId, user?.email, profile, profileStorageKey, cvStorageKey]
  );

  const uploadCV = useCallback(
    async (file: File) => {
      if (!userId) return { success: false, error: 'Utente non autenticato' };

      try {
        const persisted = await persistCvFile(file, userId, cvParsedData || profile);
        const fileName = persisted.filename;
        const updated = { ...(profile || ({} as UserProfile)), cv_file_path: fileName };
        setProfile(updated as UserProfile);

        if (profileStorageKey) {
          try {
            localStorage.setItem(profileStorageKey, JSON.stringify(updated));
          } catch {}
        }

        // Firestore sync: record cvMetadata
        const userDocRef = doc(db, 'users', userId);
        setDoc(
          userDocRef,
          {
            cv_file_path: fileName,
            cvMetadata: {
              fileName,
              uploadedAt: new Date().toISOString(),
              mimeType: file.type || 'application/pdf',
            },
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        ).catch(() => {});

        return { success: true, path: fileName };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    [userId, profile, cvParsedData, profileStorageKey]
  );

  const downloadCV = useCallback(async () => {
    try {
      const stored = await getCvFromIndexedDb(`cv_${userId}`);
      if (stored && stored.base64) {
        return `data:${stored.mimeType || 'application/pdf'};base64,${stored.base64}`;
      }
      const genericStored = await getCvFromIndexedDb('current_cv');
      if (genericStored && genericStored.base64) {
        return `data:${genericStored.mimeType || 'application/pdf'};base64,${genericStored.base64}`;
      }
      const res = await fetch(`/api/cv/file?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data?.base64Data) {
          return `data:${json.data.mimeType || 'application/pdf'};base64,${json.data.base64Data}`;
        }
      }
      return null;
    } catch {
      return null;
    }
  }, [userId]);

  // Convert profile or cached cvParsedData to CVData format
  const getCVDataFromProfile = useCallback((): CVData | null => {
    if (cvParsedData && (cvParsedData.nome || cvParsedData.esperienze?.length || cvParsedData.email)) {
      return cvParsedData;
    }

    if (!profile) return null;

    const nameParts = (profile.full_name || '').split(/\s+/);
    const nome = nameParts[0] || '';
    const cognome = nameParts.slice(1).join(' ') || '';

    return normalizeCvData({
      nome,
      cognome,
      email: profile.email || '',
      telefono: profile.phone || '',
      citta: profile.city || '',
      cap: profile.cap || '',
      indirizzo: profile.indirizzo || '',
      dataNascita: profile.data_nascita || '',
      patente: profile.patente || '',
      profilo: profile.profile_summary || '',
      competenze: profile.skills || [],
      permessoG: profile.permesso_g || 'Idoneo',
      statoPermesso: profile.stato_permesso || '',
      targetRole: profile.target_role || '',
      sintesiBreve: profile.cv_short_summary || '',
      sintesiCompleta: profile.cv_full_summary || '',
      esperienze: [],
      istruzione: [],
      lingue: [],
    });
  }, [cvParsedData, profile]);

  return {
    profile,
    cvParsedData,
    isLoading,
    isSaving,
    fetchProfile,
    saveProfile,
    uploadCV,
    downloadCV,
    getCVDataFromProfile,
    hasSavedCV: !!(cvParsedData?.esperienze?.length || profile?.cv_short_summary || profile?.cv_file_path),
    hasSavedProfile: !!(profile && (profile.full_name || (profile.skills && profile.skills.length > 0))),
  };
}
