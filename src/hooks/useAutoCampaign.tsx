import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { aiAgent, Company } from '@/lib/api/ai-agent';
import { useCVContext } from '@/contexts/CVContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { isEmailBlacklisted, BlacklistEntry, STORAGE_KEY_BLACKLIST } from '@/lib/blacklist';
import { sendViaGmailApi } from '@/lib/workspaceAuth';
import { getVerifiedCvAttachment } from '@/lib/cvStorage';
import {
  PACING_CONSTANTS,
  PacingState,
  PauseType,
  loadPacingState,
  savePacingState,
  checkCanSendNow,
  recordSendSuccess,
  recordSendError,
  generateVariedEmail,
  isGmailFatalOrSuspiciousError,
  getTodayDateString,
  cleanHourlyTimestamps,
} from '@/lib/campaignPacing';

export interface Campaign {
  id: string;
  status: string; // 'running' | 'paused' | 'stopped' | 'completed'
  search_location: string;
  search_radius: number;
  search_keywords: string[];
  only_selected_city: boolean;
  target_total: number;
  email_style: string;
  include_risky: boolean;
  cv_file_path: string | null;
  total_found: number;
  total_sent: number;
  total_failed: number;
  total_generated: number;
  total_skipped: number;
  current_search_cycle: number;
  max_search_cycles: number;
  pause_reason: string | null;
  resume_at: string | null;
  next_send_at?: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;

  // Anti-spam gradual pacing fields
  daily_date?: string;
  daily_sent_count?: number;
  gmail_error?: string | null;
  active_pause_type?: PauseType;
  hourly_sent_count?: number;
}

export interface CampaignEvent {
  id: string;
  campaign_id?: string;
  event_type: string;
  message: string;
  metadata?: any;
  created_at: string;
}

export interface QueueItem {
  id: string;
  campaign_id?: string;
  user_id?: string;
  company_name: string;
  company_email: string;
  company_city: string | null;
  company_sector: string | null;
  company_website?: string | null;
  status: string; // 'pending' | 'email_generated' | 'sent' | 'failed' | 'discarded'
  confidence_score: number;
  error_message?: string | null;
  sent_at?: string | null;
  created_at: string;
}

export interface CampaignSetupData {
  search_location: string;
  search_location_query?: string;
  search_radius: number;
  search_keywords: string[];
  only_selected_city: boolean;
  target_total: number;
  email_style: string;
  include_risky: boolean;
  user_city?: string;
  cv_file_path?: string;
  search_mode?: 'standard' | 'swiss_painting';
}

const LOCAL_STORAGE_CAMPAIGN_KEY = 'ais_job_outreach_campaign';
const LOCAL_STORAGE_EVENTS_KEY = 'ais_job_outreach_campaign_events';
const LOCAL_STORAGE_QUEUE_KEY = 'ais_job_outreach_campaign_queue';

