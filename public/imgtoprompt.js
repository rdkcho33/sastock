// imgtoprompt.js

const state = {
  user: null,
  provider: localStorage.getItem("sastock_provider") === "snifox" ? "snifox" : "gemini",
  files: [],
  results: [],
  isRunning: false,
  stopRequested: false,
  activeController: null
};

const PROVIDERS = {
  GEMINI: "gemini",
  SNIFOX: "snifox"
};
const SNIFOX_MODEL_STORAGE_KEY = "sastock_snifox_model";
const DEFAULT_SNIFOX_MODEL = "google/gemini-2.5-flash";

// Elements
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const creativitySlider = document.getElementById("creativitySlider");
const creativityValue = document.getElementById("creativityValue");
const cameraSwitch = document.getElementById("cameraSwitch");
const runBtn = document.getElementById("runBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const copyAllBtn = document.getElementById("copyAllBtn");
const resultsGrid = document.getElementById("resultsGrid");
const fileCountLabel = document.getElementById("fileCount");

function getProviderLabel(provider = state.provider) {
  return provider === PROVIDERS.SNIFOX ? "Snifox" : "Gemini";
}

function getImgToPromptEndpoint() {
  return state.provider === PROVIDERS.SNIFOX ? "/api/snifox/imgtoprompt/single" : "/api/imgtoprompt/single";
}

function getActiveModel() {
  if (state.provider === PROVIDERS.SNIFOX) {
    return document.getElementById("snifoxModelInput")?.value.trim() || DEFAULT_SNIFOX_MODEL;
  }
  return document.getElementById("modelSelect").value;
}

function updateProviderUI() {
  const isSnifox = state.provider === PROVIDERS.SNIFOX;
  document.querySelectorAll("#providerToggle [data-provider]").forEach((button) => {
    button.classList.toggle("active", button.dataset.provider === state.provider);
  });

  const subtitle = document.getElementById("providerSubtitle");
  const providerHint = document.getElementById("providerHint");
  const apiKeySectionLabel = document.getElementById("apiKeySectionLabel");
  const geminiModelGroup = document.getElementById("geminiModelGroup");
  const snifoxModelGroup = document.getElementById("snifoxModelGroup");
  const modelSectionTitle = document.getElementById("modelSectionTitle");

  if (subtitle) {
    subtitle.textContent = isSnifox ? "Snifox Aggregator Active" : "Google Gemini Direct Active";
  }
  if (providerHint) {
    providerHint.textContent = isSnifox
      ? "Menggunakan endpoint aggregator Snifox yang kompatibel dengan OpenAI."
      : "Menggunakan endpoint Google Gemini langsung.";
  }
  if (apiKeySectionLabel) {
    apiKeySectionLabel.textContent = `${getProviderLabel()} API Keys`;
  }
  if (modelSectionTitle) {
    modelSectionTitle.textContent = isSnifox ? "SNIFOX MODEL ID" : "MODEL";
  }
  if (geminiModelGroup) geminiModelGroup.hidden = isSnifox;
  if (snifoxModelGroup) snifoxModelGroup.hidden = !isSnifox;
}

// --- LOG CONSOLE UTILITY ---
const logConsole = document.getElementById("logConsole");
const logBody = document.getElementById("logBody");
const toggleLogBtn = document.getElementById("toggleLogBtn");
const clearLogBtn = document.getElementById("clearLogBtn");

function logToConsole(message, type = "info") {
  if (!logBody) return; // Defensive check
  const entry = document.createElement("div");
  const time = new Date().toLocaleTimeString();
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${time}] ${message}`;
  logBody.appendChild(entry);
  logBody.scrollTop = logBody.scrollHeight;
  
  if (type === "error") console.error(`[LOG] ${message}`);
  else console.log(`[LOG] ${message}`);
}

if (toggleLogBtn && logConsole) {
    toggleLogBtn.onclick = (e) => {
      e.stopPropagation();
      logConsole.classList.toggle("minimized");
      const icon = toggleLogBtn.querySelector("svg");
      if (logConsole.classList.contains("minimized")) {
        icon.innerHTML = '<polyline points="18 15 12 21 6 15"></polyline>';
      } else {
        icon.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
      }
    };
}

if (clearLogBtn && logBody) {
    clearLogBtn.onclick = (e) => {
      e.stopPropagation();
      logBody.innerHTML = '<div class="log-entry system">Logs cleared.</div>';
    };
}

const logHeader = document.querySelector(".log-header");
if (logHeader && logConsole) {
    logHeader.onclick = () => {
        logConsole.classList.toggle("minimized");
    };
}

async function init() {
  const auth = await checkAuth();
  if (!auth.authenticated) {
    window.location.href = "/login.html";
    return;
  }
  state.user = auth.user;
  document.getElementById("userName").textContent = state.user.username;
  document.getElementById("userRole").textContent = state.user.role;
  document.getElementById("userProfile").style.display = "flex";
  updateProviderUI();
  await fetchKeys();
}

async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me");
    const contentType = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (!contentType.includes("application/json")) {
      throw new Error(`Expected JSON but got: ${raw.slice(0, 200)}`);
    }
    return JSON.parse(raw);
  } catch (err) {
    return { authenticated: false };
  }
}

document.getElementById("logoutBtn").onclick = async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
};

async function fetchKeys() {
  try {
    const res = await fetch(`/api/keys?provider=${encodeURIComponent(state.provider)}`);
    const contentType = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (!contentType.includes("application/json")) {
      throw new Error(`Expected JSON but got: ${raw.slice(0, 200)}`);
    }

    const data = JSON.parse(raw);
    const select = document.getElementById("activeKeySelect");
    const counter = document.getElementById("apiKeyCounter");

    if (Array.isArray(data.keys) && data.keys.length > 0) {
      select.innerHTML = data.keys.map((key) => `<option value="${key.key_value}">${key.label}</option>`).join("");
      if (counter) counter.textContent = `${data.keys.length} keys available`;
    } else {
      select.innerHTML = `<option value="">No ${getProviderLabel()} keys found</option>`;
      if (counter) counter.textContent = "0 keys available";
    }
  } catch (error) {
    console.error("Failed to fetch keys", error);
  }
}

// Dropzone logic
dropZone.onclick = () => fileInput.click();
dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add("dragover"); };
dropZone.ondragleave = () => dropZone.classList.remove("dragover");
dropZone.ondrop = (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  addFiles(e.dataTransfer.files);
};

fileInput.onchange = (e) => addFiles(e.target.files);

function addFiles(newFiles) {
  const images = Array.from(newFiles).filter(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    return f.type.startsWith("image/") || ext === "svg" || ext === "eps";
  });

  if (images.length > 0) {
    logToConsole(`Added ${images.length} images to queue.`, "info");
  }

  images.forEach(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    const isVector = ext === 'svg' || ext === 'eps';
    
    const fileItem = {
      file: f,
      id: `${f.name}-${f.size}-${Date.now()}`,
      status: isVector ? "converting" : "pending",
      previewUrl: null
    };
    
    state.files.push(fileItem);
    if (isVector) processVectorFile(fileItem);
  });

  updateUI();
  checkConvertingState();
}

async function processVectorFile(fileItem) {
  logToConsole(`Converting vector: ${fileItem.file.name}...`, "info");
  const formData = new FormData();
  formData.append("file", fileItem.file);

  try {
    const res = await fetch("/api/convert-vector", {
      method: "POST",
      body: formData
    });
    if (!res.ok) throw new Error("Conversion failed");
    const contentType = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (!contentType.includes("application/json")) {
      throw new Error(`Expected JSON but got: ${raw.slice(0, 200)}`);
    }
    const data = JSON.parse(raw);
    fileItem.previewUrl = `data:image/png;base64,${data.png}`;
    fileItem.status = "pending";
    logToConsole(`Vector converted: ${fileItem.file.name}`, "success");
  } catch (err) {
    fileItem.status = "failed";
    logToConsole(`Vector failed: ${fileItem.file.name} - ${err.message}`, "error");
    console.error(err);
  } finally {
    renderPendingCards();
    checkConvertingState();
  }
}

function checkConvertingState() {
  const isAnyConverting = state.files.some(f => f.status === "converting");
  runBtn.disabled = state.isRunning || isAnyConverting || state.files.length === 0;
  stopBtn.style.display = state.isRunning ? "inline-flex" : "none";
  stopBtn.disabled = !state.isRunning;
  if (state.isRunning) {
    runBtn.innerHTML = "Processing Queue...";
  } else if (isAnyConverting) {
    runBtn.innerHTML = "Processing Vectors...";
  } else {
    runBtn.innerHTML = "Generate All Prompts";
  }
}

function updateUI() {
  fileCountLabel.textContent = `${state.files.length} images selected`;
  renderPendingCards();
  checkConvertingState();
}

function renderPendingCards() {
  if (resultsGrid.children.length === 0 && state.files.length > 0) {
      resultsGrid.innerHTML = state.files.map((f, i) => {
        let previewHtml = "";
        if (f.status === "converting") {
          previewHtml = `<div class="card-loading-overlay"><div class="spinner"></div><div class="processing-text">Converting...</div></div>`;
        } else if (f.previewUrl) {
          previewHtml = `<img src="${f.previewUrl}" style="width:100%; height:150px; object-fit:cover; border-radius:10px;" />`;
        } else {
          previewHtml = `<img src="${URL.createObjectURL(f.file)}" style="width:100%; height:150px; object-fit:cover; border-radius:10px;" />`;
        }
        
        return `
          <div class="panel card-item" style="position:relative; overflow:hidden;">
            ${previewHtml}
            <div style="font-size:12px; color:var(--text-muted); margin-top:10px; margin-bottom:10px;">${f.file.name}</div>
            <button class="btn btn-danger btn-sm" onclick="removeFile(${i})">Remove</button>
          </div>
        `;
      }).join("");
  }
}

window.removeFile = (index) => {
  state.files.splice(index, 1);
  resultsGrid.innerHTML = ""; // Clear grid and re-render
  updateUI();
};

clearBtn.onclick = () => {
  if (state.isRunning) return;
  state.files = [];
  state.results = [];
  resultsGrid.innerHTML = "";
  copyAllBtn.style.display = "none";
  updateUI();
};

creativitySlider.oninput = (e) => {
  creativityValue.textContent = e.target.value;
};

runBtn.onclick = async () => {
  if (state.files.length === 0) return alert("Please select images first.");
  if (!document.getElementById("activeKeySelect").value) return alert(`Please save at least one ${getProviderLabel()} API key first.`);
  if (!getActiveModel()) return alert(`Please fill in the ${getProviderLabel()} model first.`);

  state.isRunning = true;
  state.stopRequested = false;
  state.activeController = new AbortController();
  resultsGrid.innerHTML = "";
  state.results = [];
  copyAllBtn.style.display = "none";
  clearBtn.disabled = true;
  checkConvertingState();
  
  logToConsole(`Starting batch process for ${state.files.length} images via ${getProviderLabel()}...`, "info");

  try {
    for (let i = 0; i < state.files.length; i++) {
      if (state.stopRequested) break;

      const fileItem = state.files[i];
      logToConsole(`[${i+1}/${state.files.length}] Processing: ${fileItem.file.name}`, "info");

      const formData = new FormData();
      formData.append("image", fileItem.file);
      formData.append("model", getActiveModel());
      formData.append("creativity", creativitySlider.value);
      formData.append("camera", cameraSwitch.checked ? "on" : "off");

      try {
        const res = await fetch(getImgToPromptEndpoint(), {
          method: "POST",
          body: formData,
          signal: state.activeController.signal
        });
        
        if (!res.ok) {
          const contentType = res.headers.get("content-type") || "";
          const raw = await res.text();
          if (!contentType.includes("application/json")) {
            throw new Error(`Expected JSON but got: ${raw.slice(0, 200)}`);
          }
          const errData = JSON.parse(raw);
          throw new Error(errData.error || "Failed");
        }

        const contentType = res.headers.get("content-type") || "";
        const raw = await res.text();
        if (!contentType.includes("application/json")) {
          throw new Error(`Expected JSON but got: ${raw.slice(0, 200)}`);
        }
        const data = JSON.parse(raw);
        state.results.push({ fileName: fileItem.file.name, prompt: data.prompt, error: null });
        logToConsole(`[${i+1}/${state.files.length}] Success via ${getProviderLabel()}: ${fileItem.file.name}`, "success");
      } catch (err) {
        if (err.name === "AbortError" || state.stopRequested) {
          break;
        }

        logToConsole(`[${i+1}/${state.files.length}] Failed: ${fileItem.file.name} - ${err.message}`, "error");
        state.results.push({ fileName: fileItem.file.name, prompt: "", error: err.message });
      }
      
      renderResults(state.results);

      if (!state.stopRequested && i < state.files.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (state.stopRequested) {
      logToConsole("Img To Prompt process stopped by user.", "system");
    } else {
      const successCount = state.results.filter(r => !r.error).length;
      logToConsole(`Batch finished! ${successCount}/${state.files.length} successful.`, "success");

      if (successCount > 0) {
        copyAllBtn.style.display = "inline-block";
      }
    }
  } finally {
    state.isRunning = false;
    state.stopRequested = false;
    state.activeController = null;
    clearBtn.disabled = false;
    checkConvertingState();
  }
};

stopBtn.onclick = async () => {
  if (!state.isRunning) return;

  state.stopRequested = true;
  stopBtn.disabled = true;
  logToConsole("Stopping Img To Prompt process...", "system");

  if (state.activeController) {
    state.activeController.abort();
  }

  try {
    await fetch("/api/process-control/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "imgtoprompt" })
    });
  } catch (error) {
    console.warn("Failed to notify server to stop imgtoprompt process:", error);
  }
};

function renderResults(results) {
  resultsGrid.innerHTML = results.map((r, i) => `
    <div class="panel card-item">
      <div style="font-size:12px; font-weight:600; margin-bottom:8px;">${r.fileName}</div>
      ${r.error ? `<div class="error-text" style="color:#f87171; font-size:11px;">${r.error}</div>` : `
        <textarea id="prompt-${i}" class="styled-input" style="width:100%; min-height:100px; font-size:12px; background:rgba(0,0,0,0.2);" readonly>${r.prompt}</textarea>
        <button class="btn btn-secondary btn-sm" style="width:100%; margin-top:10px;" onclick="copyPrompt(${i})">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
           Copy Prompt
        </button>
      `}
    </div>
  `).join("");
}

window.copyPrompt = (index) => {
  const textarea = document.getElementById(`prompt-${index}`);
  textarea.select();
  document.execCommand("copy");
  
  const btn = event.currentTarget;
  const originalText = btn.innerHTML;
  btn.innerHTML = "Copied!";
  btn.classList.add("btn-success");
  setTimeout(() => {
    btn.innerHTML = originalText;
    btn.classList.remove("btn-success");
  }, 2000);
};

copyAllBtn.onclick = () => {
  const allPrompts = state.results
    .filter(r => !r.error && r.prompt)
    .map(r => r.prompt)
    .join("\n\n");
    
  if (!allPrompts) return;
  
  navigator.clipboard.writeText(allPrompts).then(() => {
    const originalText = copyAllBtn.textContent;
    copyAllBtn.textContent = "All Copied!";
    copyAllBtn.classList.add("btn-success");
    setTimeout(() => {
      copyAllBtn.textContent = originalText;
      copyAllBtn.classList.remove("btn-success");
    }, 2000);
  });
};

document.getElementById("providerToggle")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-provider]");
  if (!button) return;
  state.provider = button.dataset.provider === PROVIDERS.SNIFOX ? PROVIDERS.SNIFOX : PROVIDERS.GEMINI;
  localStorage.setItem("sastock_provider", state.provider);
  updateProviderUI();
  await fetchKeys();
});

document.getElementById("snifoxModelInput")?.addEventListener("input", (event) => {
  localStorage.setItem(SNIFOX_MODEL_STORAGE_KEY, event.target.value);
});

if (document.getElementById("snifoxModelInput")) {
  document.getElementById("snifoxModelInput").value = localStorage.getItem(SNIFOX_MODEL_STORAGE_KEY) || DEFAULT_SNIFOX_MODEL;
}

init();
