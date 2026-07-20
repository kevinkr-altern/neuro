const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
export async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}/api${path}`, options);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export { BASE };
