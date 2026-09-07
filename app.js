"use strict";

/* ============================================================
   Petit client REST Supabase (pas de dépendance externe, pour
   rester fiable même sur un wifi hospitalier limité).
   ============================================================ */
const Supa = {
  headers(extra = {}) {
    return {
      "apikey": SUPABASE_CONFIG.anonKey,
      "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
      "Content-Type": "application/json",
      ...extra
    };
  },
  async select(table, query = "") {
    const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${table}?${query}`, {
      headers: this.headers()
    });
    if (!res.ok) throw new Error(`Lecture impossible (${table})`);
    return res.json();
  },
  async insert(table, rows, { returnRepresentation = false } = {}) {
    const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${table}`, {
      method: "POST",
      headers: this.headers({
        "Prefer": returnRepresentation ? "return=representation" : "return=minimal"
      }),
      body: JSON.stringify(rows)
    });
    if (!res.ok) throw new Error(`Envoi impossible (${table})`);
    return returnRepresentation ? res.json() : null;
  }
};

/* ============================================================
   État de l'application
   ============================================================ */
const state = {
  refs: {
    promotions: [],
    typesFormation: [],
    semestres: [],
    etablissements: [],
    services: [],           // tous les services ; filtrés par établissement à l'affichage
    questionnaireVersionId: null,
    questions: []
  },
  identification: null,     // rempli à la validation de l'écran 1
  answers: {},              // question_id -> valeur (string) ou tableau (choix_multiple)
  currentQuestionIndex: 0
};

const els = {};
["screen-identification","screen-questionnaire","screen-sending","screen-done","screen-error",
 "form-identification","promotion","type_formation","date_debut_stage","date_fin_stage",
 "semestre","etablissement_origine","etablissement_stage","service",
 "identification-error","hint-dates",
 "progress-ticks","progress-label","question-text","question-input","question-error",
 "btn-prev","btn-next","btn-retry","error-message"
].forEach(id => els[id] = document.getElementById(id));

function showScreen(id) {
  ["screen-identification","screen-questionnaire","screen-sending","screen-done","screen-error"]
    .forEach(s => document.getElementById(s).hidden = (s !== id));
}

/* ============================================================
   Chargement des données de référence
   ============================================================ */
async function loadReferenceData() {
  const [promotions, typesFormation, semestres, etablissements, services, versions] = await Promise.all([
    Supa.select("promotions", "select=id,annee_debut,annee_fin&order=annee_debut.desc"),
    Supa.select("types_formation", "select=id,libelle&actif=eq.true&order=libelle.asc"),
    Supa.select("semestres", "select=id,libelle&actif=eq.true&order=ordre.asc"),
    Supa.select("etablissements", "select=id,nom&actif=eq.true&order=nom.asc"),
    Supa.select("services", "select=id,etablissement_id,nom&actif=eq.true&order=nom.asc"),
    Supa.select("questionnaires_versions", "select=id&actif=eq.true&limit=1")
  ]);

  state.refs.promotions = promotions;
  state.refs.typesFormation = typesFormation;
  state.refs.semestres = semestres;
  state.refs.etablissements = etablissements;
  state.refs.services = services;

  if (!versions.length) {
    throw new Error("Aucun questionnaire actif n'est configuré pour le moment.");
  }
  state.refs.questionnaireVersionId = versions[0].id;

  state.refs.questions = await Supa.select(
    "questions",
    `select=id,ordre,texte,type_reponse,options,obligatoire&questionnaire_version_id=eq.${versions[0].id}&order=ordre.asc`
  );

  populateSelect(els.promotion, promotions, p => `${p.annee_debut}–${p.annee_fin}`, p => p.id);
  populateSelect(els.type_formation, typesFormation, t => t.libelle, t => t.id);
  populateSelect(els.semestre, semestres, s => s.libelle, s => s.id);
  populateSelect(els.etablissement_stage, etablissements, e => e.nom, e => e.id);
}

function populateSelect(selectEl, items, labelFn, valueFn) {
  items.forEach(item => {
    const opt = document.createElement("option");
    opt.value = valueFn(item);
    opt.textContent = labelFn(item);
    selectEl.appendChild(opt);
  });
}

els.etablissement_stage.addEventListener("change", () => {
  const etabId = Number(els.etablissement_stage.value);
  const filtered = state.refs.services.filter(s => s.etablissement_id === etabId);
  els.service.innerHTML = "";
  if (!filtered.length) {
    const opt = document.createElement("option");
    opt.textContent = "Aucun service configuré pour cet établissement";
    opt.disabled = true;
    opt.selected = true;
    els.service.appendChild(opt);
    els.service.disabled = true;
    return;
  }
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = "Choisir…";
  els.service.appendChild(placeholder);
  populateSelect(els.service, filtered, s => s.nom, s => s.id);
  els.service.disabled = false;
});

/* ============================================================
   Écran 1 : identification
   ============================================================ */
els.form_identification = els["form-identification"];
els.form_identification.addEventListener("submit", (e) => {
  e.preventDefault();
  els["identification-error"].hidden = true;

  const debut = els.date_debut_stage.value;
  const fin = els.date_fin_stage.value;

  if (!els.form_identification.reportValidity()) return;

  if (fin < debut) {
    els["identification-error"].textContent = "La date de fin de stage doit être postérieure à la date de début.";
    els["identification-error"].hidden = false;
    return;
  }

  state.identification = {
    promotion_id: Number(els.promotion.value),
    type_formation_id: Number(els.type_formation.value),
    date_debut_stage: debut,
    date_fin_stage: fin,
    semestre_id: Number(els.semestre.value),
    etablissement_origine: els.etablissement_origine.value.trim(),
    etablissement_stage_id: Number(els.etablissement_stage.value),
    service_id: Number(els.service.value),
    questionnaire_version_id: state.refs.questionnaireVersionId
  };

  state.currentQuestionIndex = 0;
  showScreen("screen-questionnaire");
  renderQuestion();
});

