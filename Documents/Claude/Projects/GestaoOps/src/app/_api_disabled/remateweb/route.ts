import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'https://test.api-net9.remateweb.com';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get('endpoint') || '/api/auction';

  // Build the external URL with all query params except 'endpoint'
  const externalUrl = new URL(`${API_BASE_URL}${endpoint}`);
  searchParams.forEach((value, key) => {
    if (key !== 'endpoint') {
      externalUrl.searchParams.set(key, value);
    }
  });

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    // Forward auth token if present
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const res = await fetch(externalUrl.toString(), { headers });

    if (!res.ok) {
      return NextResponse.json(
        { error: `API responded with ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from RemateWeb API' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get('endpoint') || '/token';
  const externalUrl = `${API_BASE_URL}${endpoint}`;

  try {
    const body = await request.formData();
    const res = await fetch(externalUrl, {
      method: 'POST',
      body,
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Auth failed: ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Proxy auth error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}
