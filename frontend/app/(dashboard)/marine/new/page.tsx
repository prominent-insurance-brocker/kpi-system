'use client';

import { KpiModulePage, BaseModuleEntry } from '@/app/components/KpiModulePage';
import { formatPremium, formatNumber } from '@/app/lib/number';

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
      weeklyColumns={[
        { key: 'gross_booked_premium', header: 'Gross booked premium', render: (v) => formatPremium(v as number | string | null | undefined) },
        { key: 'quotes_created', header: 'Quotes created', tooltip: 'Number of quotes created', render: (v) => formatNumber(v as number | string | null | undefined) },
        { key: 'new_clients_acquired', header: 'New clients acquired', tooltip: 'Number of new clients acquired', render: (v) => formatNumber(v as number | string | null | undefined) },
        { key: 'new_policies_issued', header: 'New policies issued', tooltip: 'Number of new policies issued', render: (v) => formatNumber(v as number | string | null | undefined) },
      ]}
      dataColumns={[
        { key: 'gross_booked_premium', header: 'Gross booked premium', render: (item) => formatPremium(item.gross_booked_premium) },
        { key: 'quotes_created', header: 'Quotes created', tooltip: 'Number of quotes created', render: (item) => formatNumber(item.quotes_created) },
        { key: 'new_clients_acquired', header: 'New clients acquired', tooltip: 'Number of new clients acquired', render: (item) => formatNumber(item.new_clients_acquired) },
        { key: 'new_policies_issued', header: 'New policies issued', tooltip: 'Number of new policies issued', render: (item) => formatNumber(item.new_policies_issued) },
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
