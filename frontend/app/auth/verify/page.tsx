'use client';

import { useEffect, useState, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { verifyMagicLink } = useAuth();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState('');

  const verificationAttempted = useRef(false);

  useEffect(() => {
    const verify = async () => {
      if (!token) {
        setStatus('error');
        setError('No token provided');
        return;
      }

      // Prevent double execution in Strict Mode
      if (verificationAttempted.current) return;
      verificationAttempted.current = true;

      // Get rememberMe preference from localStorage
      const rememberMe = JSON.parse(localStorage.getItem('rememberMe') || 'false');

      const result = await verifyMagicLink(token, rememberMe);

      if (result.success) {
        setStatus('success');
        // Clean up localStorage
        localStorage.removeItem('rememberMe');
        // Redirect to dashboard after a short delay
        setTimeout(() => router.push('/dashboard'), 1500);
      } else {
        setStatus('error');
        setError(result.error || 'Verification failed');
      }
    };

    verify();
  }, [token, verifyMagicLink, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {status === 'verifying' && 'Verifying...'}
            {status === 'success' && 'Success!'}
            {status === 'error' && 'Verification Failed'}
          </CardTitle>
          <CardDescription>
            {status === 'verifying' && 'Please wait while we verify your link'}
            {status === 'success' && 'Redirecting you to the dashboard...'}
            {status === 'error' && error}
          </CardDescription>
        </CardHeader>
        {status === 'error' && (
          <CardContent>
            <Button className="w-full" onClick={() => router.push('/login')}>
              Back to login
            </Button>
          </CardContent>
        )}
        {status === 'verifying' && (
          <CardContent className="flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </CardContent>
        )}
        {status === 'success' && (
          <CardContent className="flex justify-center">
            <div className="text-green-600">
              <svg
                className="h-12 w-12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

export default function VerifyMagicLinkPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-gray-600">Loading...</div>
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
