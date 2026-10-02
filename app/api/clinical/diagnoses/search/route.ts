import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';

// A small mock database of common ICD-11 codes for demonstration
const MOCK_ICD11_DATABASE = [
  { code: '1A00', title: 'Cholera' },
  { code: '1F40', title: 'Malaria' },
  { code: '9B71', title: 'Essential hypertension' },
  { code: '5A10', title: 'Type 1 diabetes mellitus' },
  { code: 'CA23', title: 'Asthma' },
  { code: 'CA40', title: 'Pneumonia' },
  { code: '1A40', title: 'Typhoid fever' },
  { code: '1A07', title: 'Typhoid and paratyphoid fevers' },
  { code: 'DB10', title: 'Abdominal pain' },
  { code: 'MG30', title: 'Chronic pain' },
  { code: '6A70', title: 'Single episode depressive disorder' },
  { code: 'MA01', title: 'Fever of unknown origin' }
];

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').toLowerCase().trim();

  if (!query || query.length < 2) {
    return NextResponse.json({ items: [] });
  }

  // Fast, cached lookup (mocked here, in reality would use pg_trgm or Redis)
  const results = MOCK_ICD11_DATABASE.filter(item => 
    item.code.toLowerCase().includes(query) || 
    item.title.toLowerCase().includes(query)
  );

  return NextResponse.json(
    { items: results }, 
    { headers: { 'Cache-Control': 'public, max-age=3600' } } // Fast cached lookup
  );
}
