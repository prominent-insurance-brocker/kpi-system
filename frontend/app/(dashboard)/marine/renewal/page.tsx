'use client';

import { KpiModulePage, BaseModuleEntry } from '@/app/components/KpiModulePage';

interface MarineRenewalEntry extends BaseModuleEntry {
  monthly_renewal_quotes_assigned: number;
  gross_booked_premium: number;
  quotes_created: number;
  renewal_policies_issued: number;
}

export default function MarineRenewalPage() {
  return (
    <KpiModulePage<MarineRenewalEntry>
      moduleKey="marine_renewal"
      apiSlug="marine-renewal"
      title="Marine Renewal"
      deptLabel="Marine Renewal DEPT."
      weeklyColumns={[
        { key: 'monthly_renewal_quotes_assigned', header: 'Monthly renewal quotes assigned' },
        { key: 'gross_booked_premium', header: 'Gross booked premium' },
        { key: 'quotes_created', header: 'Quotes created' },
        { key: 'renewal_policies_issued', header: 'Renewal policies issued' },
      ]}
      dataColumns={[
        { key: 'monthly_renewal_quotes_assigned', header: 'Monthly renewal quotes assigned' },
        { key: 'gross_booked_premium', header: 'Gross booked premium' },
        { key: 'quotes_created', header: 'Quotes created' },
        { key: 'renewal_policies_issued', header: 'Renewal policies issued' },
      ]}
      modalFields={[
        { key: 'monthly_renewal_quotes_assigned', label: 'Monthly renewal quotes assigned', min: 0 },
        { key: 'gross_booked_premium', label: 'Gross booked premium', min: 0, step: 0.01 },
        { key: 'quotes_created', label: 'Quotes created', min: 0 },
        { key: 'renewal_policies_issued', label: 'Renewal policies issued', min: 0 },
      ]}
    />
  );
}
