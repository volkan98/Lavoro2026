import { scopedStorageKey, requireUid, apiFetch, sanitizeForFirestore, safeJsonResponse } from '@/lib/api/client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { aiAgent, Company } from '@/lib/api/ai-agent';
import { useCVContext } from '@/contexts/CVContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { isEmailBlacklisted, BlacklistEntry, fetchFirestoreBlacklist } from '@/lib/blacklist';
import {
  fetchFirestoreSentEmailsHistory,
  isCompanyMatchSentRecord,
  extractEmailDomain,
  isGenericEmailDomain,
  normalizeCompanyName,
  normalizeCompanyId,
} from '@/lib/companyDeduplication';
import { sendViaGmailApi } from '@/lib/workspaceAuth';
import { getVerifiedCvAttachment, loadCvBinary } from '@/lib/cvStorage';
import {
  enforceEmailBodyRules,
  formatCandidateSignature,
  auditEmailPreSend,
} from '@/lib/emailRules';
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
  getTodayDateString,
  cleanHourlyTimestamps,
  getRandomBlockTarget,
} from '@/lib/campaignPacing';

export interface CampaignRunnerLock {
  tab_id: string;
  heartbeat_at: number; // timestamp in ms
  claimed_at: string;
  origin?: string;
}

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

  // Anti-spam gradual pacing fields synced in Cloud
  daily_date?: string;
  daily_sent_count?: number;
  gmail_error?: string | null;
  active_pause_type?: PauseType;
  hourly_sent_count?: number;

  // Single authoritative runner lock across Preview and Production
  runner_lock?: CampaignRunnerLock | null;
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
  company_id?: string | null;
  company_name: string;
  company_email: string;
  company_city: string | null;
  company_sector: string | null;
  company_website?: string | null;
  status: string; // 'pending' | 'email_generated' | 'sent' | 'failed' | 'discarded'
  confidence_score: number;
  error_message?: string | null;
  sent_at?: string | null;
  gmail_message_id?: string | null;
  gmail_thread_id?: string | null;
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

// Lock timeout: If leader tab does not pulse heartbeat within 12 seconds, another tab can assume leadership
const RUNNER_HEARTBEAT_INTERVAL_MS = 4000;
const RUNNER_LOCK_TIMEOUT_MS = 12000;

function getStatusPriority(status: string): number {
  switch (status) {
    case 'sent':
      return 5;
    case 'processing':
      return 4;
    case 'email_generated':
      return 3;
    case 'pending':
      return 2;
    case 'failed':
      return 1;
    case 'skipped':
      return 1;
    default:
      return 0;
  }
}

function mergeAndPreserveQueuePriority(
  currentItems: QueueItem[],
  newItems: QueueItem[],
  sentEmails: any[] = []
): QueueItem[] {
  const sentMap = new Map<string, any>();
  const sentDomainMap = new Map<string, any>();
  
  sentEmails.forEach((record) => {
    if (record) {
      const emailVal = record.email || record.company_email || record.recipient || record.to;
      if (emailVal) {
        const emailNorm = emailVal.toLowerCase().trim();
        sentMap.set(emailNorm, record);
        
        const domain = extractEmailDomain(emailNorm);
        if (domain && !isGenericEmailDomain(domain)) {
          sentDomainMap.set(domain, record);
        }
      }
    }
  });

  const mergedMap = new Map<string, QueueItem>();

  currentItems.forEach((item) => {
    if (item && item.id) {
      mergedMap.set(item.id, item);
    }
  });

  newItems.forEach((newItem) => {
    if (!newItem || !newItem.id) return;
    
    const existingItem = mergedMap.get(newItem.id);
    let resolvedItem = { ...newItem };

    if (existingItem) {
      const currentPriority = getStatusPriority(existingItem.status);
      const newPriority = getStatusPriority(newItem.status);
      
      if (currentPriority > newPriority) {
        console.warn(`[AutoCampaign Dedup] Preserved higher priority status "${existingItem.status}" over "${newItem.status}" for ${newItem.company_name}`);
        resolvedItem.status = existingItem.status;
        if (existingItem.sent_at) resolvedItem.sent_at = existingItem.sent_at;
        if (existingItem.gmail_message_id) resolvedItem.gmail_message_id = existingItem.gmail_message_id;
        if (existingItem.gmail_thread_id) resolvedItem.gmail_thread_id = existingItem.gmail_thread_id;
      }
    }

    if (resolvedItem.status !== 'sent') {
      const emailNorm = resolvedItem.company_email.toLowerCase().trim();
      const domain = extractEmailDomain(emailNorm);
      
      let matchedRecord = sentMap.get(emailNorm);
      let matchType = 'email';
      
      if (!matchedRecord && domain && !isGenericEmailDomain(domain)) {
        matchedRecord = sentDomainMap.get(domain);
        matchType = 'domain';
      }
      
      if (!matchedRecord) {
        const companyTarget = {
          id: resolvedItem.company_id || resolvedItem.id,
          companyId: resolvedItem.company_id || resolvedItem.id,
          name: resolvedItem.company_name,
          company_name: resolvedItem.company_name,
          email: resolvedItem.company_email,
          website: resolvedItem.company_website,
        };
        
        for (const record of sentEmails) {
          const matchRes = isCompanyMatchSentRecord(companyTarget, record);
          if (matchRes.isMatch) {
            matchedRecord = record;
            matchType = matchRes.matchType || 'name';
            break;
          }
        }
      }

      if (matchedRecord) {
        console.log(`[AutoCampaign Dedup] Automatic reconciliation for queue item "${resolvedItem.company_name}" -> "sent" due to match in sentEmails history (${matchType}).`);
        resolvedItem.status = 'sent';
        resolvedItem.sent_at = matchedRecord.sent_at || matchedRecord.sentAt || resolvedItem.sent_at || new Date().toISOString();
        resolvedItem.gmail_message_id = matchedRecord.message_id || matchedRecord.messageId || resolvedItem.gmail_message_id || null;
      }
    }

    mergedMap.set(newItem.id, resolvedItem);
  });

  return Array.from(mergedMap.values());
}

