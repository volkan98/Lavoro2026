import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';

const environment = await initializeTestEnvironment({
  projectId: 'demo-cv-regression',
  firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
});
try {
  const alice = environment.authenticatedContext('firebase-owner-a').firestore();
  const bob = environment.authenticatedContext('firebase-owner-b').firestore();
  const anonymous = environment.unauthenticatedContext().firestore();
  const reference = alice.doc('users/firebase-owner-a');
  await assertSucceeds(reference.set({ uid: 'firebase-owner-a', cvParsedData: { nome: 'Fixture', esperienze: [{ azienda: 'Test' }], istruzione: [], lingue: [] } }));
  const result = await assertSucceeds(reference.get());
  assert.equal(result.data()?.cvParsedData.esperienze.length, 1);
  await assertFails(bob.doc('users/firebase-owner-a').get());
  await assertFails(bob.doc('users/firebase-owner-a').set({ cvParsedData: {} }));
  await assertFails(anonymous.doc('users/firebase-owner-a').get());
  await assertSucceeds(alice.doc('users/firebase-owner-a/sentEmails/message-test').set({ user_id: 'firebase-owner-a' }));
  await assertFails(bob.doc('users/firebase-owner-a/sentEmails/message-test').get());
  assert.throws(() => reference.set({ cvParsedData: { indirizzo: undefined } }), /undefined/);
  console.log('Firestore emulator: 8 assertions passed (owner, other UID, anonymous, sentEmails, undefined rejection).');
} finally { await environment.cleanup(); }
