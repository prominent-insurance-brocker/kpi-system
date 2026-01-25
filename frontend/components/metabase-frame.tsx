'use client';

import { useEffect, useState } from 'react';

interface MetabaseFrameProps {
  dashboardId: number;
  className?: string;
}

export function MetabaseFrame({ dashboardId, className = "w-full h-[600px]" }: MetabaseFrameProps) {
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUrl() {
      try {
        const response = await fetch(`/api/metabase/token?dashboardId=${dashboardId}`);
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to fetch token');
        }
        const data = await response.json();
        setIframeUrl(data.url);
      } catch (err: unknown) {
        console.error('Error fetching Metabase URL:', err);
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
      }
    }

    if (dashboardId) {
      fetchUrl();
    }
  }, [dashboardId]);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-gray-50 border rounded-lg ${className}`}>
        <div className="text-center p-4">
          <p className="text-red-500 font-medium">Failed to load Dashboard</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!iframeUrl) {
    return (
      <div className={`flex items-center justify-center bg-gray-50 border rounded-lg animate-pulse ${className}`}>
        <div className="text-gray-400">Loading Dashboard...</div>
      </div>
    );
  }

  return (
    <iframe
      src={iframeUrl}
      className={`border-0 ${className}`}
      allowTransparency
    />
  );
}
