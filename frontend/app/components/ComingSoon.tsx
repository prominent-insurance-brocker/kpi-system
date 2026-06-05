'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Reusable "Coming Soon" placeholder shown on routes whose modules are
// configured in RoleModulePermission.MODULE_CHOICES but whose data-entry
// surface isn't built yet. Mirrors the layout of general/claim/page.tsx so
// every placeholder reads the same way.
export interface ComingSoonProps {
  title: string;
  subtitle?: string;
  moduleLabel?: string;
}

export function ComingSoon({ title, subtitle, moduleLabel }: ComingSoonProps) {
  const label = moduleLabel ?? title;
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming Soon</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            The {label} module is currently under development. Please check back
            later.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
