// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Paste the "Web app" URL you get from deploying apps-script/Code.gs here.
// Until this is set, submissions are validated and staged locally but the
// final POST will fail with a clear message instead of silently doing nothing.
const SUBMIT_ENDPOINT = "https://script.google.com/macros/s/AKfycbxght_xjd9CCx_ps_CBYOrzxsXchFN0SXTxw604nAYrxFJftJr4CIm0_Rj1bhmwR52w/exec";

const QUESTIONS_PER_PAGE = 30;
const STORAGE_KEY = "personality-assessment-draft-v1";

// Bump this whenever the wording of the privacy notice / consent statements
// below changes, so submissions record which version a respondent agreed to.
const PRIVACY_NOTICE_VERSION = "2026-09-17";

// ---------------------------------------------------------------------------
// Derived structure: page 0 = intro/demographics, pages 1..N = question
// chunks, final page = thank you (only reached after a successful submit).
// ---------------------------------------------------------------------------

const TOTAL_QUESTIONS = QUESTIONS.length; // from questions.js
const QUESTION_PAGE_COUNT = Math.ceil(TOTAL_QUESTIONS / QUESTIONS_PER_PAGE);
const INTRO_PAGE = 0;
const FIRST_QUESTION_PAGE = 1;
const LAST_QUESTION_PAGE = QUESTION_PAGE_COUNT; // inclusive
const THANKYOU_PAGE = LAST_QUESTION_PAGE + 1;

function questionRangeForPage(page) {
  // page is 1-based within the question pages
  const startIndex = (page - 1) * QUESTIONS_PER_PAGE;
  const endIndex = Math.min(startIndex + QUESTIONS_PER_PAGE, TOTAL_QUESTIONS);
  return { startIndex, endIndex };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  page: INTRO_PAGE,
  demo: { name: "", email: "", sex: "", age: "" },
  consent: { general: false, specialCategory: false },
  answers: new Array(TOTAL_QUESTIONS).fill(null), // each is option index 0-4 or null
  submitting: false,
  submitted: false,
};

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (draft && typeof draft === "object") {
      if (draft.demo) Object.assign(state.demo, draft.demo);
      if (draft.consent) Object.assign(state.consent, draft.consent);
      if (Array.isArray(draft.answers) && draft.answers.length === TOTAL_QUESTIONS) {
        state.answers = draft.answers;
      }
      if (typeof draft.page === "number") state.page = draft.page;
    }
  } catch (e) {
    // localStorage unavailable or corrupt draft - just start fresh
  }
}

function saveDraft() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ demo: state.demo, consent: state.consent, answers: state.answers, page: state.page })
    );
  } catch (e) {
    // ignore - draft autosave is a convenience, not a requirement
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const appMain = document.getElementById("appMain");
const backBtn = document.getElementById("backBtn");
const nextBtn = document.getElementById("nextBtn");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const toastEl = document.getElementById("toast");

let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 4000);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else node.setAttribute(k, v);
    }
  }
  (children || []).forEach((c) => {
    if (c) node.appendChild(c);
  });
  return node;
}

