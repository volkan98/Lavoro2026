import { useUserProfile } from '@/hooks/useUserProfile';
import * as React from 'react';
import { Check, Upload, FileText, Building2, Mail, History, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCVContext } from '@/contexts/CVContext';

interface Step {
  id: number;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

const steps: Step[] = [
  { id: 0, label: 'Carica CV', shortLabel: 'CV', icon: Upload },
  { id: 1, label: 'Sintesi CV', shortLabel: 'Sintesi', icon: FileText },
  { id: 2, label: 'Trova Aziende', shortLabel: 'Aziende', icon: Building2 },
  { id: 3, label: 'Email & Invio', shortLabel: 'Email', icon: Mail },
  { id: 4, label: 'Già Inviato', shortLabel: 'Inviati', icon: History },
  { id: 5, label: 'Auto Mode', shortLabel: 'Auto', icon: Rocket },
];

interface StepIndicatorProps {
  currentStep: number;
  onStepClick?: (step: number) => void;
}

export function StepIndicator({ currentStep, onStepClick }: StepIndicatorProps) {
  const { cvData, cvFileState, sintesiBreve, aziendeSelezionate, logInvii } = useCVContext();

  const { hasSavedCV } = useUserProfile();
  // Determine actual completion of each step
  const isStepCompleted = (stepId: number): boolean => {
    switch (stepId) {
      case 0:
        return hasSavedCV;
      case 1:
        return Boolean(sintesiBreve || cvData?.profilo || (cvData?.competenze && cvData.competenze.length > 0));
      case 2:
        return Boolean(aziendeSelezionate && aziendeSelezionate.length > 0);
      case 3:
        return Boolean(logInvii && logInvii.length > 0);
      case 4:
        return Boolean(logInvii && logInvii.length > 0);
      case 5:
        return false;
      default:
        return false;
    }
  };

  const activeStep = steps.find((s) => s.id === currentStep) || steps[0];

  return (
    <nav aria-label="Navigazione Workflow" className="w-full bg-muted/20 border-t border-border/50 py-1.5 px-2 sm:px-4">
      <div className="max-w-4xl mx-auto">
        {/* Step Navigation Bar */}
        <ol className="grid grid-cols-6 gap-1 sm:gap-2">
          {steps.map((step) => {
            const isCurrent = currentStep === step.id;
            const completed = isStepCompleted(step.id);
            const Icon = step.icon;

            return (
              <li key={step.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onStepClick?.(step.id)}
                  title={`Vai alla fase ${step.id + 1}: ${step.label}${completed ? ' (Completata)' : ''}`}
                  className={cn(
                    'w-full flex items-center justify-center gap-1.5 sm:gap-2 px-1.5 sm:px-2.5 py-1.5 sm:py-2 rounded-lg text-xs font-medium transition-all min-h-[44px] cursor-pointer select-none',
                    isCurrent
                      ? 'bg-primary text-primary-foreground shadow-xs font-semibold ring-1 ring-primary/20'
                      : completed
                      ? 'bg-card text-foreground border border-border/70 hover:bg-muted/70 hover:border-primary/40'
                      : 'bg-card/50 text-muted-foreground border border-border/40 hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  <div className="relative shrink-0 flex items-center justify-center">
                    <Icon className={cn('h-4 w-4', isCurrent ? 'text-primary-foreground' : completed ? 'text-primary' : 'text-muted-foreground')} />
                    {completed && !isCurrent && (
                      <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-green-500 ring-1 ring-background">
                        <Check className="h-1.5 w-1.5 text-white stroke-[3]" />
                      </span>
                    )}
                  </div>

                  {/* Responsive Text: Short on small screens, full on tablet/desktop */}
                  <span className="truncate hidden md:inline">
                    {step.label}
                  </span>
                  <span className="truncate hidden sm:inline md:hidden text-[11px]">
                    {step.shortLabel}
                  </span>
                  <span className="truncate inline sm:hidden text-[10px] leading-tight">
                    {step.shortLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Mobile active indicator bar: clear orientation, zero clutter */}
        <div className="flex items-center justify-between mt-1 px-1 sm:hidden text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary" />
            Fase {activeStep.id + 1}: {activeStep.label}
          </span>
          <span className="text-[10px] text-muted-foreground/80">
            Tutti gli step liberi
          </span>
        </div>
      </div>
    </nav>
  );
}
