import { useState } from 'react';
import { useCVContext } from '@/contexts/CVContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { aiAgent } from '@/lib/api/ai-agent';
import { fileToBase64, cvMimeType } from '@/lib/cvStorage';
import { normalizeCvData } from '@/lib/cvNormalizer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

export function CVUploader() {
  const { setCvData, setCurrentStep } = useCVContext();
  const { cvParsedData, isLoading: loadingProfile, hasSavedCV, uploadCV, saveProfile, syncError, fetchProfile, source } = useUserProfile();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const choose = (input?: File) => {
    setError(null);
    if (!input) return;
    if (!/\.(pdf|docx|txt)$/i.test(input.name)) { setError('Usa un file PDF, DOCX o TXT.'); return; }
    if (!input.size || input.size > 15 * 1024 * 1024) { setError('Il file deve contenere dati e non superare 15 MB.'); return; }
    setFile(input);
  };
  const analyze = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const result = await aiAgent.parseCV({ base64Data: await fileToBase64(file), mimeType: cvMimeType(file.name, file.type), fileName: file.name });
      if (!result.success || !result.data) throw new Error(result.error || 'Analisi non riuscita');
      const parsed = normalizeCvData(result.data);
      const uploaded = await uploadCV(file, parsed);
      setCvData(parsed);
      const saved = await saveProfile(parsed, parsed.sintesiBreve || '', parsed.sintesiCompleta || '', uploaded);
      if (!saved.success) throw new Error(saved.error || 'Salvataggio Firestore non riuscito');
      toast({ title: 'CV analizzato e salvato', description: 'Documento originale e dati estratti disponibili.' });
      setCurrentStep(1);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <div className="max-w-2xl mx-auto space-y-6">
    <h2 className="text-2xl font-bold text-center">Carica il tuo CV</h2>
    {loadingProfile && <p role="status">Recupero dei dati del CV…</p>}
    {(error || syncError) && <div role="alert" className="border border-destructive rounded-lg p-4 space-y-3">
      <p>{error || syncError}</p>
      {syncError && <Button variant="outline" disabled={busy || loadingProfile} onClick={() => { void fetchProfile(true).catch(() => {}); }}>Riprova analisi</Button>}
    </div>}
    {hasSavedCV && cvParsedData && <Card><CardContent className="p-5 space-y-3">
      <h3 className="font-semibold">{source === 'cloud' ? 'Dati CV salvati' : 'Copia locale del CV'}</h3>
      <p>{[cvParsedData.nome, cvParsedData.cognome].filter(Boolean).join(' ') || 'Nome non presente nel CV'}</p>
      <p>{cvParsedData.esperienze.length} esperienze · {cvParsedData.istruzione.length} titoli di studio · {cvParsedData.lingue.length} lingue</p>
      <Button onClick={() => setCurrentStep(1)}>Apri Sintesi CV</Button>
    </CardContent></Card>}
    <div className="rounded-xl border-2 border-dashed p-8 text-center space-y-4"
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) choose(e.dataTransfer.files[0]); }}>
      <p>Seleziona o trascina il documento originale: PDF, DOCX o TXT.</p>
      <input aria-label="File CV" type="file" accept=".pdf,.docx,.txt" disabled={busy || loadingProfile} onChange={e => choose(e.target.files?.[0])} />
      {file && <p>{file.name}</p>}
    </div>
    <Button className="w-full" disabled={!file || busy || loadingProfile} onClick={analyze}>{busy ? 'Analisi e salvataggio…' : 'Analizza CV'}</Button>
  </div>;
}
