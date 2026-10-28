'use client';

import { useEffect, useState } from 'react';
import { getMetabaseEmbedUrl, MetabaseDashboardName } from '@/app/lib/api';

interface MetabaseFrameProps {
  dashboard: MetabaseDashboardName;
  className?: string;
}

export function MetabaseFrame({ dashboard, className = "w-full h-[600px]" }: MetabaseFrameProps) {
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The backend signs the embed token after checking login + module access,
    // so the Metabase secret never reaches the browser or the Next server.
    getMetabaseEmbedUrl(dashboard).then(({ data, error: apiError }) => {
      if (cancelled) return;
      if (data?.url) {
        setIframeUrl(data.url);
      } else {
        setError(apiError || 'Failed to load dashboard');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dashboard]);

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
