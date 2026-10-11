"use strict";

/* Le mot de passe est vérifié côté base (fonction verifier_mot_de_passe_bilan)
   et se change depuis le logiciel d'administration. Un frein, pas un coffre-fort. */

const CHART_COLORS = ["#1E4591", "#268AE9", "#6FA8DC", "#9FC5E8", "#C9DAF8", "#B4802F", "#D9A566", "#7FB3D5"];

const Supa = {
  headers() {
    return { "apikey": SUPABASE_CONFIG.anonKey, "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}` };
  },
  async select(table, query) {
    const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${table}?${query}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Lecture impossible (${table})`);
    return res.json();
  }
};

const refs = { typesFormation: [], etablissements: [], services: [] };
let charts = [];

/* ---------------- Mot de passe ---------------- */
document.getElementById("btn-password").addEventListener("click", verifierMotDePasse);
document.getElementById("password-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") verifierMotDePasse();
});

async function verifierMotDePasse() {
  const saisi = document.getElementById("password-input").value;
  const err = document.getElementById("password-error");
  err.textContent = "";
  try {
    const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/rpc/verifier_mot_de_passe_bilan`, {
      method: "POST",
      headers: { ...Supa.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ mdp: saisi })
    });
    if (!res.ok) throw new Error();
    if ((await res.json()) === true) {
      document.getElementById("password-screen").hidden = true;
      document.getElementById("bilan-content").hidden = false;
      chargerFiltres();
    } else {
      err.textContent = "Mot de passe incorrect.";
    }
  } catch (e) {
    err.textContent = "Vérification impossible. Vérifie ta connexion.";
  }
}

/* ---------------- Chargement des filtres ---------------- */
async function chargerFiltres() {
  const [typesFormation, etablissements, services] = await Promise.all([
    Supa.select("types_formation", "select=id,libelle&actif=eq.true&order=libelle.asc"),
    Supa.select("etablissements", "select=id,nom&actif=eq.true&order=nom.asc"),
    Supa.select("services", "select=id,etablissement_id,nom&actif=eq.true&order=nom.asc"),
  ]);
  refs.services = services;
  refs.typesFormation = typesFormation;
  refs.etablissements = etablissements;

  const selType = document.getElementById("f-type-formation");
  typesFormation.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id; opt.textContent = t.libelle;
    selType.appendChild(opt);
  });

  const selEtab = document.getElementById("f-etablissement");
  etablissements.forEach(e => {
    const opt = document.createElement("option");
    opt.value = e.id; opt.textContent = e.nom;
    selEtab.appendChild(opt);
  });

  genererBilan();
}

document.getElementById("f-etablissement").addEventListener("change", () => {
  const sel = document.getElementById("f-service");
  const etabId = Number(document.getElementById("f-etablissement").value);
  sel.innerHTML = "";
  const tous = document.createElement("option");
  tous.value = "";
  if (!etabId) {
    tous.textContent = "Tous (choisir d'abord un établissement)";
    sel.appendChild(tous);
    sel.disabled = true;
    return;
  }
  tous.textContent = "Tous";
  sel.appendChild(tous);
  refs.services.filter(s => s.etablissement_id === etabId).forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.id; opt.textContent = s.nom;
    sel.appendChild(opt);
  });
  sel.disabled = false;
});

document.getElementById("btn-generer").addEventListener("click", genererBilan);
document.getElementById("btn-pdf").addEventListener("click", () => window.print());

function libelleSelect(id) {
  const sel = document.getElementById(id);
  return sel.value ? sel.options[sel.selectedIndex].textContent : "Tous";
}
function fmtDate(iso) { return iso ? iso.split("-").reverse().join("/") : ""; }

