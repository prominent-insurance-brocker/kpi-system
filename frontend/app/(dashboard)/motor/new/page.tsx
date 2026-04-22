'use client';

import { KpiModulePage, BaseModuleEntry } from '@/app/components/KpiModulePage';

interface MotorNewEntry extends BaseModuleEntry {
  quotations: number;
  quotes_revised: number;
  quotes_converted: number;
  tat: number;
  accuracy: number;
}

export default function MotorNewPage() {
  return (
    <KpiModulePage<MotorNewEntry>
      moduleKey="motor_new"
      apiSlug="motor-new"
      title="Motor New"
      deptLabel="Motor New DEPT."
      weeklyColumns={[
        { key: 'quotations', header: 'Quotes created' },
        { key: 'quotes_converted', header: 'Quotes converted' },
        { key: 'quotes_revised', header: 'Quotes revised' },
        { key: 'tat', header: 'TAT' },
        { key: 'accuracy', header: 'Accuracy', render: (v) => `${v}%` },
      ]}
      dataColumns={[
        { key: 'quotations', header: 'Quotes created' },
        { key: 'quotes_converted', header: 'Quotes converted' },
        { key: 'quotes_revised', header: 'Quotes revised' },
        { key: 'tat', header: 'TAT', render: (item) => String(item.tat) },
        { key: 'accuracy', header: 'Accuracy', render: (item) => `${item.accuracy}%` },
      ]}
      modalFields={[
        { key: 'quotations', label: 'Quotations', min: 0 },
        { key: 'quotes_revised', label: 'Quotes revised', min: 0 },
        { key: 'quotes_converted', label: 'Quotes converted', min: 0 },
        { key: 'tat', label: 'TAT', min: 0 },
        { key: 'accuracy', label: 'Accuracy (%)', min: 0, max: 100, step: 0.01 },
      ]}
    />
  );
}
