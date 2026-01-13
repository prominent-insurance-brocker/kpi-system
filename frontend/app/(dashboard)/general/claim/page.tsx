'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function GeneralClaimPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">General Claim</h1>
        <p className="text-muted-foreground">Manage general claims</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming Soon</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            The General Claim module is currently under development. Please check back later.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
