import { useState, useEffect, useCallback, useMemo } from 'react';

export interface BlacklistEntry {
  id: string;
  pattern: string; // Email es. "azienda@email.ch" o Dominio es. "azienda.ch"
  type: 'email' | 'domain';
  addedAt: string;
  notes?: string;
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
    const saved = localStorage.getItem(STORAGE_KEY_BLACKLIST);
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
    localStorage.setItem(STORAGE_KEY_BLACKLIST, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(BLACKLIST_CHANGE_EVENT, { detail: list }));
  } catch (e) {
    console.warn('Error saving local blacklist:', e);
  }
}

export function useBlacklist() {
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>(() => getLocalBlacklist());
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Sync from server and local storage
  const fetchBlacklist = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/blacklist');
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          // Merge server list with local list
          const local = getLocalBlacklist();
          const combinedMap = new Map<string, BlacklistEntry>();
          local.forEach((item) => {
            if (item?.pattern) combinedMap.set(`${item.type || 'email'}:${item.pattern.toLowerCase().trim()}`, item);
          });
          json.data.forEach((item: BlacklistEntry) => {
            if (item?.pattern) combinedMap.set(`${item.type || 'email'}:${item.pattern.toLowerCase().trim()}`, item);
          });
          const merged = Array.from(combinedMap.values());
          setBlacklist(merged);
          saveLocalBlacklist(merged);
          return;
        }
      }
    } catch (err) {
      console.warn('Server blacklist fetch error, using local:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBlacklist();

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_BLACKLIST) {
        setBlacklist(getLocalBlacklist());
      }
    };

    const handleCustomChange = (e: Event) => {
      const customEvent = e as CustomEvent<BlacklistEntry[]>;
      if (customEvent.detail) {
        setBlacklist(customEvent.detail);
      } else {
        setBlacklist(getLocalBlacklist());
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(BLACKLIST_CHANGE_EVENT, handleCustomChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(BLACKLIST_CHANGE_EVENT, handleCustomChange);
    };
  }, [fetchBlacklist]);

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

      const newEntry: BlacklistEntry = {
        id: `bl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        pattern,
        type,
        notes: notes?.trim() || undefined,
        addedAt: new Date().toISOString(),
      };

      const updated = [newEntry, ...blacklist];
      setBlacklist(updated);
      saveLocalBlacklist(updated);

      // Async sync to server
      try {
        await fetch('/api/blacklist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pattern, type, notes }),
        });
      } catch (err) {
        console.warn('Failed to sync blacklist addition to server:', err);
      }

      return { success: true, entry: newEntry };
    },
    [blacklist]
  );

  const removeFromBlacklist = useCallback(
    async (idOrPattern: string): Promise<boolean> => {
      const target = idOrPattern.toLowerCase().trim();
      const updated = blacklist.filter(
        (b) => b.id !== idOrPattern && b.pattern.toLowerCase() !== target
      );
      setBlacklist(updated);
      saveLocalBlacklist(updated);

      // Async sync to server
      try {
        await fetch(`/api/blacklist/${encodeURIComponent(idOrPattern)}`, {
          method: 'DELETE',
        });
      } catch (err) {
        console.warn('Failed to sync blacklist removal to server:', err);
      }

      return true;
    },
    [blacklist]
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
