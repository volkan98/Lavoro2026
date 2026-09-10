import { scopedStorageKey } from '@/lib/api/client';
import { apiFetch, safeJsonResponse } from '@/lib/api/client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';

export interface BlacklistEntry {
  id: string;
  pattern: string; // Email es. "azienda@email.ch" o Dominio es. "azienda.ch"
  type: 'email' | 'domain';
  addedAt: string;
  notes?: string;
  user_id?: string;
}

export const STORAGE_KEY_BLACKLIST = 'job_agent_blacklist';
const BLACKLIST_CHANGE_EVENT = 'job_agent_blacklist_updated';

export function normalizeBlacklistPattern(input: string): { pattern: string; type: 'email' | 'domain' } {
  const clean = input.trim().toLowerCase();
  if (clean.includes('@') && !clean.startsWith('@')) {
    return {
      pattern: clean,
      type: 'email',
    };
  }
  return {
    pattern: clean.replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
    type: 'domain',
  };
}

export function isEmailBlacklisted(
  email: string | undefined | null,
  list: BlacklistEntry[]
): { isBlacklisted: boolean; entry?: BlacklistEntry; reason?: string } {
  if (!email || !email.includes('@') || !Array.isArray(list)) {
    return { isBlacklisted: false };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const domain = normalizedEmail.split('@')[1];

  for (const item of list) {
    if (!item || !item.pattern) continue;
    if (item.type === 'email') {
      if (item.pattern.toLowerCase() === normalizedEmail) {
        return {
          isBlacklisted: true,
          entry: item,
          reason: `Indirizzo ${item.pattern} bloccato in Blacklist`,
        };
      }
    } else if (item.type === 'domain') {
      const cleanPattern = item.pattern.toLowerCase().replace(/^@/, '');
      if (domain === cleanPattern || domain.endsWith('.' + cleanPattern)) {
        return {
          isBlacklisted: true,
          entry: item,
          reason: `Dominio @${cleanPattern} bloccato in Blacklist`,
        };
      }
    }
  }

  return { isBlacklisted: false };
}

export function getLocalBlacklist(): BlacklistEntry[] {
  try {
    const saved = localStorage.getItem(scopedStorageKey(STORAGE_KEY_BLACKLIST));
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Error reading local blacklist:', e);
  }
  return [];
}

export function saveLocalBlacklist(list: BlacklistEntry[]) {
  try {
    localStorage.setItem(scopedStorageKey(STORAGE_KEY_BLACKLIST), JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(BLACKLIST_CHANGE_EVENT, { detail: list }));
  } catch (e) {
    console.warn('Error saving local blacklist:', e);
  }
}

/**
 * Fetch blacklist directly from Firestore for a user UID.
 */
export async function fetchFirestoreBlacklist(uid: string): Promise<BlacklistEntry[]> {
  if (!uid) return [];
  try {
    const colRef = collection(db, 'users', uid, 'blacklist');
    const snap = await getDocs(colRef);
    const items: BlacklistEntry[] = [];
    snap.forEach((d) => {
      const data = d.data() as BlacklistEntry;
      if (data && data.pattern) {
        items.push({
          id: d.id,
          pattern: data.pattern,
          type: data.type || 'email',
          notes: data.notes,
          addedAt: data.addedAt || new Date().toISOString(),
          user_id: uid,
        });
      }
    });
    return items;
  } catch (err) {
    console.warn('[Blacklist] Firestore fetch error:', err);
    return [];
  }
}

export function useBlacklist() {
  const { user } = useAuth();
  const uid = user?.id;

  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>(() => getLocalBlacklist());
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Sync from Firestore (Primary source of truth) with auto-migration
  useEffect(() => {
    if (!uid) return;

    setIsLoading(true);
    const colRef = collection(db, 'users', uid, 'blacklist');

    const unsubscribe = onSnapshot(
      colRef,
      async (snap) => {
        const firestoreItems: BlacklistEntry[] = [];
        snap.forEach((d) => {
          const data = d.data() as BlacklistEntry;
          if (data && data.pattern) {
            firestoreItems.push({
              id: d.id,
              pattern: data.pattern,
              type: data.type || 'email',
              notes: data.notes,
              addedAt: data.addedAt || new Date().toISOString(),
              user_id: uid,
            });
          }
        });

        // Auto-migration: check if local storage has entries that are not in Firestore yet
        const local = getLocalBlacklist();
        const existingKeys = new Set(firestoreItems.map((i) => `${i.type}:${i.pattern.toLowerCase().trim()}`));
        const missingFromFirestore: BlacklistEntry[] = [];

        for (const locItem of local) {
          if (!locItem || !locItem.pattern) continue;
          const key = `${locItem.type || 'email'}:${locItem.pattern.toLowerCase().trim()}`;
          if (!existingKeys.has(key)) {
            missingFromFirestore.push(locItem);
            existingKeys.add(key);
          }
        }

        if (missingFromFirestore.length > 0) {
          console.info(`[Blacklist] Migrazione di ${missingFromFirestore.length} regole locali su Firestore...`);
          for (const item of missingFromFirestore) {
      const ruleId = item.id || `bl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const entryDoc: Record<string, any> = {
        id: ruleId,
        pattern: item.pattern,
        type: item.type || 'email',
        notes: item.notes?.trim() || '',
        addedAt: item.addedAt || new Date().toISOString(),
        user_id: uid,
      };
      try {
        await setDoc(doc(db, 'users', uid, 'blacklist', ruleId), entryDoc);
        firestoreItems.unshift(entryDoc as BlacklistEntry);
      } catch (err) {
        console.warn('[Blacklist] Migration write error:', err);
      }
          }
        }

        setBlacklist(firestoreItems);
        saveLocalBlacklist(firestoreItems);
        setIsLoading(false);
      },
      (err) => {
        console.warn('[Blacklist] Firestore snapshot error:', err);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [uid]);

  const fetchBlacklist = useCallback(async () => {
    if (!uid) return;
    setIsLoading(true);
    try {
      const items = await fetchFirestoreBlacklist(uid);
      if (items.length > 0) {
        setBlacklist(items);
        saveLocalBlacklist(items);
      } else {
        // Try fallback to server
        const res = await apiFetch('/api/blacklist');
        if (res.ok) {
          const json = await safeJsonResponse(res);
          if (json.success && Array.isArray(json.data)) {
            setBlacklist(json.data);
            saveLocalBlacklist(json.data);
          }
        }
      }
    } catch (err) {
      console.warn('Blacklist fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [uid]);

  const addToBlacklist = useCallback(
    async (rawInput: string, notes?: string): Promise<{ success: boolean; entry?: BlacklistEntry; alreadyExisted?: boolean }> => {
      if (!rawInput || !rawInput.trim()) {
        return { success: false };
      }

      const { pattern, type } = normalizeBlacklistPattern(rawInput);
      if (!pattern) return { success: false };

      // Check duplicate locally
      const existing = blacklist.find(
        (b) => b.pattern.toLowerCase() === pattern.toLowerCase() && b.type === type
      );

      if (existing) {
        return { success: true, entry: existing, alreadyExisted: true };
      }

      const ruleId = `bl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const cleanNotes = notes?.trim() || '';
      const newEntry: BlacklistEntry = {
        id: ruleId,
        pattern,
        type,
        notes: cleanNotes,
        addedAt: new Date().toISOString(),
        user_id: uid || '',
      };

      const updated = [newEntry, ...blacklist];
      setBlacklist(updated);
      saveLocalBlacklist(updated);

      // Save directly to Firestore
      if (uid) {
        try {
          const docData: Record<string, any> = {
            id: ruleId,
            pattern,
            type,
            notes: cleanNotes,
            addedAt: newEntry.addedAt,
            user_id: uid,
          };
          await setDoc(doc(db, 'users', uid, 'blacklist', ruleId), docData);
        } catch (err) {
          console.warn('Failed to save blacklist to Firestore:', err);
        }
      }

      // Async sync to server API
      try {
        await apiFetch('/api/blacklist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pattern, type, notes }),
        });
      } catch (err) {
        console.warn('Failed to sync blacklist addition to server:', err);
      }

      return { success: true, entry: newEntry };
    },
    [blacklist, uid]
  );

  const removeFromBlacklist = useCallback(
    async (idOrPattern: string): Promise<boolean> => {
      const target = idOrPattern.toLowerCase().trim();
      const removedItems = blacklist.filter(
        (b) => b.id === idOrPattern || b.pattern.toLowerCase() === target
      );
      const updated = blacklist.filter(
        (b) => b.id !== idOrPattern && b.pattern.toLowerCase() !== target
      );
      setBlacklist(updated);
      saveLocalBlacklist(updated);

      // Delete from Firestore
      if (uid) {
        for (const item of removedItems) {
          try {
            await deleteDoc(doc(db, 'users', uid, 'blacklist', item.id));
          } catch (err) {
            console.warn('Failed to delete blacklist from Firestore:', err);
          }
        }
      }

      // Async sync to server API
      try {
        await apiFetch(`/api/blacklist/${encodeURIComponent(idOrPattern)}`, {
          method: 'DELETE',
        });
      } catch (err) {
        console.warn('Failed to sync blacklist removal to server:', err);
      }

      return true;
    },
    [blacklist, uid]
  );

  const check = useCallback(
    (email: string | undefined | null) => {
      return isEmailBlacklisted(email, blacklist);
    },
    [blacklist]
  );

  const filteredBlacklist = useMemo(() => {
    const list = Array.isArray(blacklist) ? blacklist : [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(
      (item) =>
        item.pattern.toLowerCase().includes(q) ||
        (item.notes && item.notes.toLowerCase().includes(q))
    );
  }, [blacklist, searchQuery]);

  return {
    blacklist,
    isLoading,
    searchQuery,
    setSearchQuery,
    filteredBlacklist,
    addToBlacklist,
    removeFromBlacklist,
    isBlacklisted: check,
    refetch: fetchBlacklist,
  };
}

