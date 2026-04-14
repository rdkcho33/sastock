const state = {
  user: null,
  lang: "en",
  mode: "AUTO",
  results: [],
  isGenerating: false,
  stopRequested: false,
  activeController: null
};

const logBody = document.getElementById("logBody");
const toggleLogBtn = document.getElementById("toggleLogBtn");
const clearLogBtn = document.getElementById("clearLogBtn");
const logConsole = document.getElementById("logConsole");
const generateBtn = document.getElementById("generateBtn");
const stopBtn = document.getElementById("stopBtn");
const resultsList = document.getElementById("resultsList");
const copyAllBtn = document.getElementById("copyAllBtn");
const clearBtn = document.getElementById("clearBtn");

function logToConsole(message, type = "info") {
  if (!logBody) return;
  const entry = document.createElement("div");
  const time = new Date().toLocaleTimeString();
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${time}] ${message}`;
  logBody.appendChild(entry);
  logBody.scrollTop = logBody.scrollHeight;
}

async function readJsonResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  const raw = await res.text();
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON but got: ${raw.slice(0, 200)}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON response: ${raw.slice(0, 200)}`);
  }
}

function setMode(mode) {
  state.mode = mode === "MANUAL" ? "MANUAL" : "AUTO";
  const isManual = state.mode === "MANUAL";

  document.getElementById("modeAUTO").classList.toggle("active", !isManual);
  document.getElementById("modeMANUAL").classList.toggle("active", isManual);
  document.getElementById("expressionInput").disabled = !isManual;
  document.getElementById("activityInput").disabled = !isManual;
  document.getElementById("backgroundInput").disabled = !isManual;
  document.getElementById("manualFields").classList.toggle("is-disabled", !isManual);
  document.getElementById("modeHint").textContent = isManual
    ? "Mode MANUAL aktif: expression, activity, dan background akan dipakai persis seperti input Anda."
    : "Mode AUTO aktif: AI akan mengisi expression, activity, dan background secara relevan.";
}

window.setMode = setMode;

if (toggleLogBtn) {
  toggleLogBtn.onclick = () => {
    logConsole.classList.toggle("minimized");
    toggleLogBtn.querySelector("svg").style.transform = logConsole.classList.contains("minimized")
      ? "rotate(0deg)"
      : "rotate(180deg)";
  };
}

if (clearLogBtn) {
  clearLogBtn.onclick = () => {
    logBody.innerHTML = '<div class="log-entry system">Logs cleared.</div>';
  };
}

async function init() {
  try {
    const auth = await readJsonResponse(await fetch("/api/auth/me"));
    if (!auth.authenticated) {
      window.location.href = "/login.html";
      return;
    }

    state.user = auth.user;
    document.getElementById("userName").textContent = state.user.username;
    document.getElementById("userRole").textContent = state.user.role;
    document.getElementById("userProfile").style.display = "flex";

    await fetchKeys();
  } catch {
    window.location.href = "/login.html";
  }
}

async function fetchKeys() {
  try {
    const data = await readJsonResponse(await fetch("/api/keys"));
    const select = document.getElementById("activeKeySelect");

    if (data.keys && data.keys.length > 0) {
      select.innerHTML = data.keys.map((key) => `<option value="${key.key_value}">${key.label}</option>`).join("");
    } else {
      select.innerHTML = '<option value="">No keys found</option>';
    }
  } catch {
    console.error("Failed to fetch keys");
  }
}

document.getElementById("logoutBtn").onclick = async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
};

window.setLang = (lang) => {
  state.lang = lang;
  document.getElementById("langEN").classList.toggle("active", lang === "en");
  document.getElementById("langID").classList.toggle("active", lang === "id");
  logToConsole(`Output language set to: ${lang === "id" ? "Indonesia" : "English"}`, "system");
};

function addPendingCard(id, index) {
  const card = document.createElement("div");
  card.id = `card-${id}`;
  card.className = "prompt-card";
  card.innerHTML = `
    <div class="status-badge status-generating">Generating #${index}...</div>
    <div class="loading-shimmer" style="height:60px; border-radius:8px;"></div>
  `;
  resultsList.prepend(card);
}

function updateCard(id, prompt) {
  const card = document.getElementById(`card-${id}`);
  if (!card) return;
  card.innerHTML = `
    <div class="status-badge status-success">Ready</div>
    <textarea class="styled-input" style="width:100%; min-height:80px; font-size:12px; margin-bottom:10px;" readonly>${prompt}</textarea>
    <button class="btn btn-secondary btn-sm" style="width:100%;" onclick="copyCardPrompt(this)">Copy Prompt</button>
  `;
}

function updateCardError(id, error) {
  const card = document.getElementById(`card-${id}`);
  if (!card) return;
  card.innerHTML = `
    <div class="status-badge status-error">Error</div>
    <p style="font-size:11px; color:#f87171;">${error}</p>
  `;
}

