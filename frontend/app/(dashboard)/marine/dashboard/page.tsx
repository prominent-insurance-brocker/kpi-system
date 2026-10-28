'use client';

import { MetabaseFrame } from '@/components/metabase-frame';
import { useAuth } from '@/app/context/AuthContext';
import { MARINE_DASHBOARD_MODULES } from '@/app/lib/navigation';

export default function MarineDashboardPage() {
  const { hasModulePermission } = useAuth();
  const canView = MARINE_DASHBOARD_MODULES.some((key) => hasModulePermission(key));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Marine Dashboard</h1>
        <p className="text-muted-foreground mt-1">Marine New and Renewal analytics</p>
      </div>
      {canView ? (
        <MetabaseFrame dashboard="marine" className="w-full h-[800px] rounded-lg" />
      ) : (
        <p className="text-muted-foreground">You do not have access to the Marine dashboard.</p>
      )}
    </div>
  );
}
