import React from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { aiAgent } from '@/lib/api/ai-agent';
import { useAuth } from '@/hooks/useAuth';
import { requireUid } from '@/lib/api/client';
import { Plus, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';

interface ManualAddModalProps {
  onSuccess: () => void;
}

export function ManualAddModal({ onSuccess }: ManualAddModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [formData, setFormData] = useState({
    companyName: '',
    email: '',
    subject: 'Candidatura per posizione aperta',
    sentAt: new Date().toISOString().slice(0, 16), // YYYY-MM-DDThh:mm
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    
    setIsLoading(true);
    try {
      const activeUserId = requireUid(user.id);
      
      const res = await aiAgent.addManualSentEmail(activeUserId, {
        companyName: formData.companyName,
        email: formData.email,
        subject: formData.subject,
        sentAt: new Date(formData.sentAt).toISOString(),
        body: formData.notes,
      });

      if (!res.success) {
        throw new Error(res.error);
      }

      toast({
        title: 'Aggiunto con successo',
        description: 'L\'email è stata aggiunta allo storico.',
      });

      setOpen(false);
      onSuccess(); // Refresh the list
      
      // Reset form
      setFormData({
        companyName: '',
        email: '',
        subject: 'Candidatura per posizione aperta',
        sentAt: new Date().toISOString().slice(0, 16),
        notes: '',
      });
    } catch (err: any) {
      toast({
        title: 'Errore',
        description: err.message || 'Errore durante l\'aggiunta manuale',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="shrink-0 shadow-sm">
          <Plus className="h-4 w-4 mr-2" />
          Aggiungi manualmente
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Aggiungi Invio Manuale</DialogTitle>
          <DialogDescription>
            Inserisci i dettagli di un'email che hai inviato manualmente per aggiungerla al tuo storico.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="companyName">Nome Azienda *</Label>
            <Input
              id="companyName"
              name="companyName"
              placeholder="Es. ACME Corp"
              required
              value={formData.companyName}
              onChange={handleChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email Destinatario *</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="hr@azienda.com"
              required
              value={formData.email}
              onChange={handleChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subject">Oggetto *</Label>
            <Input
              id="subject"
              name="subject"
              required
              value={formData.subject}
              onChange={handleChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sentAt">Data e Ora di Invio *</Label>
            <Input
              id="sentAt"
              name="sentAt"
              type="datetime-local"
              required
              value={formData.sentAt}
              onChange={handleChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Note opzionali</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Breve nota sull'invio o sul contenuto..."
              value={formData.notes}
              onChange={handleChange}
              className="resize-none"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isLoading}>
              Annulla
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salva Record
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