function renderIntroPage() {
  const screen = el("div", { class: "screen" });

  screen.appendChild(el("h1", {}, [document.createTextNode("Personality Assessment")]));
  screen.appendChild(
    el("p", { class: "lede" }, [
      document.createTextNode(
        "This questionnaire is designed to help identify how your natural preferences and behaviours relate to different personality personas. It contains 300 short statements about how you typically think, feel, and act."
      ),
    ])
  );
  screen.appendChild(
    el("p", { class: "lede" }, [
      document.createTextNode(
        "There are no right or wrong answers, and no persona is better than another. Each persona brings different perspectives, strengths, and ways of working. A balanced, effective team benefits from a variety of personas rather than one “ideal” personality type."
      ),
    ])
  );
  screen.appendChild(
    el("p", { class: "lede" }, [
      document.createTextNode(
        "Please respond honestly and instinctively, based on what feels most natural to you. The questionnaire takes most people around 30 minutes to complete in one sitting, so please find a quiet moment before you begin."
      ),
    ])
  );

  screen.appendChild(el("h2", {}, [document.createTextNode("How to answer")]));
  screen.appendChild(
    el("p", { class: "lede" }, [
      document.createTextNode("For each statement, choose how accurately it describes you:"),
    ])
  );
  screen.appendChild(
    el(
      "ul",
      { class: "lede-list" },
      [
        "Very Inaccurate",
        "Moderately Inaccurate",
        "Neither Accurate nor Inaccurate",
        "Moderately Accurate",
        "Very Accurate",
      ].map((label) => el("li", {}, [document.createTextNode(label)]))
    )
  );
  screen.appendChild(
    el("p", { class: "lede" }, [
      document.createTextNode(
        "Remember, there are no right or wrong responses. Your results are intended to provide insight into your individual preferences and the persona—or combination of personas—with which you most closely identify. Your responses will be kept confidential and used only for the stated purpose of the assessment."
      ),
    ])
  );

  const card = el("div", { class: "card" });

  card.appendChild(makeTextField("name", "Full Name", "text", state.demo.name, "e.g. Jordan Smith", true));
  card.appendChild(makeTextField("email", "Email Address", "email", state.demo.email, "you@example.com", true));
  card.appendChild(makeSelectField());
  card.appendChild(
    makeTextField("age", "Age", "number", state.demo.age, "e.g. 23", true, { min: 16, max: 100 })
  );

  screen.appendChild(card);

  const consentCard = el("div", { class: "card" });
  consentCard.appendChild(makePrivacyNoticeBlock());
  consentCard.appendChild(
    makeConsentCheckbox(
      "general",
      "I have read the privacy notice above and consent to Struckby Ltd collecting and processing my name, email, sex, age, and my responses to this assessment for the purposes described."
    )
  );
  consentCard.appendChild(
    makeConsentCheckbox(
      "specialCategory",
      "I understand that some statements in this assessment relate to my political opinions and religious beliefs, and I explicitly consent to Struckby Ltd processing this special category data as described above."
    )
  );
  screen.appendChild(consentCard);

  return screen;
}

function makePrivacyNoticeBlock() {
  const details = el("details", { class: "privacy-notice" });
  details.appendChild(
    el("summary", {}, [document.createTextNode("Privacy notice — how we use your information")])
  );

  const paragraphs = [
    [
      "b:Data controller: ",
      "Struckby Ltd (\u201cStruckby\u201d, \u201cwe\u201d, \u201cus\u201d). Contact: brandon.raeburn@struckby.co.uk",
    ],
    [
      "b:What we collect: ",
      "your name, email address, sex, and age, together with your responses to the 300 statements in this assessment. A small number of those statements relate to your political opinions and religious beliefs, which UK GDPR classes as \u201cspecial category data.\u201d",
    ],
    [
      "b:Why we collect it: ",
      "to assess your personality profile as part of our recruitment and candidate-placement service, and — where you go on to join our talent pool — to help match you to further roles we think may suit you.",
    ],
    [
      "b:Legal basis: ",
      "we process this data on the basis of your consent (UK GDPR Article 6(1)(a)), and, for the political-opinion and religious-belief statements, your explicit consent (Article 9(2)(a)). You can withdraw consent at any time by emailing us; this won\u2019t affect anything we\u2019ve already done with your data.",
    ],
    [
      "b:Who sees it: ",
      "your responses are stored in a Google Sheet via Google\u2019s infrastructure, which acts as our data processor. Google may process data outside the UK/EEA; where it does, this is covered by its standard contractual clauses. We don\u2019t sell your data or share it with third parties beyond what\u2019s needed to run this service.",
    ],
    [
      "b:How long we keep it: ",
      "if you don\u2019t go on to join our talent pool, we anonymise your responses (removing your name, email, and other identifying details) within 12 months of submission; we may keep the anonymised results afterwards to help build scoring benchmarks. If you do join our talent pool, we keep your full responses for up to 5 years so we can consider you for further roles, after which we\u2019ll delete them or ask you to reconfirm your consent.",
    ],
    [
      "b:Your rights: ",
      "you can ask us to give you a copy of your data, correct it, delete it, restrict how we use it, or provide it to you in a portable format, and you can object to our processing at any time. Email brandon.raeburn@struckby.co.uk to exercise any of these. If you\u2019re unhappy with how we\u2019ve handled your data, you can also complain to the UK Information Commissioner\u2019s Office (ico.org.uk).",
    ],
  ];

  paragraphs.forEach(([lead, rest]) => {
    const p = el("p", {});
    const label = lead.replace(/^b:/, "");
    p.appendChild(el("strong", {}, [document.createTextNode(label)]));
    p.appendChild(document.createTextNode(rest));
    details.appendChild(p);
  });

  return details;
}