export function useAutoCampaign() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { cvData, sintesiBreve, cvFileState, addLogInvio } = useCVContext();
  const { profile, binary } = useUserProfile();

  const userId = requireUid(user?.id);
  const sentEmailsHistoryRef = useRef<any[]>([]);

  // Unique tab instance ID to prevent multi-tab split-brain / duplicate execution
  const tabIdRef = useRef<string>(
    typeof window !== 'undefined'
      ? `tab_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
      : 'tab_server'
  );
  const tabId = tabIdRef.current;

  // Local cache initialization
  const [campaign, setCampaign] = useState<Campaign | null>(() => {
    try {
      const stored = localStorage.getItem(scopedStorageKey(LOCAL_STORAGE_CAMPAIGN_KEY));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object' && parsed.id) return parsed;
      }
    } catch {}
    return null;
  });

  const [events, setEvents] = useState<CampaignEvent[]>(() => {
    try {
      const stored = localStorage.getItem(scopedStorageKey(LOCAL_STORAGE_EVENTS_KEY));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const [queueItems, setQueueItems] = useState<QueueItem[]>(() => {
    try {
      const stored = localStorage.getItem(scopedStorageKey(LOCAL_STORAGE_QUEUE_KEY));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const [pacingState, setPacingState] = useState<PacingState>(() => loadPacingState(userId));
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLeader, setIsLeader] = useState<boolean>(false);

  const isRunningStepRef = useRef<boolean>(false);
  const processorTriggerRef = useRef<number>(0);
  const lastHeartbeatSentRef = useRef<number>(0);

  // Helper to add a live event (persisted both locally and to Firestore subcollection)
  const logEvent = useCallback((eventType: string, message: string, metadata?: any) => {
    const newEvt: CampaignEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      campaign_id: campaign?.id || 'current',
      event_type: eventType,
      message,
      metadata: metadata || null,
      created_at: new Date().toISOString(),
    };

    setEvents((prev) => {
      const updated = [newEvt, ...prev.filter(e => e.id !== newEvt.id)].slice(0, 100);
      try {
        localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_EVENTS_KEY), JSON.stringify(updated));
      } catch {}
      return updated;
    });

    if (userId) {
      try {
        const evtDocRef = doc(db, 'users', userId, 'campaigns', 'current', 'events', newEvt.id);
        setDoc(evtDocRef, sanitizeForFirestore(newEvt)).catch(() => {});
      } catch {}
    }
  }, [campaign?.id, userId]);

  // Update campaign state helper (writes to Firestore Source of Truth and broadcasts)
  const updateCampaignState = useCallback((updates: Partial<Campaign>, eventMsg?: string) => {
    setCampaign((prev) => {
      if (!prev) return null;
      const updated = {
        ...prev,
        ...updates,
        updated_at: new Date().toISOString(),
      };
      try {
        localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_CAMPAIGN_KEY), JSON.stringify(updated));
      } catch {}
      return updated;
    });

    // Write to Firestore single document authority
    if (userId) {
      try {
        const campDocRef = doc(db, 'users', userId, 'campaigns', 'current');
        const clean = sanitizeForFirestore({
          ...updates,
          updated_at: new Date().toISOString(),
        });
        setDoc(campDocRef, clean, { merge: true }).catch((err) => {
          console.warn('[AutoCampaign] Firestore setDoc error:', err);
        });
      } catch (err) {
        console.warn('[AutoCampaign] Firestore save error:', err);
      }
    }

    if (eventMsg) {
      logEvent('info', eventMsg);
    }
  }, [userId, logEvent]);

  // Helper to clear Gmail error and allow resume on all connected clients
  const clearGmailError = useCallback(async () => {
    const today = getTodayDateString();
    const updatedPacing: PacingState = {
      ...pacingState,
      dailyDate: today,
      gmailError: null,
      pauseType: 'none',
      pauseReason: null,
      nextScheduledSendAt: 0,
    };

    setPacingState(updatedPacing);
    savePacingState(updatedPacing, userId);

    if (userId) {
      try {
        const paceDocRef = doc(db, 'users', userId, 'pacing', 'current');
        await setDoc(paceDocRef, sanitizeForFirestore(updatedPacing), { merge: true }).catch(() => {});
      } catch {}
    }

    updateCampaignState({
      status: 'paused',
      pause_reason: null,
      gmail_error: null,
      resume_at: null,
      active_pause_type: 'none',
    });

    logEvent('info', '🔓 Errore Gmail azzerato manualmente. La campagna è pronta per essere ripresa.');

    toast({
      title: '✅ Errore Gmail azzerato',
      description: 'Puoi ora riprendere la campagna con il pulsante "Riprendi".',
    });
  }, [pacingState, userId, updateCampaignState, logEvent, toast]);

  // Update a queue item in local state and Firestore subcollection
  const updateQueueItem = useCallback((id: string, updates: Partial<QueueItem>) => {
    let finalUpdates = { ...updates };

    setQueueItems((prev) => {
      const currentItem = prev.find((item) => item.id === id);
      if (currentItem) {
        if (updates.status && getStatusPriority(currentItem.status) > getStatusPriority(updates.status)) {
          console.warn(`[AutoCampaign] Prevented status demotion for item ${currentItem.company_name} from "${currentItem.status}" to "${updates.status}".`);
          const { status, ...rest } = updates;
          finalUpdates = rest;
        }
      }

      const updated = prev.map((item) => (item.id === id ? { ...item, ...finalUpdates } : item));
      try {
        localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_QUEUE_KEY), JSON.stringify(updated));
      } catch {}
      return updated;
    });

    if (userId && Object.keys(finalUpdates).length > 0) {
      try {
        const qDocRef = doc(db, 'users', userId, 'campaigns', 'current', 'queue', id);
        setDoc(qDocRef, sanitizeForFirestore(finalUpdates), { merge: true }).catch(() => {});
      } catch {}
    }
  }, [userId]);

  // Helper to normalize raw Firestore data into a valid, safe Campaign object
  const normalizeCampaignData = useCallback((data: any, fallbackId = 'current'): Campaign | null => {
    if (!data || typeof data !== 'object') return null;
    // If it was explicitly reset (empty reset doc with no location and no start time)
    if (data.status === 'stopped' && data.reset_at && !data.search_location && !data.started_at) {
      return null;
    }
    // If document exists with fields, construct a fully validated Campaign record
    const id = data.id || data.campaign_id || fallbackId || `camp_${Date.now()}`;
    const status = (['running', 'paused', 'completed', 'stopped', 'idle', 'error'].includes(data.status)
      ? data.status
      : (data.status || 'running')) as string;

    return {
      id,
      status,
      search_location: data.search_location || 'Ticino',
      search_radius: typeof data.search_radius === 'number' ? data.search_radius : 30,
      search_keywords: Array.isArray(data.search_keywords) ? data.search_keywords : [],
      only_selected_city: !!data.only_selected_city,
      target_total: typeof data.target_total === 'number' ? data.target_total : 50,
      email_style: data.email_style || 'standard',
      include_risky: !!data.include_risky,
      cv_file_path: data.cv_file_path || null,
      total_found: typeof data.total_found === 'number' ? data.total_found : 0,
      total_sent: typeof data.total_sent === 'number' ? data.total_sent : 0,
      total_failed: typeof data.total_failed === 'number' ? data.total_failed : 0,
      total_generated: typeof data.total_generated === 'number' ? data.total_generated : 0,
      total_skipped: typeof data.total_skipped === 'number' ? data.total_skipped : 0,
      current_search_cycle: typeof data.current_search_cycle === 'number' ? data.current_search_cycle : 1,
      max_search_cycles: typeof data.max_search_cycles === 'number' ? data.max_search_cycles : 5,
      pause_reason: data.pause_reason || null,
      resume_at: data.resume_at || null,
      next_send_at: data.next_send_at || null,
      started_at: data.started_at || null,
      completed_at: data.completed_at || null,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || new Date().toISOString(),
      daily_date: data.daily_date || undefined,
      daily_sent_count: typeof data.daily_sent_count === 'number' ? data.daily_sent_count : undefined,
      gmail_error: data.gmail_error !== undefined ? data.gmail_error : null,
      active_pause_type: data.active_pause_type || 'none',
      hourly_sent_count: typeof data.hourly_sent_count === 'number' ? data.hourly_sent_count : undefined,
      runner_lock: data.runner_lock || null,
    };
  }, []);

  // =========================================================================
  // REAL-TIME FIRESTORE SYNCHRONIZATION: Subscriptions to single Cloud Source of Truth
  // =========================================================================
  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    // 1. Subscribe to current campaign document (Cloud Source of Truth)
    const campDocRef = doc(db, 'users', userId, 'campaigns', 'current');
    const unsubCamp = onSnapshot(
      campDocRef,
      (snap) => {
        setIsLoading(false);
        if (snap.exists()) {
          const rawData = snap.data();
          const remoteCamp = normalizeCampaignData(rawData, snap.id);
          if (remoteCamp) {
            setCampaign(remoteCamp);
            try {
              localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_CAMPAIGN_KEY), JSON.stringify(remoteCamp));
            } catch {}

            // Check leader lock
            const lock = remoteCamp.runner_lock;
            const now = Date.now();
            const lockIsHeldByMe = lock?.tab_id === tabId;
            const lockIsFresh = lock && (now - (lock.heartbeat_at || 0) < RUNNER_LOCK_TIMEOUT_MS);

            if (lockIsHeldByMe) {
              setIsLeader(true);
            } else if (!lockIsFresh) {
              // Lock is stale or unheld; if campaign is running, we can contest leadership
              setIsLeader(false);
            } else {
              // Another tab is actively leading
              setIsLeader(false);
            }

            // Sync pacing state if present in campaign document
            if (remoteCamp.daily_date || remoteCamp.daily_sent_count !== undefined) {
              setPacingState((prev) => {
                const updated: PacingState = {
                  ...prev,
                  dailyDate: remoteCamp.daily_date || prev.dailyDate,
                  dailySentCount: typeof remoteCamp.daily_sent_count === 'number' ? remoteCamp.daily_sent_count : prev.dailySentCount,
                  gmailError: remoteCamp.gmail_error !== undefined ? remoteCamp.gmail_error : prev.gmailError,
                  pauseType: remoteCamp.active_pause_type || prev.pauseType,
                  pauseReason: remoteCamp.pause_reason || prev.pauseReason,
                  nextScheduledSendAt: remoteCamp.resume_at ? new Date(remoteCamp.resume_at).getTime() : prev.nextScheduledSendAt,
                };
                return updated;
              });
            }
          } else {
            // Document exists but was explicitly reset
            setCampaign(null);
            try {
              localStorage.removeItem(scopedStorageKey(LOCAL_STORAGE_CAMPAIGN_KEY));
            } catch {}
          }
        } else {
          // Document does not exist in Firestore Cloud
          setCampaign(null);
          try {
            localStorage.removeItem(scopedStorageKey(LOCAL_STORAGE_CAMPAIGN_KEY));
          } catch {}
        }
      },
      (err) => {
        console.warn('[AutoCampaign] Realtime campaign snapshot warning:', err);
        setIsLoading(false);
      }
    );

    // 2. Subscribe to queue subcollection
    const queueColRef = collection(db, 'users', userId, 'campaigns', 'current', 'queue');
    const unsubQueue = onSnapshot(
      queueColRef,
      (qSnap) => {
        if (!qSnap.empty) {
          const fsItems: QueueItem[] = [];
          qSnap.forEach((d) => {
            const itm = d.data() as QueueItem;
            if (itm && itm.id) fsItems.push(itm);
          });
          if (fsItems.length > 0) {
            setQueueItems((prev) => {
              const updated = mergeAndPreserveQueuePriority(prev, fsItems, sentEmailsHistoryRef.current);
              try {
                localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_QUEUE_KEY), JSON.stringify(updated));
              } catch {}
              return updated;
            });
          }
        }
      },
      (err) => {
        console.warn('[AutoCampaign] Realtime queue snapshot warning:', err);
      }
    );

    // 3. Subscribe to events subcollection
    const eventsColRef = collection(db, 'users', userId, 'campaigns', 'current', 'events');
    const eventsQuery = query(eventsColRef, orderBy('created_at', 'desc'), limit(60));
    const unsubEvents = onSnapshot(
      eventsQuery,
      (eSnap) => {
        if (!eSnap.empty) {
          const fsEvents: CampaignEvent[] = [];
          eSnap.forEach((d) => {
            const ev = d.data() as CampaignEvent;
            if (ev && ev.id) fsEvents.push(ev);
          });
          if (fsEvents.length > 0) {
            setEvents(fsEvents);
            try {
              localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_EVENTS_KEY), JSON.stringify(fsEvents));
            } catch {}
          }
        }
      },
      (err) => {
        console.warn('[AutoCampaign] Realtime events snapshot warning:', err);
      }
    );

    // 4. Subscribe to pacing document
    const paceDocRef = doc(db, 'users', userId, 'pacing', 'current');
    const unsubPacing = onSnapshot(
      paceDocRef,
      (pSnap) => {
        if (pSnap.exists()) {
          const pData = pSnap.data() as PacingState;
          if (pData && typeof pData === 'object') {
            const today = getTodayDateString();
            const normalized: PacingState = {
              dailyDate: pData.dailyDate || today,
              dailySentCount: typeof pData.dailySentCount === 'number' ? pData.dailySentCount : 0,
              hourlySentTimestamps: cleanHourlyTimestamps(pData.hourlySentTimestamps || []),
              currentBlockSends: typeof pData.currentBlockSends === 'number' ? pData.currentBlockSends : 0,
              currentBlockTarget: typeof pData.currentBlockTarget === 'number' ? pData.currentBlockTarget : getRandomBlockTarget(),
              nextScheduledSendAt: pData.nextScheduledSendAt || null,
              pauseType: pData.pauseType || 'none',
              pauseReason: pData.pauseReason || null,
              gmailError: pData.gmailError || null,
              lastSentAt: pData.lastSentAt || null,
            };
            setPacingState(normalized);
            savePacingState(normalized, userId);
          }
        }
      },
      (err) => {
        console.warn('[AutoCampaign] Realtime pacing snapshot warning:', err);
      }
    );

    return () => {
      unsubCamp();
      unsubQueue();
      unsubEvents();
      unsubPacing();
    };
  }, [userId, tabId, normalizeCampaignData]);

  // Fetch & reconcile campaign on initial load
  const fetchCampaign = useCallback(async () => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    try {
      let loadedCampaign: Campaign | null = null;
      let loadedQueue: QueueItem[] = [];

      // Read Firestore Campaign
      const campDocRef = doc(db, 'users', userId, 'campaigns', 'current');
      const campSnap = await getDoc(campDocRef).catch(() => null);

      if (campSnap && campSnap.exists()) {
        const rawData = campSnap.data();
        const norm = normalizeCampaignData(rawData, campSnap.id);
        if (norm) {
          loadedCampaign = norm;
          setCampaign((prev) => {
            if (!prev) return loadedCampaign;
            return {
              ...prev,
              ...loadedCampaign,
              total_sent: Math.max(prev.total_sent || 0, loadedCampaign?.total_sent || 0),
              daily_sent_count: Math.max(prev.daily_sent_count || 0, loadedCampaign?.daily_sent_count || 0),
            };
          });
        }
      }

      // Read Firestore Queue
      const qSnap = await getDocs(collection(db, 'users', userId, 'campaigns', 'current', 'queue')).catch(() => null);
      if (qSnap && !qSnap.empty) {
        loadedQueue = qSnap.docs.map((d) => d.data() as QueueItem);
      }

      // Reconcile with Sent Emails History (Source of Truth)
      try {
        const sentEmails = await fetchFirestoreSentEmailsHistory(userId, { timeoutMs: 8000 });
        if (Array.isArray(sentEmails)) {
          sentEmailsHistoryRef.current = sentEmails;
          
          const today = getTodayDateString();
          const todaySentCount = sentEmails.filter((e) => {
            const d = e.sent_at || (e as any).sentAt;
            return d && d.startsWith(today);
          }).length;

          // Reconcile queue items safely preserving state priorities
          loadedQueue = mergeAndPreserveQueuePriority(queueItems, loadedQueue, sentEmails);

          // Reconcile campaign counters if discrepancy exists
          if (loadedCampaign) {
            const actualSent = Math.max(loadedCampaign.total_sent || 0, sentEmails.length);
            const actualDaily = Math.max(loadedCampaign.daily_sent_count || 0, todaySentCount);
            if (actualSent !== loadedCampaign.total_sent || actualDaily !== loadedCampaign.daily_sent_count) {
              console.log(`[AutoCampaign] Reconciling campaign counters from ${loadedCampaign.total_sent} to ${actualSent} total sent.`);
              loadedCampaign = {
                ...loadedCampaign,
                total_sent: actualSent,
                daily_sent_count: actualDaily,
                daily_date: today,
              };
              setCampaign(loadedCampaign);
              setDoc(campDocRef, sanitizeForFirestore(loadedCampaign), { merge: true }).catch(() => {});
            }
          }
        }
      } catch (recErr) {
        console.warn('[AutoCampaign] Reconciliation error:', recErr);
      }

      if (loadedQueue.length > 0) {
        setQueueItems(loadedQueue);
      }
    } catch (e) {
      console.warn('[AutoCampaign] Initial fetch error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [userId, normalizeCampaignData]);

  useEffect(() => {
    fetchCampaign();
  }, [fetchCampaign]);

  // =========================================================================
  // USER ACTIONS: Single Campaign Control (Shared between Preview and Production)
  // =========================================================================

  // Start campaign: Checks if active campaign exists to prevent duplicate split-brain
  const startCampaign = async (setup: CampaignSetupData) => {
    if (!userId) return;
    setIsLoading(true);

    try {
      const today = getTodayDateString();
      const campDocRef = doc(db, 'users', userId, 'campaigns', 'current');
      const existingSnap = await getDoc(campDocRef).catch(() => null);
      const existingData = existingSnap?.exists() ? (existingSnap.data() as Campaign) : null;

      // 1. RE-ATTACH GUARD: If a campaign is already running or paused, connect to it!
      if (existingData && existingData.id && ['running', 'paused'].includes(existingData.status)) {
        console.log('[AutoCampaign] Re-attaching to existing active cloud campaign:', existingData.id);

        const attachedCamp: Campaign = {
          ...existingData,
          status: 'running',
          runner_lock: {
            tab_id: tabId,
            heartbeat_at: Date.now(),
            claimed_at: new Date().toISOString(),
            origin: typeof window !== 'undefined' ? window.location.hostname : undefined,
          },
          updated_at: new Date().toISOString(),
        };

        await setDoc(campDocRef, sanitizeForFirestore(attachedCamp), { merge: true });
        setCampaign(attachedCamp);
        setIsLeader(true);

        logEvent('resume', `🔄 Ricollegato alla campagna attiva in Cloud (${attachedCamp.total_sent}/${attachedCamp.target_total} inviate)`);

        toast({
          title: '🔄 Ricollegato alla Campagna Attiva',
          description: `Agganciato alla campagna esistente (${attachedCamp.total_sent}/${attachedCamp.target_total} inviate).`,
        });

        processorTriggerRef.current += 1;
        setIsLoading(false);
        return;
      }

      // 2. CREATE NEW CAMPAIGN: Fresh single authoritative campaign
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
        runner_lock: {
          tab_id: tabId,
          heartbeat_at: Date.now(),
          claimed_at: new Date().toISOString(),
          origin: typeof window !== 'undefined' ? window.location.hostname : undefined,
        },
      };

      const newEvent: CampaignEvent = {
        id: `evt_${Date.now()}`,
        campaign_id: newCamp.id,
        event_type: 'start',
        message: `🚀 Auto Campaign avviata per ${setup.search_location} (Pacing naturale antispam: max 50/giorno, max 8/h)`,
        metadata: { setup },
        created_at: new Date().toISOString(),
      };

      setCampaign(newCamp);
      setEvents([newEvent]);
      setQueueItems([]);
      setIsLeader(true);

      try {
        localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_CAMPAIGN_KEY), JSON.stringify(newCamp));
        localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_EVENTS_KEY), JSON.stringify([newEvent]));
        localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_QUEUE_KEY), JSON.stringify([]));
      } catch {}

      // Write new campaign & event to Firestore
      await setDoc(campDocRef, sanitizeForFirestore(newCamp));
      const evtDocRef = doc(db, 'users', userId, 'campaigns', 'current', 'events', newEvent.id);
      setDoc(evtDocRef, sanitizeForFirestore(newEvent)).catch(() => {});

      toast({
        title: '🚀 Auto Mode avviato!',
        description: `Invio graduale attivato per ${setup.search_location} (max 50/giorno).`,
      });

      processorTriggerRef.current += 1;
    } catch (err: any) {
      console.error('[AutoCampaign] startCampaign error:', err);
      toast({
        title: 'Errore avvio',
        description: err.message || 'Impossibile avviare la campagna.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
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
    if (pacingState.gmailError || campaign.gmail_error) {
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

    // Claim leadership and set status to running
    updateCampaignState({
      status: 'running',
      pause_reason: null,
      runner_lock: {
        tab_id: tabId,
        heartbeat_at: Date.now(),
        claimed_at: new Date().toISOString(),
        origin: typeof window !== 'undefined' ? window.location.hostname : undefined,
      },
    });

    setIsLeader(true);
    logEvent('resume', '▶️ Auto Mode ripreso');
    toast({ title: '▶️ Auto Mode ripreso!' });
    processorTriggerRef.current += 1;
  };

  const stopCampaign = async () => {
    if (!campaign) return;
    updateCampaignState({
      status: 'stopped',
      completed_at: new Date().toISOString(),
      runner_lock: null,
    });
    setIsLeader(false);
    logEvent('stop', '⏹️ Campagna terminata definitivamente');
    toast({ title: '⏹️ Campagna fermata' });
  };

  const resetCampaign = async () => {
    setCampaign(null);
    setEvents([]);
    setQueueItems([]);
    setIsLeader(false);

    try {
      localStorage.removeItem(scopedStorageKey(LOCAL_STORAGE_CAMPAIGN_KEY));
      localStorage.removeItem(scopedStorageKey(LOCAL_STORAGE_EVENTS_KEY));
      localStorage.removeItem(scopedStorageKey(LOCAL_STORAGE_QUEUE_KEY));
    } catch {}

    if (userId) {
      try {
        // 1. Svuota la subcollection "queue" in Firestore (Senza toccare sentEmails)
        const queueColRef = collection(db, 'users', userId, 'campaigns', 'current', 'queue');
        const queueSnap = await getDocs(queueColRef).catch(() => null);
        if (queueSnap && !queueSnap.empty) {
          const deleteQueuePromises = queueSnap.docs.map((docSnap) => deleteDoc(docSnap.ref));
          await Promise.all(deleteQueuePromises).catch((err) => {
            console.error('[resetCampaign] Errore durante lo svuotamento della coda:', err);
          });
        }

        // 2. Svuota la subcollection "events" in Firestore
        const eventsColRef = collection(db, 'users', userId, 'campaigns', 'current', 'events');
        const eventsSnap = await getDocs(eventsColRef).catch(() => null);
        if (eventsSnap && !eventsSnap.empty) {
          const deleteEventsPromises = eventsSnap.docs.map((docSnap) => deleteDoc(docSnap.ref));
          await Promise.all(deleteEventsPromises).catch((err) => {
            console.error('[resetCampaign] Errore durante lo svuotamento degli eventi:', err);
          });
        }

        // 3. Elimina o resetta il documento della campagna "current"
        const campDocRef = doc(db, 'users', userId, 'campaigns', 'current');
        await deleteDoc(campDocRef).catch(async () => {
          await setDoc(campDocRef, {
            status: 'stopped',
            reset_at: new Date().toISOString(),
            search_location: '',
            started_at: null,
            total_sent: 0,
            total_found: 0,
            runner_lock: null,
          });
        });
      } catch (err) {
        console.warn('[resetCampaign] Errore di connessione Firestore:', err);
      }
    }

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
  // CORE ENGINE: Auto Search & Send Loop with Distributed Leader Lock
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
        const now = Date.now();

        // -------------------------------------------------------------------
        // 1. LEADER ELECTION & RUNNER LOCK CHECK
        // -------------------------------------------------------------------
        const lock = campaign.runner_lock;
        const lockIsHeldByMe = lock?.tab_id === tabId;
        const lockIsStale = !lock || (now - (lock.heartbeat_at || 0) > RUNNER_LOCK_TIMEOUT_MS);

        if (!lockIsHeldByMe && !lockIsStale) {
          // Another tab is actively executing the runner. We are in observer/controller mode.
          if (isLeader) setIsLeader(false);
          return;
        }

        // Claim or refresh leadership lock
        if (!lockIsHeldByMe && lockIsStale) {
          console.log('[AutoCampaign] Claiming leader lock for tab:', tabId);
          setIsLeader(true);
          updateCampaignState({
            runner_lock: {
              tab_id: tabId,
              heartbeat_at: now,
              claimed_at: new Date().toISOString(),
              origin: typeof window !== 'undefined' ? window.location.hostname : undefined,
            },
          });
        } else if (lockIsHeldByMe && now - lastHeartbeatSentRef.current > RUNNER_HEARTBEAT_INTERVAL_MS) {
          // Pulse heartbeat
          lastHeartbeatSentRef.current = now;
          if (userId) {
            const campDocRef = doc(db, 'users', userId, 'campaigns', 'current');
            setDoc(
              campDocRef,
              {
                runner_lock: {
                  tab_id: tabId,
                  heartbeat_at: now,
                  origin: typeof window !== 'undefined' ? window.location.hostname : undefined,
                },
                updated_at: new Date().toISOString(),
              },
              { merge: true }
            ).catch(() => {});
          }
        }

        // -------------------------------------------------------------------
        // 2. CHECK STRICT PACING RULES BEFORE ANY SEND ACTION
        // -------------------------------------------------------------------
        const canSend = checkCanSendNow(pacingState, now);

        if (!canSend.allowed) {
          // Fatal Gmail error -> Pause immediately
          if (canSend.pauseType === 'gmail_error') {
            updateCampaignState({
              status: 'paused',
              pause_reason: canSend.reason || 'Interrotto per errore critico Gmail',
              gmail_error: pacingState.gmailError,
            });
            return;
          }

          // Daily limit 50/50 reached -> Pause until tomorrow
          if (canSend.pauseType === 'daily_limit') {
            const nextDayDate = canSend.waitMs ? new Date(now + canSend.waitMs).toISOString() : null;
            if (campaign.pause_reason !== canSend.reason) {
              updateCampaignState({
                status: 'paused',
                pause_reason: canSend.reason || 'Limite giornaliero di 50 candidature raggiunto. Invii sospesi fino a domani.',
                resume_at: nextDayDate,
                active_pause_type: 'daily_limit',
              });
              logEvent(
                'daily_limit',
                `🛑 Limite giornaliero di 50 candidature raggiunto oggi (${pacingState.dailySentCount}/50). Invii interrotti fino a domani per preservare la reputazione dell'account.`
              );
            }
            return;
          }

          // Natural interval (6-12m) or block pause (20-40m)
          const resumeIso = canSend.waitMs ? new Date(now + canSend.waitMs).toISOString() : null;
          if (campaign.pause_reason !== canSend.reason || campaign.resume_at !== resumeIso) {
            updateCampaignState({
              pause_reason: canSend.reason || null,
              resume_at: resumeIso,
              active_pause_type: canSend.pauseType,
            });
          }
          return;
        }

        // Check queue items
        const pendingOrGenerated = queueItems.filter(
          (q) => q.status === 'pending' || q.status === 'email_generated'
        );

        // -------------------------------------------------------------------
        // 3. AUTO SEARCH PHASE: Search for new companies if queue empty
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

          try {
            const currentBlacklist: BlacklistEntry[] = await fetchFirestoreBlacklist(userId);

            const searchResult = await aiAgent.searchCompanies(
              campaign.search_location || 'Lugano, Canton Ticino',
              campaign.search_radius || 30,
              campaign.search_keywords || ['produzione', 'verniciatura', 'metalmeccanica'],
              cvData?.competenze,
              cvData?.profilo,
              25,
              cvData?.citta || campaign.search_location,
              campaign.only_selected_city,
              campaign.current_search_cycle
            );

            if (!isMounted) return;

            if (searchResult.success && Array.isArray(searchResult.data) && searchResult.data.length > 0) {
              // Get live sent history directly from Firestore (primary source of truth)
              const sentHistory = await fetchFirestoreSentEmailsHistory(userId, { timeoutMs: 5000 });

              // Fetch live queue directly from Firestore to avoid local-state race conditions or delays
              const qSnapDirect = await getDocs(collection(db, 'users', userId, 'campaigns', 'current', 'queue')).catch(() => null);
              const liveQueueItems = qSnapDirect && !qSnapDirect.empty
                ? qSnapDirect.docs.map((d) => d.data() as QueueItem)
                : [];

              // Merge local queueItems with live queue items from Firestore for absolute completeness
              const combinedQueue = [...queueItems];
              liveQueueItems.forEach((itm) => {
                if (itm && itm.id && !combinedQueue.some((q) => q.id === itm.id)) {
                  combinedQueue.push(itm);
                }
              });

              // Tracking for this search cycle to avoid duplicating within the same batch
              const currentCycleEmails = new Set<string>();
              const currentCycleDomains = new Set<string>();

              const newValidItems: QueueItem[] = [];

              for (const c of searchResult.data) {
                if (!c.email) continue;
                const em = c.email.trim().toLowerCase();
                const cDomain = extractEmailDomain(em);
                const companyTarget = {
                  id: (c as any).id || (c as any).companyId || (c as any).company_id || '',
                  companyId: (c as any).id || (c as any).companyId || (c as any).company_id || '',
                  name: c.name,
                  company_name: c.name,
                  email: em,
                  company_email: em,
                  domain: cDomain,
                  website: c.website,
                };

                // 0. Include Risky check
                const isRisky = c.final_status === 'risky_send' || (c as any).finalStatus === 'risky_send';
                const foundRiskyAndExcluded = isRisky && !campaign.include_risky;

                // 1. Sent History Check (Source of Truth)
                let foundInSentEmails = false;
                let sentEmailReason = '';
                for (const record of sentHistory) {
                  const matchRes = isCompanyMatchSentRecord(companyTarget, record);
                  if (matchRes.isMatch) {
                    foundInSentEmails = true;
                    sentEmailReason = matchRes.detail || `Storico invio (${matchRes.matchType})`;
                    break;
                  }
                }

                // 2. Queue Check (Combined Queue)
                let foundInQueue = false;
                let queueReason = '';

                for (const item of combinedQueue) {
                  const allowedStates = ['sent', 'pending', 'processing', 'email_generated'];
                  if (!allowedStates.includes(item.status)) continue;

                  const qEmail = item.company_email.toLowerCase().trim();
                  const qDomain = extractEmailDomain(qEmail);

                  if (em === qEmail) {
                    foundInQueue = true;
                    queueReason = `Coda: stessa email (${em})`;
                    break;
                  }

                  if (cDomain && !isGenericEmailDomain(cDomain) && qDomain && !isGenericEmailDomain(qDomain) && cDomain === qDomain) {
                    foundInQueue = true;
                    queueReason = `Coda: stesso dominio corporate (${cDomain})`;
                    break;
                  }

                  const qCompanyId = normalizeCompanyId(item.company_id || item.id);
                  const candCompanyIdNorm = normalizeCompanyId(companyTarget.companyId);
                  if (candCompanyIdNorm && qCompanyId && candCompanyIdNorm === qCompanyId) {
                    foundInQueue = true;
                    queueReason = `Coda: stesso companyId (${candCompanyIdNorm})`;
                    break;
                  }
                }

                // Search cycle duplicate check
                if (!foundInQueue) {
                  if (currentCycleEmails.has(em)) {
                    foundInQueue = true;
                    queueReason = `Ciclo: email duplicata nel set di risultati`;
                  } else if (cDomain && !isGenericEmailDomain(cDomain) && currentCycleDomains.has(cDomain)) {
                    foundInQueue = true;
                    queueReason = `Ciclo: dominio corporate duplicato nel set di risultati (${cDomain})`;
                  }
                }

                // 3. Blacklist Check
                const blacklistCheck = isEmailBlacklisted(em, currentBlacklist);
                const foundInBlacklist = blacklistCheck.isBlacklisted;

                const shouldSkip = foundInSentEmails || foundInQueue || foundInBlacklist || foundRiskyAndExcluded;
                const decision = shouldSkip ? 'SKIP' : 'ADD';
                
                let skipReason = '';
                if (foundRiskyAndExcluded) skipReason = 'Contatto "risky" escluso (opzione disattivata)';
                else if (foundInSentEmails) skipReason = sentEmailReason;
                else if (foundInQueue) skipReason = queueReason;
                else if (foundInBlacklist) skipReason = blacklistCheck.reason || 'Blacklist';

                // Exact debug log format requested by user
                console.log(
                  `[DEDUP SEARCH]\n` +
                  `company: "${c.name}"\n` +
                  `email: "${em}"\n` +
                  `domain: "${cDomain || ''}"\n` +
                  `isRisky: ${isRisky}\n` +
                  `inSentEmails: ${foundInSentEmails}\n` +
                  `inQueue: ${foundInQueue}\n` +
                  `inBlacklist: ${foundInBlacklist}\n` +
                  `decision: ${decision}\n` +
                  `reason: ${shouldSkip ? skipReason : 'Nuova azienda idonea'}`
                );

                if (shouldSkip) continue;

                currentCycleEmails.add(em);
                if (cDomain && !isGenericEmailDomain(cDomain)) {
                  currentCycleDomains.add(cDomain);
                }

                const newItem: QueueItem = {
                  id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                  campaign_id: campaign.id,
                  user_id: userId,
                  company_id: companyTarget.companyId || null,
                  company_name: c.name,
                  company_email: em,
                  company_city: c.city || null,
                  company_sector: c.sector || null,
                  company_website: c.website || null,
                  status: 'pending',
                  confidence_score: c.confidence_score || 85,
                  created_at: new Date().toISOString(),
                };
                newValidItems.push(newItem);

                // Persist queue item directly to Firestore
                if (userId) {
                  const qDocRef = doc(db, 'users', userId, 'campaigns', 'current', 'queue', newItem.id);
                  setDoc(qDocRef, sanitizeForFirestore(newItem)).catch(() => {});
                }
              }

              const rawCount = searchResult.data.length;
              const newCount = newValidItems.length;
              const strategyUsed = searchResult.searchStats?.strategyUsed || campaign.search_keywords?.join(', ') || 'Generale';

              // Distinct Live Console logs requested by user
              logEvent(
                'search_success',
                `[Ciclo ${campaign.current_search_cycle}/${campaign.max_search_cycles}] ${strategyUsed} → ${rawCount} risultati grezzi, ${newCount} nuovi`
              );

              if (newValidItems.length > 0) {
                const updatedQueue = [...queueItems, ...newValidItems];
                setQueueItems(updatedQueue);
                try {
                  localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_QUEUE_KEY), JSON.stringify(updatedQueue));
                } catch {}

                const newFound = (campaign.total_found || 0) + newValidItems.length;
                const nextCycle = campaign.current_search_cycle + 1;

                updateCampaignState(
                  {
                    total_found: newFound,
                    current_search_cycle: nextCycle,
                  },
                  `✅ Trovate ${newValidItems.length} nuove aziende idonee e non ancora contattate (Totale trovate: ${newFound})`
                );
              } else {
                const nextCycle = campaign.current_search_cycle + 1;
                if (nextCycle > campaign.max_search_cycles) {
                  updateCampaignState(
                    { current_search_cycle: nextCycle },
                    `⚠️ Nessuna nuova azienda non contattata trovata nella zona selezionata dopo ${campaign.max_search_cycles} passate.`
                  );
                } else {
                  updateCampaignState({ current_search_cycle: nextCycle });
                }
              }
            } else {
              const nextCycle = campaign.current_search_cycle + 1;
              updateCampaignState({ current_search_cycle: nextCycle });
            }
          } catch (err: any) {
            console.error('[AutoCampaign Search Error]:', err);
            const nextCycle = campaign.current_search_cycle + 1;
            logEvent(
              'search_error',
              `⚠️ Errore temporaneo nel ciclo ${campaign.current_search_cycle}: ${err?.message || 'Connessione instabile o quota esaurita'}. Passaggio al ciclo successivo...`
            );
            updateCampaignState({ current_search_cycle: nextCycle });
          }
          return;
        }

        // -------------------------------------------------------------------
        // 4. SEND PHASE: Send next queued email according to anti-spam pacing
        // -------------------------------------------------------------------
        let nextItem: QueueItem | undefined = undefined;
        for (const item of queueItems) {
          if (item.status !== 'pending' && item.status !== 'email_generated') continue;

          // 1. Blacklist check before sending
          try {
            const currentBlacklist = await fetchFirestoreBlacklist(userId);
            const blacklistCheck = isEmailBlacklisted(item.company_email, currentBlacklist);
            if (blacklistCheck.isBlacklisted) {
              console.log(`[AutoCampaign Pre-Send] Item ${item.company_name} is blacklisted, skipping.`);
              logEvent('skipped', `⚠️ Elemento ${item.company_name} saltato in fase di invio: presente in Blacklist.`);
              updateQueueItem(item.id, { status: 'skipped', error_message: blacklistCheck.reason || 'Presente in Blacklist' });
              continue;
            }
          } catch (blErr) {
            console.warn('[AutoCampaign] Pre-send blacklist check warning:', blErr);
          }

          // 2. Sent history check before sending
          let isAlreadySent = false;
          let sentReason = '';
          try {
            const sentHistory = await fetchFirestoreSentEmailsHistory(userId, { timeoutMs: 5000 });
            sentEmailsHistoryRef.current = sentHistory; // Keep ref updated

            const companyTarget = {
              id: item.company_id || item.id,
              companyId: item.company_id || item.id,
              name: item.company_name,
              company_name: item.company_name,
              email: item.company_email,
              website: item.company_website,
            };

            for (const record of sentHistory) {
              const matchRes = isCompanyMatchSentRecord(companyTarget, record);
              if (matchRes.isMatch) {
                isAlreadySent = true;
                sentReason = matchRes.detail || `Storico invio (${matchRes.matchType})`;
                break;
              }
            }
          } catch (dupErr) {
            console.warn('[AutoCampaign] Pre-send check warning:', dupErr);
          }

          if (isAlreadySent) {
            console.log(`[AutoCampaign Pre-Send] Item ${item.company_name} already in Firestore history, skipping. Reason: ${sentReason}`);
            logEvent('skipped', `⚠️ Elemento ${item.company_name} saltato in fase di invio: già contattato (${sentReason}).`);
            updateQueueItem(item.id, { status: 'skipped', error_message: `Già contattato: ${sentReason}` });
            continue;
          }

          // 3. Active queue duplicates check
          let hasQueueDuplicate = false;
          let queueDupReason = '';
          const itemEmail = item.company_email.toLowerCase().trim();
          const itemDomain = extractEmailDomain(itemEmail);
          const itemCompanyId = normalizeCompanyId(item.company_id || item.id);

          for (const other of queueItems) {
            if (other.id === item.id) continue;
            // A duplicate must have been processed or is processing ('sent' or 'processing')
            if (other.status !== 'sent' && other.status !== 'processing') continue;

            const otherEmail = other.company_email.toLowerCase().trim();
            const otherDomain = extractEmailDomain(otherEmail);
            const otherCompanyId = normalizeCompanyId(other.company_id || other.id);

            if (itemEmail === otherEmail) {
              hasQueueDuplicate = true;
              queueDupReason = `Email identica (${itemEmail}) già in coda con stato "${other.status}"`;
              break;
            }

            if (itemDomain && !isGenericEmailDomain(itemDomain) && otherDomain && !isGenericEmailDomain(otherDomain) && itemDomain === otherDomain) {
              hasQueueDuplicate = true;
              queueDupReason = `Dominio corporate identico (${itemDomain}) già in coda con stato "${other.status}"`;
              break;
            }

            if (itemCompanyId && otherCompanyId && itemCompanyId === otherCompanyId) {
              hasQueueDuplicate = true;
              queueDupReason = `Company ID identico (${itemCompanyId}) già in coda con stato "${other.status}"`;
              break;
            }
          }

          if (hasQueueDuplicate) {
            console.log(`[AutoCampaign Pre-Send] Item ${item.company_name} has active queue duplicate, skipping. Reason: ${queueDupReason}`);
            logEvent('skipped', `⚠️ Elemento ${item.company_name} saltato in fase di invio: duplicato in coda (${queueDupReason}).`);
            updateQueueItem(item.id, { status: 'skipped', error_message: `Duplicato in coda: ${queueDupReason}` });
            continue;
          }

          nextItem = item;
          break;
        }

        if (nextItem && campaign.total_sent < campaign.target_total) {
          // Rule: Verify CV PDF attachment
          let attachment: { filename: string; mimeType: string; base64: string } | undefined;
          try {
            const fileState = cvFileState?.base64Data ? cvFileState : (binary ? {
              file: null, uid: binary.uid, fileName: binary.filename,
              base64Data: binary.base64, mimeType: binary.mimeType, contentHash: binary.contentHash
            } : cvFileState);
            const verifiedCv = await getVerifiedCvAttachment(fileState, cvData, profile);
            if (verifiedCv.ok && verifiedCv.attachment?.base64 && verifiedCv.attachment.base64.length > 50) {
              attachment = {
                filename: verifiedCv.attachment.filename || cvFileState?.fileName || binary?.filename || 'Curriculum_Vitae.pdf',
                mimeType: verifiedCv.attachment.mimeType || cvFileState?.mimeType || binary?.mimeType || 'application/pdf',
                base64: verifiedCv.attachment.base64,
              };
            } else if (binary?.base64 && binary.base64.length > 50) {
              attachment = {
                filename: binary.filename || cvFileState?.fileName || 'Curriculum_Vitae.pdf',
                mimeType: binary.mimeType || cvFileState?.mimeType || 'application/pdf',
                base64: binary.base64,
              };
            } else {
              const loadedBinary = await loadCvBinary(userId);
              if (loadedBinary?.base64 && loadedBinary.base64.length > 50) {
                attachment = {
                  filename: loadedBinary.filename || 'Curriculum_Vitae.pdf',
                  mimeType: loadedBinary.mimeType || 'application/pdf',
                  base64: loadedBinary.base64,
                };
              }
            }
          } catch (cvErr) {
            console.warn('[AutoCampaign] Errore verifica CV attachment:', cvErr);
          }

          if (!attachment || !attachment.base64 || attachment.base64.length < 50) {
            const errMsg = "Invio bloccato: nessun file CV in formato PDF valido rilevato.";
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

          logEvent('email_generating', `📝 Generazione candidatura personalizzata per ${nextItem.company_name}...`);

          const candidateName = cvData?.nome
            ? `${cvData.nome} ${cvData?.cognome || ''}`.trim()
            : profile?.full_name || '';

          let subject = '';
          let bodyText = '';

          try {
            const targetCompany: Company = {
              id: nextItem.id,
              name: nextItem.company_name,
              email: nextItem.company_email,
              city: nextItem.company_city || campaign.search_location || 'Ticino',
              sector: nextItem.company_sector || 'Produzione industriale',
              website: nextItem.company_website || undefined,
            };

            const styleVariant = (['breve', 'standard', 'formale'].includes(campaign.email_style)
              ? campaign.email_style
              : 'standard') as 'breve' | 'standard' | 'formale';

            const emailRes = await aiAgent.generateEmail(targetCompany, cvData || {}, styleVariant, '', '');
            if (emailRes.success && emailRes.data) {
              subject = emailRes.data.oggetto || '';
              const firmaText = emailRes.data.firma || formatCandidateSignature(cvData, 'text');
              bodyText = `${emailRes.data.corpo}\n\n${firmaText}`;
            }
          } catch (genErr) {
            console.warn('[AutoCampaign] Generazione AI fallback a template variato:', genErr);
          }

          const seedIndex = campaign.total_sent + Math.floor(Math.random() * 10);
          const varied = generateVariedEmail({
            candidateName,
            companyName: nextItem.company_name,
            companyCity: nextItem.company_city,
            companySector: nextItem.company_sector,
            skills: cvData?.competenze,
            experiences: cvData?.esperienze,
            cvData,
            style: campaign.email_style,
            seedIndex,
          });

          subject = (subject || varied.subject).trim();
          bodyText = enforceEmailBodyRules((bodyText || varied.bodyText).trim(), cvData);

          // Audit pre-send
          const audit = auditEmailPreSend({
            to: nextItem.company_email,
            subject,
            corpo: bodyText,
            firma: formatCandidateSignature(cvData, 'text'),
            cvData,
            hasAttachment: true,
            isBlacklisted: false,
          });

          if (!audit.isValid) {
            const reasons = audit.errors.join('; ');
            const errMsg = `Invio bloccato per mancata conformità regole email: ${reasons}`;
            logEvent('error', `❌ ${errMsg}`);
            updateQueueItem(nextItem.id, { status: 'failed', error_message: errMsg });
            return;
          }

          updateQueueItem(nextItem.id, { status: 'email_generated' });

          const sanitizedHtml = bodyText
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*/g, '')
            .replace(/\n\n/g, '<br><br>')
            .replace(/\n/g, '<br>');

          // Attempt send
          let sendSuccess = false;
          let sendError: string | null = null;
          let needsAuth = false;
          let sentMessageId: string | undefined = undefined;
          let sentThreadId: string | undefined = undefined;

          try {
            const gmailRes = await sendViaGmailApi(
              {
                to: nextItem.company_email,
                subject,
                bodyHtml: sanitizedHtml,
                attachment,
              },
              { interactive: false }
            );

            if (gmailRes.success) {
              sendSuccess = true;
              sentMessageId = gmailRes.messageId;
              sentThreadId = gmailRes.threadId;
              logEvent('gmail_api', `✅ Candidatura inviata via Gmail API (${attachment.filename}) a ${nextItem.company_name}`);
            } else {
              sendError = gmailRes.error || 'Invio Gmail non riuscito';
              needsAuth = !!gmailRes.needsInteractiveAuth;
            }
          } catch (e: any) {
            sendError = e.message || "Errore di connessione durante l'invio";
          }

          if (sendSuccess) {
            const sendNow = Date.now();
            const { updatedState, nextIntervalMs, isBlockPause, isDailyLimitReached } = recordSendSuccess(pacingState, sendNow);
            setPacingState(updatedState);
            savePacingState(updatedState, userId);

            const nextSendIso = new Date(sendNow + nextIntervalMs).toISOString();
            updateQueueItem(nextItem.id, { status: 'sent', sent_at: new Date(sendNow).toISOString() });

            const newTotalSent = (campaign.total_sent || 0) + 1;
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
              logEvent('daily_limit', `🛑 Limite massimo di 50 invii raggiunto per oggi (50/50). Auto Mode sospeso fino a domani.`);
              toast({
                title: '🛑 Limite Giornaliero Raggiunto (50/50)',
                description: "Candidature completate per oggi. L'invio riprenderà automaticamente domani.",
              });
            } else if (isBlockPause) {
              const pauseMin = Math.round(nextIntervalMs / 60000);
              logEvent('block_pause', `⏸️ Pausa di sicurezza: blocco di candidature completato. Pausa di ${pauseMin} minuti antispam.`);
            } else {
              const nextMin = (nextIntervalMs / 60000).toFixed(1);
              logEvent('email_sent', `✉️ Inviata a ${nextItem.company_name}. Prossimo invio programmato tra ~${nextMin} min.`);
            }

            // Record to Firestore sent emails collection (Source of Truth)
            await aiAgent.recordSentEmail(
              nextItem.id,
              nextItem.company_name,
              nextItem.company_email,
              subject,
              bodyText,
              attachment.filename,
              userId,
              sentMessageId,
              sentThreadId
            );

            if (addLogInvio) {
              addLogInvio({
                id: `log_${Date.now()}`,
                destinatario: nextItem.company_name,
                emailDestinatario: nextItem.company_email,
                data: new Date().toISOString(),
                stato: 'inviato',
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
            if (needsAuth) {
              updateQueueItem(nextItem.id, { status: 'pending' });
              updateCampaignState({
                status: 'paused',
                pause_reason: sendError || 'Autorizzazione Gmail assente o scaduta.',
                gmail_error: sendError || 'Autorizzazione Gmail assente o scaduta.',
              });
              logEvent('error', `🛑 Auto Mode in pausa: ${sendError || 'Autorizzazione Gmail necessaria'}.`);
              toast({
                title: 'Autorizzazione Gmail Richiesta',
                description: 'Auto Mode è in pausa. Riconnetti Gmail per riprendere gli invii.',
                variant: 'destructive',
              });
            } else {
              const sendNow = Date.now();
              const { updatedState, isFatalGmail, waitMs, reason } = recordSendError(pacingState, sendError || 'Errore fornitore email', sendNow);
              setPacingState(updatedState);
              savePacingState(updatedState, userId);

              updateQueueItem(nextItem.id, {
                status: 'failed',
                error_message: sendError,
              });

              updateCampaignState({
                total_failed: (campaign.total_failed || 0) + 1,
                pause_reason: reason,
                resume_at: waitMs > 0 ? new Date(sendNow + waitMs).toISOString() : null,
                status: isFatalGmail ? 'paused' : 'running',
                gmail_error: isFatalGmail ? (sendError || 'Errore Gmail') : null,
                active_pause_type: updatedState.pauseType,
              });

              if (isFatalGmail) {
                logEvent('rate_limit', `🚨 ERRORE GMAIL CRITICO: ${sendError}. Auto Mode arrestato.`);
                toast({
                  title: '🚨 Errore Gmail Rilevato',
                  description: `Auto Mode arrestato: ${sendError}.`,
                  variant: 'destructive',
                });
              } else {
                logEvent('email_failed', `⚠️ Invio a ${nextItem.company_name} non riuscito: ${sendError}.`);
              }
            }
          }
        }
      } catch (err: any) {
        console.error('[AutoCampaign] Engine loop error:', err);
      } finally {
        isRunningStepRef.current = false;
      }
    };

    const timer = setInterval(() => {
      executeCycle();
    }, RUNNER_HEARTBEAT_INTERVAL_MS);

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
    campaign?.runner_lock?.tab_id,
    campaign?.runner_lock?.heartbeat_at,
    queueItems.length,
    processorTriggerRef.current,
    pacingState,
    cvData,
    sintesiBreve,
    profile,
    userId,
    tabId,
    isLeader,
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
    isLeader,
    tabId,
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
