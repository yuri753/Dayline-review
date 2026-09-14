export function supabaseConfig() {
  return {url: import.meta.env?.VITE_SUPABASE_URL, key: import.meta.env?.VITE_SUPABASE_ANON_KEY};
}

export function videoConfig() {
  return {
    keyId: import.meta.env?.VITE_B2_KEY_ID,
    applicationKey: import.meta.env?.VITE_B2_APPLICATION_KEY,
    endpoint: import.meta.env?.VITE_B2_ENDPOINT,
    bucket: import.meta.env?.VITE_B2_BUCKET,
    publicBaseUrl: import.meta.env?.VITE_B2_PUBLIC_BASE_URL,
    supabaseUrl: import.meta.env?.VITE_SUPABASE_URL,
    supabaseKey: import.meta.env?.VITE_SUPABASE_ANON_KEY,
  };
}