function makeConsentCheckbox(key, labelText) {
  const block = el("div", { class: "consent-block", id: `consent-${key}` });
  const row = el("label", { class: "consent-row" });
  const input = el("input", { type: "checkbox", id: `input-consent-${key}` });
  if (state.consent[key]) input.setAttribute("checked", "checked");
  input.addEventListener("change", (e) => {
    state.consent[key] = e.target.checked;
    clearConsentError(key);
    saveDraft();
  });
  row.appendChild(input);
  row.appendChild(document.createTextNode(labelText));
  block.appendChild(row);
  block.appendChild(
    el("div", { class: "field-error" }, [
      document.createTextNode("Please confirm this before continuing."),
    ])
  );
  return block;
}

function clearConsentError(key) {
  const block = document.getElementById(`consent-${key}`);
  if (block) block.classList.remove("has-error");
}

function makeTextField(key, label, type, value, placeholder, required, extraAttrs) {
  const field = el("div", { class: "field", id: `field-${key}` });
  field.appendChild(
    el("label", { class: "field-label", for: `input-${key}` }, [
      document.createTextNode(label + (required ? " *" : "")),
    ])
  );
  const attrs = {
    type,
    id: `input-${key}`,
    placeholder,
    value: value || "",
  };
  if (type === "number") attrs.class = "no-spinner";
  if (extraAttrs) {
    for (const [k, v] of Object.entries(extraAttrs)) attrs[k] = String(v);
  }
  const input = el("input", attrs);
  input.addEventListener("input", (e) => {
    state.demo[key] = e.target.value;
    clearFieldError(key);
    saveDraft();
  });
  if (type === "number") {
    // Prevent the mouse-wheel from silently incrementing/decrementing the
    // value when someone scrolls the page while their cursor happens to be
    // over the field (a common accidental-edit trap on number inputs).
    input.addEventListener(
      "wheel",
      (e) => {
        input.blur();
      },
      { passive: true }
    );
  }
  field.appendChild(input);
  field.appendChild(el("div", { class: "field-error" }, [document.createTextNode(errorMessageFor(key))]));
  return field;
}

function errorMessageFor(key) {
  if (key === "name") return "Please enter your full name.";
  if (key === "email") return "Please enter a valid email address.";
  if (key === "age") return "Please enter a valid age.";
  if (key === "sex") return "Please select an option.";
  return "This field is required.";
}

function makeSelectField() {
  const field = el("div", { class: "field", id: "field-sex" });
  field.appendChild(
    el("label", { class: "field-label", for: "input-sex" }, [document.createTextNode("Sex *")])
  );
  const select = el("select", { id: "input-sex" });
  const options = ["", "Female", "Male", "Prefer not to say"];
  options.forEach((opt) => {
    const optionEl = el("option", { value: opt }, [
      document.createTextNode(opt === "" ? "Select an option" : opt),
    ]);
    if (opt === state.demo.sex) optionEl.setAttribute("selected", "selected");
    select.appendChild(optionEl);
  });
  select.addEventListener("change", (e) => {
    state.demo.sex = e.target.value;
    clearFieldError("sex");
    saveDraft();
  });
  field.appendChild(select);
  field.appendChild(el("div", { class: "field-error" }, [document.createTextNode(errorMessageFor("sex"))]));
  return field;
}

function clearFieldError(key) {
  const field = document.getElementById(`field-${key}`);
  if (field) field.classList.remove("has-error");
}

