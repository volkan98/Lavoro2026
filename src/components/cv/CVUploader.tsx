import * as React from 'react';
import { useCallback, useState, useEffect } from 'react';
import { Upload, FileText, X, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useCVContext } from '@/contexts/CVContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { aiAgent } from '@/lib/api/ai-agent';
import { useToast } from '@/hooks/use-toast';
import { normalizeCvData } from '@/lib/cvNormalizer';
import * as pdfjsLib from 'pdfjs-dist';

// Dynamically match the pdfjs worker version to avoid version mismatch errors
if (typeof window !== 'undefined') {
  try {
    const version = pdfjsLib.version || '6.3.289';
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
  } catch (e) {
    console.warn('Could not set pdfjs workerSrc:', e);
  }
}

export function CVUploader() {
  const { cvData, setCvFile, setCvData, setSintesiBreve, setSintesiCompleta, setCurrentStep } = useCVContext();
  const { profile, cvParsedData, isLoading: isProfileLoading, hasSavedCV, hasSavedProfile, getCVDataFromProfile, uploadCV, saveProfile } = useUserProfile();
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Load saved CV data on mount ONLY if current context is empty
  useEffect(() => {
    const hasCurrentData = !!(cvData && (cvData.nome || (cvData.esperienze && cvData.esperienze.length > 0)));
    if (!hasCurrentData) {
      if (cvParsedData && (cvParsedData.nome || cvParsedData.esperienze?.length)) {
        const normalized = normalizeCvData(cvParsedData);
        setCvData(normalized);
        if (normalized.sintesiBreve) setSintesiBreve(normalized.sintesiBreve);
        if (normalized.sintesiCompleta) setSintesiCompleta(normalized.sintesiCompleta);
      } else if (profile && (hasSavedCV || hasSavedProfile)) {
        const fallbackCv = getCVDataFromProfile();
        if (fallbackCv && (fallbackCv.nome || fallbackCv.email)) {
          setCvData(fallbackCv);
          if (profile.cv_short_summary) setSintesiBreve(profile.cv_short_summary);
          if (profile.cv_full_summary) setSintesiCompleta(profile.cv_full_summary);
        }
      }
    }
  }, [cvData, cvParsedData, profile, hasSavedCV, hasSavedProfile, getCVDataFromProfile, setCvData, setSintesiBreve, setSintesiCompleta]);

  const handleUseSavedCV = () => {
    const sourceData = (cvData && (cvData.esperienze?.length || cvData.nome))
      ? cvData
      : (cvParsedData || getCVDataFromProfile());

    if (sourceData) {
      const normalized = normalizeCvData(sourceData);
      setCvData(normalized);
      if (normalized.sintesiBreve || profile?.cv_short_summary) {
        setSintesiBreve(normalized.sintesiBreve || profile?.cv_short_summary || '');
      }
      if (normalized.sintesiCompleta || profile?.cv_full_summary) {
        setSintesiCompleta(normalized.sintesiCompleta || profile?.cv_full_summary || '');
      }
      toast({
        title: 'CV attivo pronto',
        description: 'I dati estratti dal tuo CV sono caricati e pronti per le candidature.',
      });
      setCurrentStep(1);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const validateFile = (file: File): boolean => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const validExtensions = ['pdf', 'docx', 'doc', 'txt'];
    const validTypes = [
      'application/pdf',
      'application/x-pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
    ];
    
    if (!validTypes.includes(file.type) && !validExtensions.includes(ext)) {
      setError('Formato non supportato. Carica un file PDF, DOCX o TXT.');
      return false;
    }
    
    if (file.size > 15 * 1024 * 1024) {
      setError('Il file è troppo grande. Dimensione massima: 15MB.');
      return false;
    }
    
    return true;
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setError(null);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && validateFile(droppedFile)) {
      setFile(droppedFile);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const selectedFile = e.target.files?.[0];
    if (selectedFile && validateFile(selectedFile)) {
      setFile(selectedFile);
    }
  }, []);

  const handleRemoveFile = () => {
    setFile(null);
    setError(null);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const timer = setTimeout(() => reject(new Error('Timeout nella lettura del file')), 5000);
      reader.onload = () => {
        clearTimeout(timer);
        const result = reader.result as string;
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = () => {
        clearTimeout(timer);
        reject(reader.error);
      };
      reader.readAsDataURL(file);
    });
  };

  // Ultra-fast PDF text extraction with strict timeout and fallback
  const extractTextFromPDF = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();

      // 1. Instant regex extraction directly from arrayBuffer (no workers, no network)
      try {
        const bytes = new Uint8Array(arrayBuffer);
        const str = new TextDecoder('latin1').decode(bytes);
        const matches = str.match(/\(([^()]{2,120})\)\s*Tj/g) || [];
        if (matches.length > 15) {
          const extracted = matches.map((m) => m.replace(/^\(|\)\s*Tj$/g, '')).join(' ');
          if (extracted.length > 80) {
            return extracted.trim();
          }
        }
      } catch (e) {
        // fallback
      }

      // 2. Client-side PDF.js with strict 2000ms race timeout
      const parseTask = async (): Promise<string> => {
        try {
          const pdfTask = pdfjsLib.getDocument({ data: arrayBuffer });
          const pdf: any = await pdfTask.promise;
          let fullText = '';
          const maxPages = Math.min(pdf.numPages || 1, 3);
          for (let i = 1; i <= maxPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
              .map((item: any) => item.str)
              .join(' ');
            fullText += pageText + '\n\n';
          }
          return fullText.trim();
        } catch {
          return '';
        }
      };

      const timeoutPromise = new Promise<string>((resolve) => setTimeout(() => resolve(''), 2000));
      return await Promise.race([parseTask(), timeoutPromise]);
    } catch (error) {
      console.warn('PDF client extraction skipped, fallback to server:', error);
      return '';
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    
    setIsLoading(true);
    setLoadingStep('Lettura documento ed estrazione testo...');
    setError(null);
    
    try {
      const executeAnalysis = async () => {
        let result;
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const isPdf = file.type === 'application/pdf' || file.type === 'application/x-pdf' || ext === 'pdf';
        const isText = file.type === 'text/plain' || ext === 'txt';
        
        if (isText) {
          const text = await file.text();
          setLoadingStep('Analisi competenze e sintesi con Gemini AI...');
          result = await aiAgent.parseCV(text);
        } else if (isPdf) {
          const pdfText = await extractTextFromPDF(file);
          setLoadingStep('Analisi competenze e sintesi con Gemini AI...');
          if (pdfText && pdfText.length > 50) {
            result = await aiAgent.parseCV(pdfText.substring(0, 8000));
          } else {
            const base64Data = await fileToBase64(file);
            result = await aiAgent.parseCV({
              base64Data,
              mimeType: 'application/pdf',
              fileName: file.name,
            });
          }
        } else {
          // DOCX / Word / Other document formats
          const text = await file.text().catch(() => '');
          const cleanText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          setLoadingStep('Analisi competenze e sintesi con Gemini AI...');
          if (cleanText.length > 50) {
            result = await aiAgent.parseCV(cleanText.substring(0, 8000));
          } else {
            const base64Data = await fileToBase64(file);
            result = await aiAgent.parseCV({
              base64Data,
              mimeType: file.type || 'application/octet-stream',
              fileName: file.name,
            });
          }
        }
        
        if (!result || !result.success || !result.data) {
          throw new Error(result?.error || 'Errore durante l\'analisi del CV');
        }
        
        setLoadingStep('Salvataggio profilo e configurazione Permesso G...');

        const parsedData = normalizeCvData(result.data);
        
        setCvFile(file);
        setCvData(parsedData);
        setSintesiBreve(parsedData.sintesiBreve || result.data.sintesiBreve || '');
        setSintesiCompleta(parsedData.sintesiCompleta || result.data.sintesiCompleta || '');

        // Persist permanently in profile, Firestore users/{uid} and storage
        await uploadCV(file).catch((e) => console.warn('Background uploadCV error:', e));
        await saveProfile(
          parsedData,
          parsedData.sintesiBreve || result.data.sintesiBreve || '',
          parsedData.sintesiCompleta || result.data.sintesiCompleta || ''
        ).catch((e) => console.warn('Background saveProfile error:', e));
        
        toast({
          title: 'CV analizzato con successo!',
          description: 'I dati sono stati estratti e salvati nel tuo profilo.',
        });
        
        setCurrentStep(1);
      };

      // 35s watchdog guarantee to ensure the UI never spins indefinitely
      const watchdog = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Tempo di elaborazione scaduto. Riprova con un altro formato o testo.')), 35000)
      );

      await Promise.race([executeAnalysis(), watchdog]);
    } catch (err: any) {
      console.error('Error analyzing CV:', err);
      setError(err.message || 'Errore durante l\'analisi del CV. Riprova.');
      toast({
        title: 'Errore',
        description: err.message || 'Errore durante l\'analisi del CV.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  if (isProfileLoading) {
    return (
      <div className="max-w-2xl mx-auto flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground">
          Carica il tuo CV
        </h2>
        <p className="text-muted-foreground">
          Trascina il tuo CV in formato PDF o DOCX per iniziare
        </p>
      </div>

      {/* Prominent Saved CV Card when user already has a saved CV or profile */}
      {(hasSavedCV || hasSavedProfile) && profile && (
        <Card className="border-primary/40 bg-card shadow-sm overflow-hidden">
          <div className="bg-primary/10 border-b border-primary/20 px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <span className="font-semibold text-foreground text-sm">
                Curriculum Vitae Attivo & Salvato
              </span>
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
              Pronto all'uso
            </span>
          </div>

          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Candidato</p>
                <p className="font-semibold text-foreground text-base">
                  {profile.full_name || 'Profilo Utente'}
                </p>
                <p className="text-xs text-muted-foreground">{profile.city || ''}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Stato Frontalieri</p>
                <p className="font-medium text-emerald-600 dark:text-emerald-400">
                  🇨🇭 {profile.permesso_g || 'Permesso G (Frontalieri Svizzera) Pronto'}
                </p>
              </div>
            </div>

            {profile.skills && profile.skills.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Competenze Principali</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.skills.slice(0, 6).map((skill, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-muted text-muted-foreground rounded text-xs"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {profile.cv_short_summary && (
              <div className="p-3 bg-muted/40 rounded-lg text-xs text-muted-foreground line-clamp-3">
                {profile.cv_short_summary}
              </div>
            )}

            <div className="pt-2 flex flex-wrap gap-2.5">
              <Button
                id="btn-use-saved-cv-summary"
                onClick={handleUseSavedCV}
                className="flex-1 min-w-[180px]"
              >
                <FileText className="h-4 w-4 mr-2" />
                Vai alla Sintesi CV
              </Button>
              <Button
                id="btn-use-saved-cv-search"
                variant="secondary"
                onClick={() => {
                  handleUseSavedCV();
                  setCurrentStep(2);
                }}
                className="flex-1 min-w-[180px]"
              >
                Trova Aziende
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-3 text-muted-foreground font-medium">
            {(hasSavedCV || hasSavedProfile) ? 'Oppure carica un nuovo file per aggiornarlo' : 'Carica File CV'}
          </span>
        </div>
      </div>

      <Alert className="bg-primary/5 border-primary/20">
        <AlertCircle className="h-4 w-4 text-primary" />
        <AlertDescription className="text-sm">
          <strong>Privacy:</strong> Il tuo CV contiene dati personali. I file vengono elaborati in modo sicuro e non vengono condivisi con terze parti.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="p-6">
          {!file ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                'border-2 border-dashed rounded-xl p-8 md:p-12 transition-all duration-200 text-center',
                isDragging
                  ? 'border-primary bg-primary/5 scale-[1.02]'
                  : 'border-border hover:border-primary/50 hover:bg-accent/50'
              )}
            >
              <div className="flex flex-col items-center gap-4">
                <div className={cn(
                  'p-4 rounded-full transition-colors',
                  isDragging ? 'bg-primary/20' : 'bg-accent'
                )}>
                  <Upload className={cn(
                    'h-10 w-10 transition-colors',
                    isDragging ? 'text-primary' : 'text-muted-foreground'
                  )} />
                </div>
                
                <div className="space-y-2">
                  <p className="text-lg font-medium text-foreground">
                    Trascina qui il tuo CV
                  </p>
                  <p className="text-sm text-muted-foreground">
                    oppure
                  </p>
                </div>

                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".pdf,.docx,.doc,.txt"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button variant="outline" asChild>
                    <span>Seleziona file</span>
                  </Button>
                </label>

                <p className="text-xs text-muted-foreground">
                  Formati supportati: PDF, DOCX, TXT • Max 10MB
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-accent rounded-lg">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <FileText className="h-8 w-8 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {file.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRemoveFile}
                  className="shrink-0"
                  disabled={isLoading}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <Button
                id="btn-analyze-cv"
                onClick={handleAnalyze}
                disabled={isLoading}
                className="w-full relative overflow-hidden"
                size="lg"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary-foreground" />
                    <span className="font-medium text-sm">
                      {loadingStep || 'Analisi AI in corso...'}
                    </span>
                  </div>
                ) : (
                  'Analizza CV con AI'
                )}
              </Button>
            </div>
          )}

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
