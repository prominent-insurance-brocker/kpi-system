'use client';

import { KpiModulePage, BaseModuleEntry } from '@/app/components/KpiModulePage';

interface GeneralRenewalEntry extends BaseModuleEntry {
  quotations: number;
  quotes_revised: number;
  quotes_converted: number;
  tat: number;
  accuracy: number;
}

export default function GeneralRenewalPage() {
  return (
    <KpiModulePage<GeneralRenewalEntry>
      moduleKey="general_renewal"
      apiSlug="general-renewal"
      title="General Renewal"
      deptLabel="General Renewal DEPT."
      weeklyColumns={[
        { key: 'quotations', header: 'No. of Quotes Created' },
        { key: 'quotes_converted', header: 'No. of Quotes Converted' },
        { key: 'quotes_revised', header: 'No. of Quotes Revised' },
        { key: 'tat', header: 'TAT' },
        { key: 'accuracy', header: 'Accuracy', render: (v) => `${v}%` },
      ]}
      dataColumns={[
        { key: 'quotations', header: 'No. of Quotes Created' },
        { key: 'quotes_converted', header: 'No. of Quotes Converted' },
        { key: 'quotes_revised', header: 'No. of Quotes Revised' },
        { key: 'tat', header: 'TAT', render: (item) => String(item.tat) },
        { key: 'accuracy', header: 'Accuracy', render: (item) => `${item.accuracy}%` },
      ]}
      modalFields={[
        { key: 'quotations', label: 'No. of Quotes Created', min: 0 },
        { key: 'quotes_revised', label: 'No. of Quotes Revised', min: 0 },
        { key: 'quotes_converted', label: 'No. of Quotes Converted', min: 0 },
        { key: 'tat', label: 'TAT', min: 0 },
        { key: 'accuracy', label: 'Accuracy (%)', min: 0, max: 100, step: 0.01 },
      ]}
    />
  );
}
