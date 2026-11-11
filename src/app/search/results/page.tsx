'use client';

import HomePage from '@/app/page';

/**
 * Dedicated search-results URL.
 * Reuse the existing cross-source aggregation, 60-item pagination and movie cards
 * so search behavior stays consistent instead of introducing a second data pipeline.
 */
export default function SearchResultsPage() {
  return <HomePage />;
}
