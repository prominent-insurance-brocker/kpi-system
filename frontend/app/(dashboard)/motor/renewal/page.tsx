'use client';

import { KpiModulePage, BaseModuleEntry } from '@/app/components/KpiModulePage';

interface MotorRenewalEntry extends BaseModuleEntry {
  quotations: number;
  retention: number;
  tat: number;
  accuracy: number;
}

export default function MotorRenewalPage() {
  return (
    <KpiModulePage<MotorRenewalEntry>
      moduleKey="motor_renewal"
      apiSlug="motor-renewal"
      title="Motor Renewal"
      deptLabel="Motor Renewal DEPT."
      weeklyColumns={[
        { key: 'quotations', header: 'No. of quotes created' },
        { key: 'retention', header: 'No. of quotes converted' },
        { key: 'tat', header: 'TAT (In Days)' },
        { key: 'accuracy', header: 'Accuracy', render: (v) => `${v}%` },
      ]}
      dataColumns={[
        { key: 'quotations', header: 'No. of Quotes Created' },
        { key: 'retention', header: 'No. of Quotes Converted' },
        { key: 'tat', header: 'TAT (In Days)', render: (item) => String(item.tat) },
        { key: 'accuracy', header: 'Accuracy', render: (item) => `${item.accuracy}%` },
      ]}
      modalFields={[
        { key: 'quotations', label: 'No. of quotes created', min: 0 },
        { key: 'retention', label: 'No. of quotes converted', min: 0 },
        { key: 'tat', label: 'TAT (In Days)', min: 0 },
        { key: 'accuracy', label: 'Accuracy (%)', min: 0, max: 100, step: 0.01 },
      ]}
    />
  );
}
