'use client';

import { KpiModulePage, BaseModuleEntry } from '@/app/components/KpiModulePage';

interface MarineNewEntry extends BaseModuleEntry {
  gross_booked_premium: number;
  quotes_created: number;
  new_clients_acquired: number;
  new_policies_issued: number;
}

export default function MarineNewPage() {
  return (
    <KpiModulePage<MarineNewEntry>
      moduleKey="marine_new"
      apiSlug="marine-new"
      title="Marine New"
      deptLabel="Marine New DEPT."
      weeklyColumns={[
        { key: 'gross_booked_premium', header: 'Gross booked premium' },
        { key: 'quotes_created', header: 'Quotes created' },
        { key: 'new_clients_acquired', header: 'New clients acquired' },
        { key: 'new_policies_issued', header: 'New policies issued' },
      ]}
      dataColumns={[
        { key: 'gross_booked_premium', header: 'Gross booked premium' },
        { key: 'quotes_created', header: 'Quotes created' },
        { key: 'new_clients_acquired', header: 'New clients acquired' },
        { key: 'new_policies_issued', header: 'New policies issued' },
      ]}
      modalFields={[
        { key: 'gross_booked_premium', label: 'Gross booked premium', min: 0, step: 0.01 },
        { key: 'quotes_created', label: 'Quotes created', min: 0 },
        { key: 'new_clients_acquired', label: 'New clients acquired', min: 0 },
        { key: 'new_policies_issued', label: 'New policies issued', min: 0 },
      ]}
    />
  );
}
