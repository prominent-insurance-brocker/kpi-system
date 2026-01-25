'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetabaseFrame } from '@/components/metabase-frame';
import { API_BASE_URL } from '@/app/lib/api';

interface DashboardStats {
  general_new: { total_quotations: number; total_converted: number };
  general_renewal: { total_quotations: number; total_converted: number };
  motor_new: { total_quotations: number };
  motor_renewal: { total_quotations: number; total_retention: number };
  motor_claim: { total_registered: number; total_closed: number; total_pending: number };
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // For now, show placeholder stats
    // In a full implementation, you'd fetch aggregated data from the backend
    setStats({
      general_new: { total_quotations: 0, total_converted: 0 },
      general_renewal: { total_quotations: 0, total_converted: 0 },
      motor_new: { total_quotations: 0 },
      motor_renewal: { total_quotations: 0, total_retention: 0 },
      motor_claim: { total_registered: 0, total_closed: 0, total_pending: 0 },
    });
    setIsLoading(false);
  }, []);

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-muted-foreground">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of KPI metrics</p>
      </div>

      {/* General Section */}
      <div>
        <h2 className="text-xl font-semibold mb-4">General</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className=' shadow-none'>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                General New - Quotations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.general_new.total_quotations || 0}</div>
            </CardContent>
          </Card>
          <Card className=' shadow-none'  >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                General New - Converted
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.general_new.total_converted || 0}</div>
            </CardContent>
          </Card>
          <Card className=' shadow-none'  >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                General Renewal - Quotations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.general_renewal.total_quotations || 0}</div>
            </CardContent>
          </Card>
          <Card className=' shadow-none'  >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                General Renewal - Converted
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.general_renewal.total_converted || 0}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Motor Section */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Motor</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className=' shadow-none'  >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Motor New - Quotations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.motor_new.total_quotations || 0}</div>
            </CardContent>
          </Card>
          <Card className=' shadow-none'  >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Motor Renewal - Quotations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.motor_renewal.total_quotations || 0}</div>
            </CardContent>
          </Card>
          <Card className=' shadow-none'  >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Motor Renewal - Retention
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.motor_renewal.total_retention || 0}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Claims Section */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Claims</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className=' shadow-none'  >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Registered Claims
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.motor_claim.total_registered || 0}</div>
            </CardContent>
          </Card>
          <Card className=' shadow-none'  >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Closed Claims
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {stats?.motor_claim.total_closed || 0}
              </div>
            </CardContent>
          </Card>
          <Card className=' shadow-none'  >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pending Cases
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {stats?.motor_claim.total_pending || 0}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      {/* Analytics Section */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Analytics</h2>
        <Card className="shadow-none border-none p-0">
          <CardContent className="p-0">
             <MetabaseFrame 
               dashboardId={parseInt(process.env.NEXT_PUBLIC_METABASE_DASHBOARD_ID || '1')} 
               className="w-full h-[800px] rounded-lg" 
             />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
