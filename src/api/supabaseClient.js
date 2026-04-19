import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
        '[supabaseClient] MISSING ENV VARS: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY are not set. ' +
        'Check your .env file or Netlify environment settings.'
    )
}

// Use placeholder values so createClient doesn't throw at import time —
// any actual DB call will fail gracefully with an auth error rather than
// crashing the entire React app with a white screen.
export const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder-key'
)
