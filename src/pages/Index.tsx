import { AppLayout } from '@/components/layout/AppLayout';
import { useCVContext } from '@/contexts/CVContext';
import { CVUploader } from '@/components/cv/CVUploader';
import { CVSummary } from '@/components/cv/CVSummary';
import { CompanySearch } from '@/components/companies/CompanySearch';
import { EmailComposer } from '@/components/email/EmailComposer';
import { SentEmailsHistory } from '@/components/email/SentEmailsHistory';
import { AutoCampaignDashboard } from '@/components/auto/AutoCampaignDashboard';

export default function Index() {
  const { currentStep } = useCVContext();

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return <CVUploader />;
      case 1:
        return <CVSummary />;
      case 2:
        return <CompanySearch />;
      case 3:
        return <EmailComposer />;
      case 4:
        return <SentEmailsHistory />;
      case 5:
        return <AutoCampaignDashboard />;
      default:
        return <CVUploader />;
    }
  };

  return <AppLayout>{renderStepContent()}</AppLayout>;
}