generateBtn.onclick = async () => {
  const purpose = document.getElementById("purposeInput").value.trim();
  const object = document.getElementById("objectInput").value.trim();
  const expression = document.getElementById("expressionInput").value.trim();
  const activity = document.getElementById("activityInput").value.trim();
  const background = document.getElementById("backgroundInput").value.trim();
  const batchCount = parseInt(document.getElementById("batchCount").value, 10) || 1;
  const model = document.getElementById("modelSelect").value;

  if (!purpose || !object) {
    alert("Please fill in both Purpose and Object.");
    return;
  }

  if (batchCount > 20) {
    alert("Maximum batch count is 20.");
    return;
  }

  if (state.mode === "MANUAL" && (!expression || !activity || !background)) {
    alert("Please fill Expression, Activity, and Background in MANUAL mode.");
    return;
  }

  state.isGenerating = true;
  state.stopRequested = false;
  state.activeController = new AbortController();
  state.results = [];
  resultsList.innerHTML = "";
  copyAllBtn.style.display = "none";

  generateBtn.disabled = true;
  generateBtn.innerHTML = `<span>Generating batch of ${batchCount}...</span>`;
  stopBtn.style.display = "block";
  stopBtn.disabled = false;
  clearBtn.disabled = true;
  logToConsole(`Requesting ${batchCount} prompts in ${state.mode} mode...`, "info");

  const cardIds = [];
  for (let i = 0; i < batchCount; i += 1) {
    const tempId = Date.now() + i;
    cardIds.push(tempId);
    addPendingCard(tempId, i + 1);
  }

  try {
    const response = await fetch("/api/prompt-studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: state.activeController.signal,
      body: JSON.stringify({
        mode: state.mode,
        purpose,
        object,
        expression,
        activity,
        background,
        lang: state.lang,
        model,
        count: batchCount
      })
    });

    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Generation failed");
    }

    const prompts = Array.isArray(data.prompts) ? data.prompts.filter(Boolean) : [];

    prompts.forEach((prompt, index) => {
      if (index < cardIds.length) {
        updateCard(cardIds[index], prompt);
      } else {
        const newId = Date.now() + 100 + index;
        addPendingCard(newId, index + 1);
        updateCard(newId, prompt);
      }
    });

    if (prompts.length < cardIds.length) {
      for (let index = prompts.length; index < cardIds.length; index += 1) {
        updateCardError(cardIds[index], "AI did not generate this prompt in the batch.");
      }
    }

    state.results = prompts;
    if (state.results.length > 0) {
      copyAllBtn.style.display = "inline-block";
    }

    logToConsole(`Successfully generated ${prompts.length} prompts.`, "success");
  } catch (err) {
    if (err.name === "AbortError" || state.stopRequested) {
      cardIds.forEach((id) => updateCardError(id, "Process stopped by user."));
      logToConsole("Prompt Studio process stopped by user.", "system");
    } else {
      cardIds.forEach((id) => updateCardError(id, err.message));
      logToConsole(`Batch failed: ${err.message}`, "error");
    }
  }

  state.isGenerating = false;
  state.stopRequested = false;
  state.activeController = null;
  generateBtn.disabled = false;
  generateBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path><path d="M5 3v4"></path><path d="M19 17v4"></path><path d="M3 5h4"></path><path d="M17 19h4"></path></svg> Generate Stock Prompts`;
  stopBtn.style.display = "none";
  clearBtn.disabled = false;
};

stopBtn.onclick = async () => {
  if (!state.isGenerating) return;

  state.stopRequested = true;
  stopBtn.disabled = true;
  logToConsole("Stopping Prompt Studio process...", "system");

  if (state.activeController) {
    state.activeController.abort();
  }

  try {
    await fetch("/api/process-control/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "prompt-studio" })
    });
  } catch (error) {
    console.warn("Failed to notify server to stop prompt studio process:", error);
  }
};

window.copyCardPrompt = (button) => {
  const text = button.previousElementSibling.value;
  navigator.clipboard.writeText(text);
  const original = button.innerText;
  button.innerText = "Copied!";
  button.classList.add("btn-success");
  setTimeout(() => {
    button.innerText = original;
    button.classList.remove("btn-success");
  }, 2000);
};

copyAllBtn.onclick = () => {
  const allText = state.results.join("\n\n");
  navigator.clipboard.writeText(allText);
  const original = copyAllBtn.innerText;
  copyAllBtn.innerText = "All Copied!";
  copyAllBtn.classList.add("btn-success");
  setTimeout(() => {
    copyAllBtn.innerText = original;
    copyAllBtn.classList.remove("btn-success");
  }, 2000);
};

clearBtn.onclick = () => {
  if (state.isGenerating) return;
  resultsList.innerHTML = "";
  state.results = [];
  copyAllBtn.style.display = "none";
  logToConsole("Workspace cleared.", "system");
};

setMode("AUTO");
init();
