'use client';

import { KpiModulePage, BaseModuleEntry } from '@/app/components/KpiModulePage';
import { formatPremium, formatNumber } from '@/app/lib/number';

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
      weeklyColumns={[
        { key: 'monthly_renewal_quotes_assigned', header: 'Monthly renewal quotes assigned', render: (v) => formatNumber(v as number | string | null | undefined) },
        { key: 'gross_booked_premium', header: 'Gross booked premium', render: (v) => formatPremium(v as number | string | null | undefined) },
        { key: 'quotes_created', header: 'Quotes created', render: (v) => formatNumber(v as number | string | null | undefined) },
        { key: 'renewal_policies_issued', header: 'Renewal policies issued', render: (v) => formatNumber(v as number | string | null | undefined) },
      ]}
      dataColumns={[
        { key: 'monthly_renewal_quotes_assigned', header: 'Monthly renewal quotes assigned', render: (item) => formatNumber(item.monthly_renewal_quotes_assigned) },
        { key: 'gross_booked_premium', header: 'Gross booked premium', render: (item) => formatPremium(item.gross_booked_premium) },
        { key: 'quotes_created', header: 'Quotes created', render: (item) => formatNumber(item.quotes_created) },
        { key: 'renewal_policies_issued', header: 'Renewal policies issued', render: (item) => formatNumber(item.renewal_policies_issued) },
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
