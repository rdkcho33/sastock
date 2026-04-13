const state = {
  user: null,
  keys: [],
  mode: "AUTO",
  lastResults: []
};

// UI Elements
const modelSelect = document.getElementById("modelSelect");
const languageSelect = document.getElementById("languageSelect");
const batchCount = document.getElementById("batchCount");
const generateBtn = document.getElementById("generateBtn");
const resultsGrid = document.getElementById("resultsGrid");
const resultsHeader = document.getElementById("resultsHeader");
const emptyState = document.getElementById("emptyState");
const activeKeySelect = document.getElementById("activeKeySelect");
const copyAllBtn = document.getElementById("copyAllBtn");

// Inputs
const tujuanInput = document.getElementById("tujuanInput");
const objekInput = document.getElementById("objekInput");
const ekspresiInput = document.getElementById("ekspresiInput");
const aktivitasiInput = document.getElementById("aktivitasiInput");
const backgroundInput = document.getElementById("backgroundInput");
const manualFields = document.querySelectorAll(".manual-only");

// Mode Switching
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelector(".mode-btn.active").classList.remove("active");
    btn.classList.add("active");
    state.mode = btn.getAttribute("data-mode");
    
    if (state.mode === "MANUAL") {
      manualFields.forEach(f => f.classList.remove("disabled"));
    } else {
      manualFields.forEach(f => f.classList.add("disabled"));
    }
  };
});

async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = "/login.html";
      return;
    }
    state.user = data.user;
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
    state.keys = data.keys;
    if (state.keys.length > 0) {
      activeKeySelect.innerHTML = state.keys.map(k => `<option value="${k.key_value}">${k.label}</option>`).join("");
    } else {
      activeKeySelect.innerHTML = '<option value="">No keys saved</option>';
    }
  } catch (err) {
    console.error("Failed to fetch keys", err);
  }
}

generateBtn.onclick = async () => {
  if (!tujuanInput.value.trim() || !objekInput.value.trim()) {
    return alert("Tujuan dan Objek wajib diisi!");
  }

  generateBtn.disabled = true;
  generateBtn.innerHTML = "Processing Batch...";
  emptyState.style.display = "none";
  resultsHeader.style.display = "none";

  const payload = {
    mode: state.mode,
    tujuan: tujuanInput.value.trim(),
    objek: objekInput.value.trim(),
    ekspresi: ekspresiInput.value.trim(),
    aktivitas: aktivitasiInput.value.trim(),
    background: backgroundInput.value.trim(),
    count: parseInt(batchCount.value) || 1,
    model: modelSelect.value,
    language: languageSelect.value
  };

  try {
    const res = await fetch("/api/prompt-studio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Generation failed");

    state.lastResults = data.results || [];
    renderResults(state.lastResults);
  } catch (err) {
    alert(err.message);
    emptyState.style.display = "block";
  } finally {
    generateBtn.disabled = false;
    generateBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      Generate Batch (AI Thinking...)
    `;
  }
};

function renderResults(results) {
  resultsGrid.innerHTML = "";
  if (!results || results.length === 0) {
    emptyState.style.display = "block";
    resultsHeader.style.display = "none";
    return;
  }

  resultsHeader.style.display = "flex";

  results.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "card-result animate-fade-in";
    
    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
            <span class="badge-role" style="background: var(--accent-color);">PROMPT #${index + 1}</span>
            <button class="btn btn-secondary btn-sm" onclick="copyText(this, '${item.prompt.replace(/'/g, "\\'").replace(/\n/g, "\\n")}')">Copy</button>
        </div>
        <div class="prompt-text">${item.prompt}</div>
    `;
    resultsGrid.appendChild(card);
  });
}

copyAllBtn.onclick = () => {
    if (!state.lastResults.length) return;
    const allText = state.lastResults.map(r => r.prompt).join("\n");
    copyText(copyAllBtn, allText);
};

window.copyText = (btn, text) => {
    navigator.clipboard.writeText(text).then(() => {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = "Copied!";
        btn.classList.add("btn-success");
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.classList.remove("btn-success");
        }, 2000);
    });
};

document.getElementById("logoutBtn").onclick = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login.html";
};

// Start
checkAuth();
