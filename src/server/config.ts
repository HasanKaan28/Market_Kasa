/** Where the app's Supabase project is, from the build's environment. */
export type ServerConfig = { url: string; key: string };

type Env = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string };

/**
 * The server address and its publishable key, or null when the build has none. A secret or
 * service key is refused: everything in the app reaches every register, and such a key opens
 * every market's data.
 */
export function serverConfig(env: Env): ServerConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key || !url.startsWith('https://')) {
    return null;
  }
  if (key.startsWith('sb_secret_') || key.includes('service_role')) {
    console.warn(
      'Sunucu anahtarı gizli bir anahtar; uygulamaya yalnız yayımlanabilir anahtar konur.',
    );
    return null;
  }
  return { url, key };
}

/** This build's server, or null when it was built without one. */
export const SERVER: ServerConfig | null = serverConfig(import.meta.env as Env);
