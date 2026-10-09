import type { ModelNoLookup } from '@/lib/modelNoLookup';

// One-line result of the Model No lookup, shown under the field.
export function ModelNoHint({ result }: { result: ModelNoLookup | null }) {
  if (!result) return null;
  const tone = result.status === 'FOUND' ? 'text-green-700' : result.status === 'INVALID' ? 'text-red-600' : 'text-amber-700';
  return <p className={`text-xs mt-1 ${tone}`}>{result.message}</p>;
}
