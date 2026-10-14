// Default cloud configuration: blank, so the app runs fully local (no accounts; data stays in this browser).
// To enable accounts and sync, create `config.local.js` next to this file (it is git-ignored) with:
//   export default { supabaseUrl: 'https://<ref>.supabase.co', supabaseAnonKey: '<anon public key>', oauthProviders: ['google'] };
// The anon key is public by design (row-level security protects the data) but keep it out of public repos so
// strangers cannot sign up to your project. NEVER use the service_role key anywhere in this app.
export default {
  supabaseUrl: '',
  supabaseAnonKey: '',
  oauthProviders: [],        // e.g. ['google', 'github'] once enabled in Supabase → Authentication → Providers
};