export function useAutoCampaign() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { cvData, sintesiBreve, cvFileState, addLogInvio } = useCVContext();
  const { profile } = useUserProfile();

  const userId = user?.id || 'user_blunero90';

  // Synchronous cache hydration
  const [campaign, setCampaign] = useState<Campaign | null>(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_CAMPAIGN_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object' && parsed.id) return parsed;
      }
    } catch {
      // ignore
    }
    return null;
  });

  const [events, setEvents] = useState<CampaignEvent[]>(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_EVENTS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [queueItems, setQueueItems] = useState<QueueItem[]>(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_QUEUE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [pacingState, setPacingState] = useState<PacingState>(() => loadPacingState(userId));

  // Sync pacing state to storage whenever it updates
  useEffect(() => {
    savePacingState(pacingState, userId);
  }, [pacingState, userId]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const isRunningStepRef = useRef<boolean>(false);
  const processorTriggerRef = useRef<number>(0);

  // Helper to clear Gmail error and allow resume
  const clearGmailError = useCallback(() => {
    setPacingState((prev) => {
      const updated: PacingState = {
        ...prev,
        gmailError: null,
        pauseType: 'none',
        pauseReason: null,
        nextScheduledSendAt: 0,
      };
      savePacingState(updated, userId);
      return updated;
    });

    if (campaign) {
      updateCampaignState({
        status: 'paused',
        pause_reason: null,
        gmail_error: null,
        resume_at: null,
      });
    }

    toast({
      title: '✅ Errore Gmail azzerato',
      description: 'Puoi ora riprendere la campagna con il pulsante "Riprendi".',
    });
  }, [campaign, userId, toast]);

  // Helper to add an event
  const logEvent = useCallback((eventType: string, message: string, metadata?: any) => {
    const newEvt: CampaignEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      campaign_id: campaign?.id || 'current',
      event_type: eventType,
      message,
      metadata,
      created_at: new Date().toISOString(),
    };
    setEvents((prev) => {
      const updated = [newEvt, ...prev].slice(0, 100);
      try {
        localStorage.setItem(LOCAL_STORAGE_EVENTS_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, [campaign?.id]);

  // Fetch active campaign & queue from server/Firestore with strict timeouts
  const fetchCampaign = useCallback(async () => {
    try {
      // 1. Check Server first (fastest local endpoint)
      try {
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), 2000);
        const res = await fetch('/api/campaigns', { signal: ctrl.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const json = await res.json();
          if (json?.data) {
            setCampaign(json.data);
            try {
              localStorage.setItem(LOCAL_STORAGE_CAMPAIGN_KEY, JSON.stringify(json.data));
            } catch {}
          }
          if (Array.isArray(json?.events) && json.events.length > 0) {
            setEvents(json.events);
            try {
              localStorage.setItem(LOCAL_STORAGE_EVENTS_KEY, JSON.stringify(json.events));
            } catch {}
          }
        }
      } catch (err) {
        // server request failed or timed out, will try fallback
      }

      // 2. Check Queue from Server
      try {
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), 2000);
        const qRes = await fetch('/api/campaign-queue', { signal: ctrl.signal });
        clearTimeout(timeoutId);

        if (qRes.ok) {
          const qJson = await qRes.json();
          if (Array.isArray(qJson?.data)) {
            setQueueItems(qJson.data);
            try {
              localStorage.setItem(LOCAL_STORAGE_QUEUE_KEY, JSON.stringify(qJson.data));
            } catch {}
          }
        }
      } catch {}

      // 3. Fallback to Firestore with 1000ms timeout race
      try {
        const campDocRef = doc(db, 'users', userId, 'campaigns', 'current');
        const fetchPromise = getDoc(campDocRef).catch(() => null);
        const timeoutPromise = new Promise<null>((res) => setTimeout(() => res(null), 1000));
        const campSnap = await Promise.race([fetchPromise, timeoutPromise]);

        if (campSnap && campSnap.exists()) {
          const campData = campSnap.data() as Campaign;
          setCampaign((prev) => prev || campData);
          try {
            localStorage.setItem(LOCAL_STORAGE_CAMPAIGN_KEY, JSON.stringify(campData));
          } catch {}
        }
      } catch (e) {
        console.warn('[AutoCampaign] Firestore read error:', e);
      }
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Initial load
  useEffect(() => {
    fetchCampaign();
    // Safety watchdog: ensure loading is cleared after 1000ms max
    const timer = setTimeout(() => setIsLoading(false), 1000);
    return () => clearTimeout(timer);
  }, [fetchCampaign]);

  // Listen for external queue additions (from ManualCompanySearch or other tabs)
  useEffect(() => {
    const handleQueueUpdate = () => {
      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_QUEUE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) setQueueItems(parsed);
        }
      } catch {}
    };

    window.addEventListener('campaign_queue_updated', handleQueueUpdate);
    window.addEventListener('storage', handleQueueUpdate);
    return () => {
      window.removeEventListener('campaign_queue_updated', handleQueueUpdate);
      window.removeEventListener('storage', handleQueueUpdate);
    };
  }, []);

  // Update a queue item
  const updateQueueItem = useCallback((id: string, updates: Partial<QueueItem>) => {
    setQueueItems((prev) => {
      const updated = prev.map((item) => (item.id === id ? { ...item, ...updates } : item));
      try {
        localStorage.setItem(LOCAL_STORAGE_QUEUE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });

    // Sync with server
    fetch(`/api/campaign-queue/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }).catch(() => {});
  }, []);

  // Update campaign state helper
  const updateCampaignState = useCallback((updates: Partial<Campaign>, eventMsg?: string) => {
    setCampaign((prev) => {
      if (!prev) return null;
      const updated = {
        ...prev,
        ...updates,
        updated_at: new Date().toISOString(),
      };
      try {
        localStorage.setItem(LOCAL_STORAGE_CAMPAIGN_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });

    // Sync with server
    if (campaign?.id) {
      fetch(`/api/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }).catch(() => {});
    }

    // Sync with Firestore (non-blocking)
    try {
      const campDocRef = doc(db, 'users', userId, 'campaigns', 'current');
      setDoc(campDocRef, updates, { merge: true }).catch(() => {});
    } catch {}

    if (eventMsg) {
      logEvent('info', eventMsg);
    }
  }, [campaign?.id, userId, logEvent]);

  // Start campaign
  const startCampaign = async (setup: CampaignSetupData) => {
    const today = getTodayDateString();
    const effectiveDailyCount = pacingState.dailyDate === today ? pacingState.dailySentCount : 0;

    const newCamp: Campaign = {
      id: `camp_${Date.now()}`,
      status: 'running',
      search_location: setup.search_location,
      search_radius: setup.search_radius,
      search_keywords: setup.search_keywords,
      only_selected_city: setup.only_selected_city,
      target_total: setup.target_total || 50,
      email_style: setup.email_style,
      include_risky: setup.include_risky,
      cv_file_path: setup.cv_file_path || null,
      total_found: 0,
      total_sent: 0,
      total_failed: 0,
      total_generated: 0,
      total_skipped: 0,
      current_search_cycle: 1,
      max_search_cycles: setup.search_mode === 'swiss_painting' ? 20 : 5,
      pause_reason: null,
      resume_at: null,
      started_at: new Date().toISOString(),
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      daily_date: today,
      daily_sent_count: effectiveDailyCount,
      active_pause_type: 'none',
      hourly_sent_count: cleanHourlyTimestamps(pacingState.hourlySentTimestamps).length,
    };

    const newEvent: CampaignEvent = {
      id: `evt_${Date.now()}`,
      campaign_id: newCamp.id,
      event_type: 'start',
      message: `🚀 Auto Campaign avviata con Google Gemini per ${setup.search_location} (Pacing naturale antispam: max 50/giorno, max 8/h)`,
      metadata: { setup },
      created_at: new Date().toISOString(),
    };

    setCampaign(newCamp);
    setEvents([newEvent]);
    setQueueItems([]);

    try {
      localStorage.setItem(LOCAL_STORAGE_CAMPAIGN_KEY, JSON.stringify(newCamp));
      localStorage.setItem(LOCAL_STORAGE_EVENTS_KEY, JSON.stringify([newEvent]));
      localStorage.setItem(LOCAL_STORAGE_QUEUE_KEY, JSON.stringify([]));
    } catch {}

    // Firestore sync
    try {
      const campDocRef = doc(db, 'users', userId, 'campaigns', 'current');
      setDoc(campDocRef, newCamp).catch(() => {});
    } catch {}

    // Server sync
    fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCamp),
    }).catch(console.error);

    toast({
      title: '🚀 Auto Mode avviato!',
      description: `Invio graduale attivato per ${setup.search_location} (max 50/giorno).`,
    });

    // Trigger runner immediately
    processorTriggerRef.current += 1;
  };

  const pauseCampaign = async () => {
    if (!campaign) return;
    updateCampaignState({ status: 'paused', pause_reason: 'Pausa manuale utente' });
    logEvent('pause', '⏸️ Campagna messa in pausa manualmente');
    toast({ title: 'Campagna in pausa' });
  };

  const resumeCampaign = async () => {
    if (!campaign) return;

    // Check if stopped due to fatal Gmail error
    if (pacingState.gmailError) {
      toast({
        title: '⚠️ Errore Gmail attivo',
        description: 'Riconnetti l\'account Gmail o clicca "Azzera Errore" prima di riprendere la campagna.',
        variant: 'destructive',
      });
      return;
    }

    // Check if daily limit reached
    const today = getTodayDateString();
    if (pacingState.dailyDate === today && pacingState.dailySentCount >= PACING_CONSTANTS.DAILY_MAX_SENDS) {
      toast({
        title: '🛑 Limite giornaliero raggiunto (50/50)',
        description: 'Per proteggere il tuo account Gmail dallo spam, gli invii riprenderanno automaticamente domani.',
      });
      return;
    }

    updateCampaignState({ status: 'running', pause_reason: null });
    logEvent('resume', '▶️ Auto Mode ripreso');
    toast({ title: '▶️ Auto Mode ripreso!' });
    processorTriggerRef.current += 1;
  };

  const stopCampaign = async () => {
    if (!campaign) return;
    updateCampaignState({ status: 'stopped', completed_at: new Date().toISOString() });
    logEvent('stop', '⏹️ Campagna terminata definitivamente');
    toast({ title: '⏹️ Campagna fermata' });
  };

  const resetCampaign = async () => {
    setCampaign(null);
    setEvents([]);
    setQueueItems([]);
    try {
      localStorage.removeItem(LOCAL_STORAGE_CAMPAIGN_KEY);
      localStorage.removeItem(LOCAL_STORAGE_EVENTS_KEY);
      localStorage.removeItem(LOCAL_STORAGE_QUEUE_KEY);
    } catch {}

    fetch('/api/campaigns', { method: 'DELETE' }).catch(() => {});

    try {
      const campDocRef = doc(db, 'users', userId, 'campaigns', 'current');
      setDoc(campDocRef, { status: 'stopped', reset_at: new Date().toISOString() }).catch(() => {});
    } catch {}

    toast({ title: 'Campagna azzerata', description: 'Pronto per impostare una nuova campagna.' });
  };

  const triggerProcessor = useCallback(() => {
    processorTriggerRef.current += 1;
    toast({
      title: '⚡ Elaborazione forzata',
      description: 'Verifica della coda ed esecuzione nel rispetto delle regole antispam.',
    });
  }, [toast]);

  // =========================================================================
  // CORE ENGINE: Auto Search & Send Loop with Strict Anti-Spam Pacing
  // =========================================================================
  useEffect(() => {
    if (!campaign || campaign.status !== 'running') {
      return;
    }

    let isMounted = true;

    const executeCycle = async () => {
      if (isRunningStepRef.current) return;
      isRunningStepRef.current = true;

      try {
        // -------------------------------------------------------------------
        // 0. CHECK STRICT PACING RULES BEFORE ANY SEND ACTION
        // -------------------------------------------------------------------
        const canSend = checkCanSendNow(pacingState);

        if (!canSend.allowed) {
          // If Gmail fatal error, stop immediately!
          if (canSend.pauseType === 'gmail_error') {
            updateCampaignState({
              status: 'paused',
              pause_reason: canSend.reason || 'Interrotto per errore critico Gmail',
              gmail_error: pacingState.gmailError,
            });
            return;
          }

          // If daily limit reached (50/50), pause until tomorrow
          if (canSend.pauseType === 'daily_limit') {
            const nextDayDate = canSend.waitMs ? new Date(Date.now() + canSend.waitMs).toISOString() : null;
            if (campaign.pause_reason !== canSend.reason) {
              updateCampaignState({
                status: 'paused',
                pause_reason: canSend.reason || 'Limite giornaliero di 50 candidature raggiunto. Invii sospesi fino a domani.',
                resume_at: nextDayDate,
              });
              logEvent(
                'daily_limit',
                `🛑 Limite giornaliero di 50 candidature raggiunto oggi (${pacingState.dailySentCount}/50). Invii interrotti fino a domani per preservare la reputazione dell'account.`
              );
            }
            return;
          }

          // If in natural interval (6-12m), block pause (20-40m), hourly limit (8/h), or temp error (30m)
          const resumeIso = canSend.waitMs ? new Date(Date.now() + canSend.waitMs).toISOString() : null;
          if (campaign.pause_reason !== canSend.reason || campaign.resume_at !== resumeIso) {
            updateCampaignState({
              pause_reason: canSend.reason || null,
              resume_at: resumeIso,
              active_pause_type: canSend.pauseType,
            });
          }
          // Strict rule: do not proceed to send until interval/pause completes!
          return;
        }

        // Check if queue has pending or generated items
        const pendingOrGenerated = queueItems.filter(
          (q) => q.status === 'pending' || q.status === 'email_generated'
        );

        // -------------------------------------------------------------------
        // 1. AUTO SEARCH PHASE: If queue has no items, search for new targets
        // -------------------------------------------------------------------
        if (
          pendingOrGenerated.length === 0 &&
          campaign.total_sent < campaign.target_total &&
          campaign.current_search_cycle <= campaign.max_search_cycles
        ) {
          logEvent(
            'search_started',
            `🔍 Ricerca aziende con Google Gemini per ${campaign.search_location} (Ciclo ${campaign.current_search_cycle}/${campaign.max_search_cycles})...`
          );

          let currentBlacklist: BlacklistEntry[] = [];
          try {
            const rawBl = localStorage.getItem(STORAGE_KEY_BLACKLIST);
            if (rawBl) currentBlacklist = JSON.parse(rawBl);
          } catch {}

          const searchResult = await aiAgent.searchCompanies(
            campaign.search_location || 'Lugano, Canton Ticino',
            campaign.search_radius || 30,
            campaign.search_keywords || ['produzione', 'verniciatura', 'metalmeccanica'],
            cvData?.competenze,
            cvData?.profilo,
            25,
            cvData?.citta || campaign.search_location,
            campaign.only_selected_city
          );

          if (!isMounted) return;

          if (searchResult.success && Array.isArray(searchResult.data) && searchResult.data.length > 0) {
            const existingEmails = new Set(queueItems.map((q) => q.company_email.toLowerCase()));

            const newValidItems: QueueItem[] = [];
            for (const c of searchResult.data) {
              if (!c.email) continue;
              const em = c.email.trim().toLowerCase();
              if (existingEmails.has(em)) continue;

              // Check blacklist
              const blCheck = isEmailBlacklisted(em, currentBlacklist);
              if (blCheck.isBlacklisted) continue;

              // Check sent duplicate
              const dupCheck = await aiAgent.checkDuplicate(em, c.name, true);
              if (dupCheck.isDuplicate) continue;

              existingEmails.add(em);
              newValidItems.push({
                id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                campaign_id: campaign.id,
                user_id: userId,
                company_name: c.name,
                company_email: em,
                company_city: c.city || null,
                company_sector: c.sector || null,
                company_website: c.website || null,
                status: 'pending',
                confidence_score: c.confidence_score || 85,
                created_at: new Date().toISOString(),
              });
            }

            if (newValidItems.length > 0) {
              const updatedQueue = [...queueItems, ...newValidItems];
              setQueueItems(updatedQueue);
              try {
                localStorage.setItem(LOCAL_STORAGE_QUEUE_KEY, JSON.stringify(updatedQueue));
              } catch {}

              fetch('/api/campaign-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newValidItems),
              }).catch(() => {});

              updateCampaignState({
                total_found: updatedQueue.length,
                current_search_cycle: campaign.current_search_cycle + 1,
              });

              logEvent(
                'search_completed',
                `✅ Trovate ${newValidItems.length} nuove aziende verificate con email. Aggiunte alla coda.`
              );
              isRunningStepRef.current = false;
              return;
            } else {
              logEvent(
                'search_empty',
                `Nessuna nuova azienda non contattata trovata nel ciclo ${campaign.current_search_cycle}. Incremento ciclo.`
              );
              updateCampaignState({
                current_search_cycle: campaign.current_search_cycle + 1,
              });
            }
          } else {
            logEvent(
              'search_error',
              `⚠️ Ricerca non ha restituito aziende idonee. Riprovo nel prossimo ciclo.`
            );
            updateCampaignState({
              current_search_cycle: campaign.current_search_cycle + 1,
            });
          }
        }

        // -------------------------------------------------------------------
        // 2. AUTO CANDIDACY SEND PHASE
        // -------------------------------------------------------------------
        const nextItem = queueItems.find(
          (q) => q.status === 'pending' || q.status === 'email_generated'
        );

        if (nextItem && campaign.total_sent < campaign.target_total) {
          // Rule: Check blacklist again before sending
          let currentBlacklist: BlacklistEntry[] = [];
          try {
            const rawBl = localStorage.getItem(STORAGE_KEY_BLACKLIST);
            if (rawBl) currentBlacklist = JSON.parse(rawBl);
          } catch {}

          const blCheck = isEmailBlacklisted(nextItem.company_email, currentBlacklist);
          if (blCheck.isBlacklisted) {
            logEvent('email_skipped', `⚠️ Azienda ${nextItem.company_name} (${nextItem.company_email}) scartata: presente nella Blacklist`);
            updateQueueItem(nextItem.id, { status: 'discarded', error_message: 'Blacklisted' });
            updateCampaignState({ total_skipped: (campaign.total_skipped || 0) + 1 });
            return;
          }

          // Rule: Check duplicate again
          const dupCheck = await aiAgent.checkDuplicate(nextItem.company_email, nextItem.company_name, true);
          if (dupCheck.isDuplicate) {
            logEvent('email_skipped', `⚠️ Azienda ${nextItem.company_name} (${nextItem.company_email}) scartata: già contattata in precedenza`);
            updateQueueItem(nextItem.id, { status: 'discarded', error_message: 'Già contattata' });
            updateCampaignState({ total_skipped: (campaign.total_skipped || 0) + 1 });
            return;
          }

          // Rule: Strict CV PDF attachment check
          let attachment: { filename: string; mimeType: string; base64: string } | undefined;
          try {
            const verifiedCv = await getVerifiedCvAttachment(cvFileState, cvData, profile);
            if (verifiedCv.ok && verifiedCv.attachment?.base64 && verifiedCv.attachment.base64.length > 50) {
              attachment = {
                filename: verifiedCv.attachment.filename || cvFileState?.fileName || 'Curriculum_Vitae.pdf',
                mimeType: verifiedCv.attachment.mimeType || 'application/pdf',
                base64: verifiedCv.attachment.base64,
              };
            }
          } catch (cvErr) {
            console.warn('[AutoCampaign] Errore verifica CV attachment:', cvErr);
          }

          if (!attachment || !attachment.base64 || attachment.base64.length < 50) {
            const errMsg = "Invio bloccato: nessun file CV in formato PDF valido rilevato. L'allegato CV è obbligatorio in Auto Mode.";
            logEvent('error', `❌ ${errMsg}`);
            updateQueueItem(nextItem.id, { status: 'failed', error_message: errMsg });
            updateCampaignState({
              status: 'paused',
              pause_reason: 'CV PDF mancante. Carica il tuo CV per riprendere gli invii automatici.',
            });
            toast({
              title: '⚠️ CV PDF Mancante',
              description: 'Auto Mode in pausa: carica o verifica il tuo CV in PDF.',
              variant: 'destructive',
            });
            return;
          }

          logEvent(
            'email_generating',
            `📝 Generazione candidatura personalizzata per ${nextItem.company_name}...`
          );

          const candidateName = cvData?.nome
            ? `${cvData.nome} ${cvData?.cognome || ''}`.trim()
            : profile?.full_name || 'Candidato';

          // Try AI generation
          let subject = '';
          let bodyText = '';

          try {
            const targetCompany: Company = {
              id: nextItem.id,
              name: nextItem.company_name,
              email: nextItem.company_email,
              city: nextItem.company_city || campaign.search_location || 'Ticino',
              sector: nextItem.company_sector || 'Produzione / Settore Tecnico',
              website: nextItem.company_website || undefined,
            };

            const styleVariant = (['breve', 'standard', 'formale'].includes(campaign.email_style)
              ? campaign.email_style
              : 'standard') as 'breve' | 'standard' | 'formale';

            const emailRes = await aiAgent.generateEmail(
              targetCompany,
              cvData || {},
              styleVariant,
              undefined,
              'immediata'
            );

            if (emailRes.success && emailRes.data) {
              subject = emailRes.data.oggetto || '';
              bodyText = emailRes.data.corpo || '';
            }
          } catch (genErr) {
            console.warn('[AutoCampaign] Generazione AI fallback a template variato:', genErr);
          }

          // Guarantee non-identical subject and body variations for anti-spam safety
          const seedIndex = campaign.total_sent + Math.floor(Math.random() * 10);
          const varied = generateVariedEmail({
            candidateName,
            companyName: nextItem.company_name,
            companyCity: nextItem.company_city,
            companySector: nextItem.company_sector,
            skills: cvData?.competenze,
            style: campaign.email_style,
            seedIndex,
          });

          subject = subject || varied.subject;
          bodyText = bodyText || varied.bodyText;

          updateQueueItem(nextItem.id, { status: 'email_generated' });
          logEvent('email_ready', `✉️ Email personalizzata pronta con allegato ${attachment.filename}. Invio a ${nextItem.company_email}...`);

          // Attempt send
          let sendSuccess = false;
          let sendError: string | null = null;

          try {
            // 1. Try Gmail API directly (non-interactive in automode)
            const gmailRes = await sendViaGmailApi(
              {
                to: nextItem.company_email,
                subject,
                bodyHtml: bodyText.replace(/\n/g, '<br/>'),
                attachment,
              },
              { interactive: false }
            );

            if (gmailRes.success) {
              sendSuccess = true;
              logEvent('gmail_api', `✅ Candidatura inviata via Gmail API con allegato CV PDF (${attachment.filename}) a ${nextItem.company_name}`);
            } else {
              // 2. Server email proxy fallback
              const serverRes = await fetch('/api/email-oauth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'send_email',
                  provider: 'gmail',
                  email_data: {
                    to: nextItem.company_email,
                    subject,
                    body: bodyText,
                    companyName: nextItem.company_name,
                    cv_filename: attachment.filename,
                    cv_base64: attachment.base64,
                    cv_mimetype: attachment.mimeType,
                    attachment: attachment,
                    attachment_data: attachment,
                    userId,
                  },
                }),
              });
              const serverJson = await serverRes.json();
              if (serverJson.success) {
                sendSuccess = true;
                logEvent('server_send', `✅ Candidatura inviata con allegato CV PDF (${attachment.filename}) a ${nextItem.company_name}`);
              } else {
                sendError = serverJson.error || gmailRes.error || 'Invio non riuscito';
              }
            }
          } catch (e: any) {
            sendError = e.message || 'Errore di connessione durante l\'invio';
          }

          if (sendSuccess) {
            const now = Date.now();
            const { updatedState, nextIntervalMs, isBlockPause, isDailyLimitReached } = recordSendSuccess(pacingState, now);
            setPacingState(updatedState);
            savePacingState(updatedState, userId);

            const nextSendIso = new Date(now + nextIntervalMs).toISOString();

            updateQueueItem(nextItem.id, { status: 'sent', sent_at: new Date(now).toISOString() });

            const newTotalSent = campaign.total_sent + 1;
            const newTotalGen = (campaign.total_generated || 0) + 1;

            updateCampaignState({
              total_sent: newTotalSent,
              total_generated: newTotalGen,
              daily_sent_count: updatedState.dailySentCount,
              daily_date: updatedState.dailyDate,
              pause_reason: updatedState.pauseReason,
              resume_at: nextSendIso,
              status: isDailyLimitReached ? 'paused' : 'running',
              active_pause_type: updatedState.pauseType,
              hourly_sent_count: cleanHourlyTimestamps(updatedState.hourlySentTimestamps).length,
            });

            if (isDailyLimitReached) {
              logEvent(
                'daily_limit',
                `🛑 Limite massimo di 50 invii raggiunto per oggi (50/50). Auto Mode interrotto fino a domani per proteggere l'account Gmail.`
              );
              toast({
                title: '🛑 Limite Giornaliero Raggiunto (50/50)',
                description: 'Candidature completate per oggi. L\'invio riprenderà automaticamente domani.',
              });
            } else if (isBlockPause) {
              const pauseMin = Math.round(nextIntervalMs / 60000);
              logEvent(
                'block_pause',
                `⏸️ Pausa di sicurezza: inviato blocco di ${pacingState.currentBlockTarget} candidature. Pausa programmata di ${pauseMin} minuti per evitare filtri antispam.`
              );
            } else {
              const nextMin = (nextIntervalMs / 60000).toFixed(1);
              logEvent(
                'email_sent',
                `✉️ Inviata a ${nextItem.company_name}. Intervallo naturale casuale: prossimo invio tra ~${nextMin} min.`
              );
            }

            aiAgent.recordSentEmail(
              nextItem.id,
              nextItem.company_name,
              nextItem.company_email,
              subject,
              bodyText,
              attachment.filename,
              userId
            );

            if (addLogInvio) {
              addLogInvio({
                id: `log_${Date.now()}`,
                aziendaId: nextItem.id,
                nomeAzienda: nextItem.company_name,
                email: nextItem.company_email,
                dataInvio: new Date().toLocaleDateString('it-IT'),
                oraInvio: new Date().toLocaleTimeString('it-IT'),
                stato: 'inviata',
                oggetto: subject,
                allegati: [attachment.filename],
              });
            }

            if (newTotalSent >= campaign.target_total) {
              updateCampaignState({
                status: 'completed',
                completed_at: new Date().toISOString(),
              });
              logEvent('target_completed', `🎯 Obiettivo raggiunto! Completate tutte le ${newTotalSent} candidature.`);
              toast({
                title: '🎯 Obiettivo Raggiunto!',
                description: `Completate tutte le ${newTotalSent} candidature previste.`,
              });
            }
          } else {
            // Handle send error with anti-spam pacing rules
            const now = Date.now();
            const { updatedState, isFatalGmail, waitMs, reason } = recordSendError(pacingState, sendError || 'Errore fornitore email', now);
            setPacingState(updatedState);
            savePacingState(updatedState, userId);

            updateQueueItem(nextItem.id, {
              status: 'failed',
              error_message: sendError,
            });

            updateCampaignState({
              total_failed: (campaign.total_failed || 0) + 1,
              pause_reason: reason,
              resume_at: waitMs > 0 ? new Date(now + waitMs).toISOString() : null,
              status: isFatalGmail ? 'paused' : 'running',
              gmail_error: isFatalGmail ? (sendError || 'Errore Gmail') : null,
              active_pause_type: updatedState.pauseType,
            });

            if (isFatalGmail) {
              logEvent(
                'rate_limit',
                `🚨 ERRORE GMAIL CRITICO: ${sendError}. Auto Mode interrotto immediatamente per salvaguardare l'account.`
              );
              toast({
                title: '🚨 Errore Gmail Rilevato',
                description: `Auto Mode arrestato: ${sendError}. Riconnetti l'account.`,
                variant: 'destructive',
              });
            } else {
              logEvent(
                'email_failed',
                `⚠️ Invio a ${nextItem.company_name} non riuscito: ${sendError}. Nessun retry massivo: attesa precauzionale di 30 minuti.`
              );
            }
          }
        } else if (campaign.total_sent >= campaign.target_total) {
          updateCampaignState({
            status: 'completed',
            completed_at: new Date().toISOString(),
          });
          logEvent('target_completed', `🎯 Obiettivo completato: ${campaign.total_sent} candidature.`);
        }
      } catch (err: any) {
        console.error('[AutoCampaign] Engine error:', err);
      } finally {
        isRunningStepRef.current = false;
      }
    };

    // Polite polling interval to inspect nextScheduledSendAt and execute when allowed
    const timer = setInterval(() => {
      executeCycle();
    }, 4000);

    // Also run immediately on trigger or mount
    executeCycle();

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [
    campaign?.id,
    campaign?.status,
    campaign?.total_sent,
    campaign?.target_total,
    campaign?.current_search_cycle,
    campaign?.search_location,
    campaign?.search_radius,
    campaign?.search_keywords,
    campaign?.email_style,
    queueItems.length,
    processorTriggerRef.current,
    pacingState,
    cvData,
    sintesiBreve,
    profile,
    userId,
    logEvent,
    updateCampaignState,
    updateQueueItem,
    addLogInvio,
    toast,
  ]);

  return {
    campaign,
    events,
    queueItems,
    isLoading,
    pacingState,
    clearGmailError,
    startCampaign,
    pauseCampaign,
    resumeCampaign,
    stopCampaign,
    resetCampaign,
    triggerProcessor,
    refetch: fetchCampaign,
  };
}
