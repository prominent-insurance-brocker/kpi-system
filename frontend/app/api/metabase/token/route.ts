import { NextResponse } from 'next/server';
import { signMetabaseToken, getMetabaseEmbedUrl } from '@/lib/metabase';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const dashboardId = searchParams.get('dashboardId');

    if (!dashboardId) {
        return NextResponse.json({ error: 'Dashboard ID is required' }, { status: 400 });
    }

    try {
        // In a real app, you might validate if the current user has access to this dashboard
        const id = parseInt(dashboardId, 10);
        const token = signMetabaseToken(id, {});
        const url = getMetabaseEmbedUrl(token);

        return NextResponse.json({ url });
    } catch (error: unknown) {
        console.error('Sign Metabase token error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to sign token';
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}
