import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aiAgent, type SentEmailRecord } from '../src/lib/api/ai-agent';
import * as workspaceAuth from '../src/lib/workspaceAuth';

// Mock dependencies
vi.mock('../src/lib/firebase', () => ({
  auth: { currentUser: { uid: 'user_test_gmail_123' } },
  db: {},
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  setDoc: vi.fn(),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
  deleteDoc: vi.fn(),
}));
vi.mock('../src/lib/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/api/client')>();
  return {
    ...mod,
    apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })),
    requireUid: (id?: string) => id || 'user_test_gmail_123'
  };
});

describe('Gmail Sync 3-Day Window & Cleanup Rules', () => {
  const testUid = 'user_test_gmail_123';
  
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  const nowMs = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  
  it('cleans up erroneously imported recovery records older than 3 days but leaves app records intact', async () => {
    // 1. Setup local storage with mixed records
    const records: SentEmailRecord[] = [
      {
        id: 'msg_valid_app',
        user_id: testUid,
        company_name: 'Valid App Sent',
        email: 'app@test.com',
        subject: 'Candidatura',
        body: '',
        status: 'sent',
        source: 'app', // Standard app send
        sent_at: new Date(nowMs - 10 * ONE_DAY_MS).toISOString() // Old but from app -> must survive
      },
      {
        id: 'msg_errant_recovery_old',
        user_id: testUid,
        company_name: 'Old Recovery',
        email: 'old@test.com',
        subject: 'Candidatura',
        body: '',
        status: 'sent',
        source: 'gmail_recovery',
        sent_at: new Date(nowMs - 4 * ONE_DAY_MS).toISOString() // > 3 days and recovery -> must die
      },
      {
        id: 'msg_errant_recovery_admin',
        user_id: testUid,
        company_name: 'ComoAcqua',
        email: 'bollette@comoacqua.it',
        subject: 'Fattura',
        body: '',
        status: 'sent',
        source: 'gmail_recovery',
        sent_at: new Date(nowMs - ONE_DAY_MS).toISOString() // < 3 days but admin domain -> must die
      },
      {
        id: 'msg_valid_recovery_recent',
        user_id: testUid,
        company_name: 'Recent Recovery',
        email: 'hr@recent.com',
        subject: 'Candidatura',
        body: '',
        status: 'sent',
        source: 'gmail_recovery',
        sent_at: new Date(nowMs - ONE_DAY_MS).toISOString() // < 3 days and valid -> must survive
      }
    ];
    
    localStorage.setItem(`sent_emails_history_${testUid}`, JSON.stringify(records));
    
    const result = await aiAgent.cleanupInvalidRecoveredEmails(testUid);
    expect(result.removedCount).toBe(2);
    
    const remaining = JSON.parse(localStorage.getItem(`sent_emails_history_${testUid}`) || '[]');
    expect(remaining.length).toBe(2);
    expect(remaining.find((r: any) => r.id === 'msg_valid_app')).toBeDefined();
    expect(remaining.find((r: any) => r.id === 'msg_valid_recovery_recent')).toBeDefined();
    expect(remaining.find((r: any) => r.id === 'msg_errant_recovery_old')).toBeUndefined();
    expect(remaining.find((r: any) => r.id === 'msg_errant_recovery_admin')).toBeUndefined();
  });
  
  it('prevents reconciliation logic from fetching older than 3 days', async () => {
    const fetchSpy = vi.spyOn(workspaceAuth, 'fetchSentGmailMessages').mockResolvedValue({
      success: true,
      messages: [
        {
          id: 'gmail_msg_1',
          threadId: 't1',
          internalDate: String(nowMs - 5 * ONE_DAY_MS),
          sentAt: new Date(nowMs - 5 * ONE_DAY_MS).toISOString(),
          to: 'hr@old.com',
          recipientEmail: 'hr@old.com',
          recipientName: 'Old HR',
          domain: 'old.com',
          subject: 'Candidatura Vecchia',
          bodySnippet: 'Vecchio CV',
          bodyText: 'Vecchio CV',
          bodyHtml: 'Vecchio CV',
          attachments: ['CV.pdf'],
          cvFilename: 'CV.pdf',
          isOutreach: true
        },
        {
          id: 'gmail_msg_2',
          threadId: 't2',
          internalDate: String(nowMs - 2 * ONE_DAY_MS),
          sentAt: new Date(nowMs - 2 * ONE_DAY_MS).toISOString(),
          to: 'hr@new.com',
          recipientEmail: 'hr@new.com',
          recipientName: 'New HR',
          domain: 'new.com',
          subject: 'Candidatura Nuova',
          bodySnippet: 'Nuovo CV',
          bodyText: 'Nuovo CV',
          bodyHtml: 'Nuovo CV',
          attachments: ['CV.pdf'],
          cvFilename: 'CV.pdf',
          isOutreach: true
        }
      ]
    });
    
    const recResult = await aiAgent.reconcileWithGmail(testUid);
    expect(recResult.success).toBe(true);
    
    // Only the recent message (gmail_msg_2) should be processed because gmail_msg_1 is older than 3 days
    expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ newerThanDays: 3 }));
    
    // Check local storage for the reconciled emails
    const history = JSON.parse(localStorage.getItem(`sent_emails_history_${testUid}`) || '[]');
    // The reconciliation adds the item to the beginning of the queue/history
    expect(history.find((x: any) => x.id === 'gmail_msg_1')).toBeUndefined();
    expect(history.find((x: any) => x.id === 'gmail_msg_2')).toBeDefined();
  });
});
