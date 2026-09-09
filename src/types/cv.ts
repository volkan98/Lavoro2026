export interface CVData {
  nome: string;
  cognome: string;
  email: string;
  telefono: string;
  citta: string;
  cap: string;
  indirizzo?: string;
  dataNascita?: string;
  patente?: string;
  profilo: string;
  competenze: string[];
  esperienze: Esperienza[];
  istruzione: Istruzione[];
  lingue: Lingua[];
  certificazioni?: string[];
  altreInformazioni?: string[];
  targetRole?: string;
  permessoG?: boolean | string;
  statoPermesso?: string;
  sintesiBreve?: string;
  sintesiCompleta?: string;
}

export interface Esperienza {
  id: string;
  ruolo: string;
  azienda: string;
  dataInizio: string;
  dataFine: string;
  descrizione: string;
}

export interface Istruzione {
  id: string;
  titolo: string;
  istituto: string;
  anno: string;
  dataInizio?: string;
  dataFine?: string;
  descrizione?: string;
}

export interface Lingua {
  id: string;
  lingua: string;
  livello: string;
}

export interface Azienda {
  id: string;
  nome: string;
  indirizzo: string;
  citta: string;
  sito: string;
  email: string | null;
  emailVerified?: 'verified_official' | 'verified_directory' | 'directory_only' | 'unverified' | null;
  emailSource?: string | null;
  telefono: string;
  settore: string;
  fonte: string;
  distanza: number;
  tempoPercorrenza?: string;
  domainValid?: boolean | null;
  emailExplicit?: boolean;
  emailSourceType?: 'page_text' | 'mailto' | 'verified_directory' | 'unknown' | null;
  smtpStatus?: 'valid_email' | 'invalid_email' | 'unverifiable_email' | 'catch_all_domain' | null;
  catchAll?: boolean | null;
  confidenceScore?: number;
  finalStatus?: 'ready_to_send' | 'risky_send' | 'discarded';
  contactFormUrl?: string | null;
}

export interface EmailTemplate {
  oggetto: string;
  corpo: string;
  firma: string;
  matchPoints?: string[];
}

export interface LogInvio {
  id: string;
  data: Date | string;
  destinatario: string;
  emailDestinatario: string;
  oggetto: string;
  stato: 'inviato' | 'errore' | 'in_attesa';
  errore?: string;
}
