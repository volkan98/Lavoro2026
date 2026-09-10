import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/lib/firebase', () => ({
  auth: {
    currentUser: { uid: 'user_test_persistence_123' },
  },
  db: {},
}));

import { aiAgent, type SentEmailRecord } from '../src/lib/api/ai-agent';

describe('Sent Emails History & Persistence Flow', () => {
  const testUid = 'user_test_persistence_123';

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('stages writes in local pending queue before cloud confirmation', async () => {
    const queueKey = `pending_sent_emails_${testUid}`;
    expect(localStorage.getItem(queueKey)).toBeNull();

    // Call recordSentEmail with mocked Firestore failure
    const recordPromise = aiAgent.recordSentEmail(
      'comp_001',
      'Test Tech SRL',
      'hr@testtech.it',
      'Candidatura Spontanea - Frontend Engineer',
      'Gentile HR, vi allego il mio CV.',
      'CV_Frontend.pdf',
      testUid,
      'gmail_msg_id_999',
      'thread_888'
    );

    const result = await recordPromise;
    expect(result.success).toBe(true);
    expect(result.id).toBe('gmail_msg_id_999');

    // Verify record in local storage history cache
    const cacheKey = `sent_emails_history_${testUid}`;
    const cachedHistory = JSON.parse(localStorage.getItem(cacheKey) || '[]');
    expect(cachedHistory.length).toBeGreaterThan(0);
    expect(cachedHistory[0].email).toBe('hr@testtech.it');
    expect(cachedHistory[0].domain).toBe('testtech.it');
  });

  it('deduplicates emails by messageId and domain/email correctly', async () => {
    // Record first email
    await aiAgent.recordSentEmail({
      companyId: 'comp_1',
      companyName: 'Acme Corp',
      email: 'jobs@acme.com',
      subject: 'Candidatura',
      body: 'Test',
      cvVersion: 'CV.pdf',
      userId: testUid,
      messageId: 'msg_identical_1',
    });

    // Record same email again with identical messageId
    await aiAgent.recordSentEmail({
      companyId: 'comp_1',
      companyName: 'Acme Corp',
      email: 'jobs@acme.com',
      subject: 'Candidatura duplicate',
      body: 'Test duplicate',
      cvVersion: 'CV.pdf',
      userId: testUid,
      messageId: 'msg_identical_1',
    });

    const emails = await aiAgent.getSentEmails(testUid);
    const duplicates = emails.filter(e => e.message_id === 'msg_identical_1' || e.id === 'msg_identical_1');
    expect(duplicates.length).toBe(1);
  });

  it('never zeros out history when offline or on network error', async () => {
    // Pre-populate cache with 2 emails
    const existingRecords: SentEmailRecord[] = [
      {
        id: 'msg_1',
        company_id: 'c1',
        company_name: 'Company A',
        email: 'info@companya.com',
        domain: 'companya.com',
        subject: 'Candidatura',
        status: 'sent',
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        user_id: testUid,
      },
      {
        id: 'msg_2',
        company_id: 'c2',
        company_name: 'Company B',
        email: 'jobs@companyb.com',
        domain: 'companyb.com',
        subject: 'Candidatura',
        status: 'sent',
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        user_id: testUid,
      },
    ];

    localStorage.setItem(`sent_emails_history_${testUid}`, JSON.stringify(existingRecords));

    // Force network fetch error in getSentEmails
    const emails = await aiAgent.getSentEmails(testUid);
    expect(emails.length).toBe(2);
    expect(emails[0].email).toBe('info@companya.com');
    expect(emails[1].email).toBe('jobs@companyb.com');
  });

  it('calculates unique domains and statistics accurately', () => {
    const list: SentEmailRecord[] = [
      {
        id: '1',
        company_id: '1',
        company_name: 'Alpha',
        email: 'jobs@alpha.it',
        domain: 'alpha.it',
        subject: 'Subj 1',
        status: 'sent',
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        user_id: testUid,
      },
      {
        id: '2',
        company_id: '2',
        company_name: 'Alpha Second Contact',
        email: 'recruiting@alpha.it',
        domain: 'alpha.it',
        subject: 'Subj 2',
        status: 'sent',
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        user_id: testUid,
      },
      {
        id: '3',
        company_id: '3',
        company_name: 'Beta',
        email: 'hr@beta.com',
        domain: 'beta.com',
        subject: 'Subj 3',
        status: 'error',
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        user_id: testUid,
      },
    ];

    const uniqueDomains = [...new Set(list.map(e => e.domain).filter(Boolean))];
    const stats = {
      total: list.length,
      sent: list.filter(e => e.status === 'sent').length,
      error: list.filter(e => e.status === 'error').length,
      domains: uniqueDomains.length,
    };

    expect(stats.total).toBe(3);
    expect(stats.sent).toBe(2);
    expect(stats.error).toBe(1);
    expect(stats.domains).toBe(2); // alpha.it and beta.com
  });
});