function renderQuestionPage(page) {
  const { startIndex, endIndex } = questionRangeForPage(page);
  const screen = el("div", { class: "screen" });
  screen.appendChild(
    el("h1", {}, [document.createTextNode(`Statements ${startIndex + 1}–${endIndex}`)])
  );
  screen.appendChild(
    el("p", { class: "lede" }, [
      document.createTextNode("Choose how accurately each statement describes you."),
    ])
  );

  const card = el("div", { class: "card" });

  for (let i = startIndex; i < endIndex; i++) {
    card.appendChild(makeQuestionBlock(i));
  }

  screen.appendChild(card);
  return screen;
}

function makeQuestionBlock(index) {
  const block = el("div", { class: "question-block", id: `question-${index}` });
  const text = el("div", { class: "question-text" }, [
    el("span", { class: "question-number" }, [document.createTextNode(`${index + 1}.`)]),
    document.createTextNode(QUESTIONS[index]),
  ]);
  block.appendChild(text);

  const optionsWrap = el("div", { class: "likert-options" });
  LIKERT_OPTIONS.forEach((optionLabel, optionIndex) => {
    const inputId = `q${index}-opt${optionIndex}`;
    const wrapper = el("div", { class: "likert-option" });
    const input = el("input", {
      type: "radio",
      name: `q${index}`,
      id: inputId,
      value: String(optionIndex),
    });
    if (state.answers[index] === optionIndex) input.setAttribute("checked", "checked");
    input.addEventListener("change", () => {
      state.answers[index] = optionIndex;
      block.classList.remove("has-error");
      saveDraft();
      updateProgress();
    });
    wrapper.appendChild(input);
    wrapper.appendChild(
      el("label", { for: inputId }, [document.createTextNode(optionLabel)])
    );
    optionsWrap.appendChild(wrapper);
  });
  block.appendChild(optionsWrap);
  return block;
}

function renderThankYouPage() {
  const screen = el("div", { class: "screen thankyou" });
  screen.appendChild(
    el("h1", {}, [document.createTextNode("Thank you for completing the assessment")])
  );
  screen.appendChild(
    el("p", { class: "lede" }, [
      document.createTextNode(
        "Your responses have been recorded. We'll email your results/profile to the address you provided once they're ready — there's nothing further you need to do."
      ),
    ])
  );
  return screen;
}

function render() {
  appMain.innerHTML = "";
  let screen;
  if (state.page === INTRO_PAGE) {
    screen = renderIntroPage();
  } else if (state.page === THANKYOU_PAGE) {
    screen = renderThankYouPage();
  } else {
    screen = renderQuestionPage(state.page);
  }
  appMain.appendChild(screen);
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  updateFooter();
  updateProgress();
}

function updateFooter() {
  backBtn.disabled = state.page === INTRO_PAGE || state.page === THANKYOU_PAGE;

  if (state.page === THANKYOU_PAGE) {
    nextBtn.style.display = "none";
    backBtn.style.display = "none";
    return;
  }
  nextBtn.style.display = "";
  backBtn.style.display = "";

  if (state.page === LAST_QUESTION_PAGE) {
    nextBtn.textContent = state.submitting ? "" : "Submit";
    if (state.submitting) {
      nextBtn.innerHTML = '<span class="spinner"></span>Submitting…';
    }
    nextBtn.disabled = state.submitting;
  } else {
    nextBtn.textContent = "Next";
    nextBtn.disabled = false;
  }
}

