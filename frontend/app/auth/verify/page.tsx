'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type VerifyStatus = 'idle' | 'verifying' | 'success' | 'error';

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { verifyMagicLink } = useAuth();

  const [status, setStatus] = useState<VerifyStatus>(token ? 'idle' : 'error');
  const [error, setError] = useState(token ? '' : 'No token provided');

  // Token is consumed only when the user clicks "Sign in" — this keeps corp
  // inbox link-scanners (which only do GET) from invalidating the token
  // before the real user gets a chance to click.
  const handleSignIn = async () => {
    if (!token) return;
    setStatus('verifying');
    setError('');
    const rememberMe = JSON.parse(localStorage.getItem('rememberMe') || 'false');
    const result = await verifyMagicLink(token, rememberMe);
    if (result.success) {
      setStatus('success');
      localStorage.removeItem('rememberMe');
      setTimeout(() => router.push('/dashboard'), 1000);
    } else {
      setStatus('error');
      setError(result.error || 'Verification failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {status === 'idle' && 'Sign in to KPI System'}
            {status === 'verifying' && 'Signing you in…'}
            {status === 'success' && 'Success!'}
            {status === 'error' && 'Sign-in failed'}
          </CardTitle>
          <CardDescription>
            {status === 'idle' && 'Click the button below to complete sign-in.'}
            {status === 'verifying' && 'Please wait a moment.'}
            {status === 'success' && 'Redirecting you to the dashboard…'}
            {status === 'error' && error}
          </CardDescription>
        </CardHeader>

        {status === 'idle' && (
          <CardFooter>
            <Button className="w-full" onClick={handleSignIn}>
              Sign in
            </Button>
          </CardFooter>
        )}

        {status === 'verifying' && (
          <CardContent className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
          </CardContent>
        )}

        {status === 'success' && (
          <CardContent className="flex justify-center py-4">
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

        {status === 'error' && (
          <CardFooter>
            <Button className="w-full" onClick={() => router.push('/login')}>
              Back to login
            </Button>
          </CardFooter>
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
