// Synthetic regression fixture only. These are not the candidate's personal details.
export const rawCv = {
  firstName: 'Nome test', lastName: 'Cognome test', email: 'fixture@example.test', phone: '0000000000',
  city: 'Città test', postalCode: '00000', address: 'Indirizzo test', birthDate: '2000-01-01', drivingLicense: 'B',
  summary: 'Profilo professionale dichiarato nel documento di test.',
  skills: ['Competenza test A', 'Competenza test B'],
  work_experience: [
    { company: 'Azienda test A', position: 'Ruolo test A', start_date: '2020-01', end_date: '2022-12', responsibilities: ['Mansione test A', 'Mansione test B'] },
    { company: 'Azienda test B', position: 'Ruolo test B', start_date: '2023-01', description: 'Mansione test C' },
  ],
  education: [{ institution: 'Istituto test', degree: 'Qualifica test', start_date: '2015', end_date: '2019', description: 'Formazione test' }],
  languages: [{ language: 'Italiano', proficiency: 'C2' }, { language: 'Inglese', proficiency: 'B1' }],
  certifications: ['Certificazione test'], additionalInformation: ['Informazione test'],
};
export const originalText = JSON.stringify(rawCv, null, 2);