/* ---------------- Génération du bilan ---------------- */
async function genererBilan() {
  const d1 = document.getElementById("f-date-debut").value;
  const d2 = document.getElementById("f-date-fin").value;
  const typeId = document.getElementById("f-type-formation").value;
  const etabId = document.getElementById("f-etablissement").value;
  const servId = document.getElementById("f-service").value;

  let rows;
  try {
    rows = await Supa.select(
      "reponses_details",
      "select=session_reponse_id,valeur,questions(ordre,texte,type_reponse,options)," +
      "sessions_reponses(horodatage_soumission,etablissement_stage_id,service_id,type_formation_id)"
    );
  } catch (err) {
    document.getElementById("bilan-summary").textContent = "Erreur de chargement : " + err.message;
    return;
  }

  const filtered = rows.filter(r => {
    const s = r.sessions_reponses || {};
    if (!s.horodatage_soumission) return false;
    const jour = s.horodatage_soumission.slice(0, 10);
    if (d1 && jour < d1) return false;
    if (d2 && jour > d2) return false;
    if (typeId && String(s.type_formation_id) !== typeId) return false;
    if (etabId && String(s.etablissement_stage_id) !== etabId) return false;
    if (servId && String(s.service_id) !== servId) return false;
    return true;
  });

  const sessionsUniques = new Set(filtered.map(r => r.session_reponse_id));
  document.getElementById("bilan-summary").textContent =
    filtered.length ? `${sessionsUniques.size} questionnaire(s) pris en compte.` : "Aucune réponse pour cette sélection.";

  const periode = (d1 || d2) ? `du ${fmtDate(d1) || "…"} au ${fmtDate(d2) || "…"}` : "toutes périodes";
  document.getElementById("print-recap").textContent =
    `Période : ${periode} — Formation : ${libelleSelect("f-type-formation")} — Établissement : ${libelleSelect("f-etablissement")} — Service : ${libelleSelect("f-service")} — ${sessionsUniques.size} questionnaire(s)`;
  document.getElementById("print-date").textContent = "Édité le " + new Date().toLocaleDateString("fr-FR");
  document.getElementById("btn-pdf").disabled = !filtered.length;

  charts.forEach(c => c.destroy());
  charts = [];
  const container = document.getElementById("bilan-results");
  container.innerHTML = "";

  const byQuestion = new Map();
  filtered.forEach(r => {
    const q = r.questions || {};
    const key = `${q.ordre || 0}|${q.texte || ""}|${q.type_reponse || ""}`;
    if (!byQuestion.has(key)) byQuestion.set(key, { q, valeurs: [] });
    byQuestion.get(key).valeurs.push(r.valeur || "");
  });

  const questionsTriees = [...byQuestion.values()].sort((a, b) => (a.q.ordre || 0) - (b.q.ordre || 0));

  questionsTriees.forEach(({ q, valeurs }) => {
    if (q.type_reponse === "texte_libre") {
      afficherCommentaires(container, q.texte, valeurs);
    } else {
      afficherGraphique(container, q, valeurs);
    }
  });
}

function afficherCommentaires(container, texte, valeurs) {
  const nonVides = valeurs.filter(v => v.trim());
  const card = document.createElement("div");
  card.className = "bilan-card";
  card.innerHTML = `<h3>${texte}</h3><p class="bilan-summary">${nonVides.length} commentaire(s) sur ${valeurs.length} réponse(s)</p>`;
  nonVides.slice(0, 30).forEach(v => {
    const p = document.createElement("p");
    p.className = "bilan-comment";
    p.textContent = "• " + v;
    card.appendChild(p);
  });
  container.appendChild(card);
}

function afficherGraphique(container, q, valeurs) {
  const counts = new Map();
  if (q.type_reponse === "choix_multiple") {
    valeurs.forEach(v => v.split(",").map(s => s.trim()).filter(Boolean).forEach(opt => {
      counts.set(opt, (counts.get(opt) || 0) + 1);
    }));
  } else {
    valeurs.forEach(v => { if (v) counts.set(v, (counts.get(v) || 0) + 1); });
  }
  if (!counts.size) return;

  // Ordre stable : celui configuré pour la question plutôt que l'ordre d'arrivée des réponses
  const configure = (q.options && q.options.choix) || [];
  let labels = [...counts.keys()];
  if (q.type_reponse === "echelle") {
    labels.sort((a, b) => parseFloat(a) - parseFloat(b));
  } else if (configure.length) {
    labels.sort((a, b) => {
      const ia = configure.indexOf(a), ib = configure.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }
  const data = labels.map(l => counts.get(l));
  const colors = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
  const kind = q.type_reponse === "choix_multiple" ? "bar" : "pie";

  const card = document.createElement("div");
  card.className = "bilan-card";
  card.innerHTML = `<h3>${q.texte}</h3>`;
  const canvas = document.createElement("canvas");
  canvas.style.maxHeight = "320px";
  card.appendChild(canvas);
  container.appendChild(card);

  const chart = new Chart(canvas, {
    type: kind,
    data: { labels, datasets: [{ data, backgroundColor: colors }] },
    options: {
      responsive: true,
      animation: false,
      plugins: { legend: { display: kind === "pie", position: "right" } },
      scales: kind === "bar" ? { y: { beginAtZero: true, ticks: { precision: 0 } } } : undefined
    }
  });
  charts.push(chart);
}