function updateProgress() {
  const totalPages = THANKYOU_PAGE; // pages 0..LAST_QUESTION_PAGE count toward progress
  let progressPct;
  let label;

  if (state.page === THANKYOU_PAGE) {
    progressPct = 100;
    label = "Complete";
  } else {
    const answeredCount = state.answers.filter((a) => a !== null).length;
    progressPct = Math.round((answeredCount / TOTAL_QUESTIONS) * 100);
    if (state.page === INTRO_PAGE) {
      label = "Getting started";
    } else {
      label = `Page ${state.page} of ${LAST_QUESTION_PAGE} · ${answeredCount}/${TOTAL_QUESTIONS} answered`;
    }
  }
  progressFill.style.width = `${progressPct}%`;
  progressLabel.textContent = label;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateIntro() {
  let valid = true;
  const name = state.demo.name.trim();
  const email = state.demo.email.trim();
  const age = String(state.demo.age).trim();
  const sex = state.demo.sex;

  if (!name) {
    document.getElementById("field-name").classList.add("has-error");
    valid = false;
  }
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk) {
    document.getElementById("field-email").classList.add("has-error");
    valid = false;
  }
  if (!sex) {
    document.getElementById("field-sex").classList.add("has-error");
    valid = false;
  }
  const ageNum = Number(age);
  if (!age || Number.isNaN(ageNum) || ageNum < 16 || ageNum > 100) {
    document.getElementById("field-age").classList.add("has-error");
    valid = false;
  }

  if (!state.consent.general) {
    document.getElementById("consent-general").classList.add("has-error");
    valid = false;
  }
  if (!state.consent.specialCategory) {
    document.getElementById("consent-specialCategory").classList.add("has-error");
    valid = false;
  }

  if (!valid) showToast("Please fill in all fields and confirm both consent checkboxes before continuing.");
  return valid;
}

function validateQuestionPage(page) {
  const { startIndex, endIndex } = questionRangeForPage(page);
  let valid = true;
  let firstMissing = null;
  for (let i = startIndex; i < endIndex; i++) {
    if (state.answers[i] === null) {
      valid = false;
      const block = document.getElementById(`question-${i}`);
      if (block) block.classList.add("has-error");
      if (firstMissing === null) firstMissing = i;
    }
  }
  if (!valid) {
    showToast("Please answer every statement on this page before continuing.");
    const target = document.getElementById(`question-${firstMissing}`);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  return valid;
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

function buildSubmissionPayload() {
  return {
    submittedAt: new Date().toISOString(),
    name: state.demo.name.trim(),
    email: state.demo.email.trim(),
    sex: state.demo.sex,
    age: Number(state.demo.age),
    consent: {
      general: !!state.consent.general,
      specialCategory: !!state.consent.specialCategory,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    },
    answers: state.answers.map((optionIndex, i) => ({
      question: i + 1,
      answerIndex: optionIndex,
      answerText: LIKERT_OPTIONS[optionIndex],
    })),
  };
}

async function submitAssessment() {
  if (SUBMIT_ENDPOINT.indexOf("PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE") !== -1) {
    showToast("Submission isn't wired up yet — set SUBMIT_ENDPOINT in app.js. Your answers are safe in this browser.");
    return false;
  }

  const payload = buildSubmissionPayload();

  try {
    // Apps Script web apps behave most reliably with a simple, no-preflight POST.
    await fetch(SUBMIT_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    // no-cors responses are opaque, so we can't read a status code back.
    // We treat the request as sent if fetch didn't throw (e.g. network/DNS failure).
    return true;
  } catch (err) {
    showToast("Couldn't submit — check your connection and try again. Your answers are still saved.");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

async function goNext() {
  if (state.page === INTRO_PAGE) {
    if (!validateIntro()) return;
    state.page = FIRST_QUESTION_PAGE;
    saveDraft();
    render();
    return;
  }

  if (state.page >= FIRST_QUESTION_PAGE && state.page < LAST_QUESTION_PAGE) {
    if (!validateQuestionPage(state.page)) return;
    state.page += 1;
    saveDraft();
    render();
    return;
  }

  if (state.page === LAST_QUESTION_PAGE) {
    if (!validateQuestionPage(state.page)) return;
    state.submitting = true;
    updateFooter();
    const ok = await submitAssessment();
    state.submitting = false;
    if (ok) {
      clearDraft();
      state.page = THANKYOU_PAGE;
      render();
    } else {
      updateFooter();
    }
  }
}

function goBack() {
  if (state.page > INTRO_PAGE && state.page <= LAST_QUESTION_PAGE) {
    state.page -= 1;
    saveDraft();
    render();
  }
}

nextBtn.addEventListener("click", goNext);
backBtn.addEventListener("click", goBack);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

loadDraft();
render();
