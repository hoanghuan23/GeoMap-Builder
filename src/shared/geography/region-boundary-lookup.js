export async function requestRegionBoundary(name, { country, placeType, signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl('/api/ai/resolve-region-boundary', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ name, country: country || null, placeType })
  });
  if (!response.ok) return null;
  return (await response.json())?.feature || null;
}
