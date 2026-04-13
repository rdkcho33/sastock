// prompt-studio.js

const state = {
  user: null,
  lang: 'en',
  results: [],
  isGenerating: false
};

// --- LOG CONSOLE UTILITY ---
const logBody = document.getElementById("logBody");
const toggleLogBtn = document.getElementById("toggleLogBtn");
const clearLogBtn = document.getElementById("clearLogBtn");
const logConsole = document.getElementById("logConsole");

function logToConsole(message, type = "info") {
  if (!logBody) return;
  const entry = document.createElement("div");
  const time = new Date().toLocaleTimeString();
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${time}] ${message}`;
  logBody.appendChild(entry);
  logBody.scrollTop = logBody.scrollHeight;
}

if (toggleLogBtn) {
  toggleLogBtn.onclick = () => {
    logConsole.classList.toggle("minimized");
    toggleLogBtn.querySelector("svg").style.transform = logConsole.classList.contains("minimized") ? "rotate(0deg)" : "rotate(180deg)";
  };
}

if (clearLogBtn) {
  clearLogBtn.onclick = () => {
    logBody.innerHTML = '<div class="log-entry system">Logs cleared.</div>';
  };
}

// --- AUTH ---
async function init() {
  try {
    const res = await fetch("/api/auth/me");
    const auth = await res.json();
    if (!auth.authenticated) {
      window.location.href = "/login.html";
      return;
    }
    state.user = auth.user;
    document.getElementById("userName").textContent = state.user.username;
    document.getElementById("userRole").textContent = state.user.role;
    document.getElementById("userProfile").style.display = "flex";
    
    await fetchKeys();
  } catch (err) {
    window.location.href = "/login.html";
  }
}

async function fetchKeys() {
  try {
    const res = await fetch("/api/keys");
    const data = await res.json();
    const select = document.getElementById("activeKeySelect");
    
    if (data.keys && data.keys.length > 0) {
      select.innerHTML = data.keys.map(k => `<option value="${k.key_value}">${k.label}</option>`).join("");
    } else {
      select.innerHTML = '<option value="">No keys found</option>';
    }
  } catch (err) {
    console.error("Failed to fetch keys");
  }
}

document.getElementById("logoutBtn").onclick = async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
};

// --- LANGUAGE TOGGLE ---
window.setLang = (l) => {
  state.lang = l;
  document.getElementById("langEN").classList.toggle("active", l === 'en');
  document.getElementById("langID").classList.toggle("active", l === 'id');
  logToConsole(`Output language set to: ${l === 'id' ? 'Indonesia' : 'English'}`, "system");
};

// --- GENERATION LOGIC ---
const generateBtn = document.getElementById("generateBtn");
const resultsList = document.getElementById("resultsList");
const copyAllBtn = document.getElementById("copyAllBtn");
const clearBtn = document.getElementById("clearBtn");

generateBtn.onclick = async () => {
  const purpose = document.getElementById("purposeInput").value.trim();
  const object = document.getElementById("objectInput").value.trim();
  const batchCount = parseInt(document.getElementById("batchCount").value) || 1;
  const model = document.getElementById("modelSelect").value;
  
  if (!purpose || !object) return alert("Please fill in both Purpose and Object.");
  if (batchCount > 50) return alert("Maximum batch count is 50.");
  
  state.isGenerating = true;
  generateBtn.disabled = true;
  generateBtn.innerHTML = `<span>Generating 0/${batchCount}...</span>`;
  logToConsole(`Starting production of ${batchCount} prompts...`, "info");

  for (let i = 0; i < batchCount; i++) {
    const tempId = Date.now() + i;
    addPendingCard(tempId, i + 1);
    
    try {
      const res = await fetch("/api/prompt-studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose, object, lang: state.lang, model })
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Generation failed");
      }
      
      const data = await res.json();
      updateCard(tempId, data.prompt);
      state.results.push(data.prompt);
      logToConsole(`[${i+1}/${batchCount}] Success!`, "success");
    } catch (err) {
      updateCardError(tempId, err.message);
      logToConsole(`[${i+1}/${batchCount}] Failed: ${err.message}`, "error");
    }
    
    generateBtn.innerHTML = `<span>Generating ${i+1}/${batchCount}...</span>`;
    if (state.results.length > 0) copyAllBtn.style.display = "inline-block";
    
    // Set 2 second delay to avoid Gemini rate limits
    await new Promise(r => setTimeout(r, 2000));
  }
  
  state.isGenerating = false;
  generateBtn.disabled = false;
  generateBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path><path d="M5 3v4"></path><path d="M19 17v4"></path><path d="M3 5h4"></path><path d="M17 19h4"></path></svg> Generate Stock Prompts`;
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

window.copyCardPrompt = (btn) => {
  const text = btn.previousElementSibling.value;
  navigator.clipboard.writeText(text);
  const original = btn.innerText;
  btn.innerText = "Copied!";
  btn.classList.add("btn-success");
  setTimeout(() => {
    btn.innerText = original;
    btn.classList.remove("btn-success");
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
  resultsList.innerHTML = "";
  state.results = [];
  copyAllBtn.style.display = "none";
  logToConsole("Workspace cleared.", "system");
};

init();
