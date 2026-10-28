'use client';

import { MetabaseFrame } from '@/components/metabase-frame';
import { useAuth } from '@/app/context/AuthContext';
import { MARINE_DASHBOARD_MODULES } from '@/app/lib/navigation';

export default function MarineDashboardPage() {
  const { hasModulePermission } = useAuth();
  const canView = MARINE_DASHBOARD_MODULES.some((key) => hasModulePermission(key));

  if (!canView) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">You do not have access to the Marine dashboard.</p>
      </div>
    );
  }

  // Fill the area below the 4rem top header; Metabase shows its own title.
  return <MetabaseFrame dashboard="marine" className="block w-full h-[calc(100vh-4rem)]" />;
}