/* ============================================================
   Écran 2 : questionnaire, question par question
   ============================================================ */
function renderProgress() {
  const total = state.refs.questions.length;
  const current = state.currentQuestionIndex;
  els["progress-ticks"].innerHTML = "";
  for (let i = 0; i < total; i++) {
    const tick = document.createElement("div");
    tick.className = "tick" + (i <= current ? " filled" : "");
    els["progress-ticks"].appendChild(tick);
  }
  els["progress-label"].textContent = `Question ${current + 1} / ${total}`;
}

function renderQuestion() {
  const q = state.refs.questions[state.currentQuestionIndex];
  els["question-text"].textContent = q.texte;
  els["question-error"].hidden = true;
  els["btn-prev"].style.visibility = state.currentQuestionIndex === 0 ? "hidden" : "visible";
  els["btn-next"].textContent =
    state.currentQuestionIndex === state.refs.questions.length - 1 ? "Valider le questionnaire" : "Question suivante";

  const container = els["question-input"];
  container.innerHTML = "";
  const existing = state.answers[q.id];

  if (q.type_reponse === "echelle") {
    const opts = q.options || { min: 1, max: 5 };
    const row = document.createElement("div");
    row.className = "scale-row";
    for (let v = opts.min; v <= opts.max; v++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scale-option" + (String(existing) === String(v) ? " selected" : "");
      btn.textContent = v;
      btn.addEventListener("click", () => {
        state.answers[q.id] = v;
        row.querySelectorAll(".scale-option").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
      row.appendChild(btn);
    }
    container.appendChild(row);

  } else if (q.type_reponse === "choix_unique") {
    const list = document.createElement("div");
    list.className = "choice-list";
    (q.options?.choix || []).forEach(choix => {
      const label = document.createElement("label");
      label.className = "choice-option" + (existing === choix ? " selected" : "");
      label.innerHTML = `<input type="radio" name="q${q.id}" value="${choix}" ${existing === choix ? "checked" : ""}> ${choix}`;
      label.querySelector("input").addEventListener("change", () => {
        state.answers[q.id] = choix;
        list.querySelectorAll(".choice-option").forEach(o => o.classList.remove("selected"));
        label.classList.add("selected");
      });
      list.appendChild(label);
    });
    container.appendChild(list);

  } else if (q.type_reponse === "choix_multiple") {
    const list = document.createElement("div");
    list.className = "choice-list";
    const selected = new Set(existing || []);
    (q.options?.choix || []).forEach(choix => {
      const label = document.createElement("label");
      label.className = "choice-option" + (selected.has(choix) ? " selected" : "");
      label.innerHTML = `<input type="checkbox" value="${choix}" ${selected.has(choix) ? "checked" : ""}> ${choix}`;
      label.querySelector("input").addEventListener("change", (e) => {
        if (e.target.checked) selected.add(choix); else selected.delete(choix);
        state.answers[q.id] = Array.from(selected);
        label.classList.toggle("selected", e.target.checked);
      });
      list.appendChild(label);
    });
    container.appendChild(list);

  } else { // texte_libre
    const textarea = document.createElement("textarea");
    textarea.value = existing || "";
    textarea.addEventListener("input", () => { state.answers[q.id] = textarea.value; });
    container.appendChild(textarea);
  }

  renderProgress();
}

function currentAnswerIsValid() {
  const q = state.refs.questions[state.currentQuestionIndex];
  if (!q.obligatoire) return true;
  const a = state.answers[q.id];
  if (q.type_reponse === "choix_multiple") return Array.isArray(a) && a.length > 0;
  return a !== undefined && a !== null && String(a).trim() !== "";
}

els["btn-prev"].addEventListener("click", () => {
  if (state.currentQuestionIndex === 0) return;
  state.currentQuestionIndex -= 1;
  renderQuestion();
});

els["btn-next"].addEventListener("click", async () => {
  if (!currentAnswerIsValid()) {
    els["question-error"].textContent = "Merci de répondre avant de continuer.";
    els["question-error"].hidden = false;
    return;
  }
  if (state.currentQuestionIndex < state.refs.questions.length - 1) {
    state.currentQuestionIndex += 1;
    renderQuestion();
  } else {
    await submitQuestionnaire();
  }
});

/* ============================================================
   Envoi final
   ============================================================ */
async function submitQuestionnaire() {
  showScreen("screen-sending");
  try {
    const [session] = await Supa.insert("sessions_reponses", [state.identification], { returnRepresentation: true });
    const details = state.refs.questions.map(q => ({
      session_reponse_id: session.id,
      question_id: q.id,
      valeur: Array.isArray(state.answers[q.id]) ? state.answers[q.id].join(", ") : String(state.answers[q.id] ?? "")
    }));
    await Supa.insert("reponses_details", details);
    showScreen("screen-done");
  } catch (err) {
    els["error-message"].textContent = err.message || "La connexion a échoué. Vérifiez votre réseau puis réessayez.";
    showScreen("screen-error");
  }
}

els["btn-retry"].addEventListener("click", () => { submitQuestionnaire(); });

/* ============================================================
   Démarrage
   ============================================================ */
(async function init() {
  try {
    await loadReferenceData();
  } catch (err) {
    els["error-message"].textContent = err.message || "Impossible de charger le questionnaire. Vérifiez votre connexion.";
    showScreen("screen-error");
    els["btn-retry"].onclick = () => location.reload();
  }
})();
