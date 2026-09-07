// Renseigner ici les identifiants du projet Supabase.
// IMPORTANT : uniquement la clé "anon / public" ici — jamais la clé "service_role".
// La clé anon est sans danger à exposer côté client : les policies RLS définies
// dans db/schema.sql limitent ce qu'elle peut faire (lecture des paramètres,
// insertion de réponses uniquement — pas de lecture ni modification des réponses).

const SUPABASE_CONFIG = {
  url: "https://cbvelxokfpbvtdrbmamd.supabase.co",
  anonKey: "sb_publishable_r9_tC1MN9A4u-oa4n72uUQ_h3p2afrZ"
};
