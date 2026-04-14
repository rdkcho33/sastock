const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const cardsContainer = document.getElementById("cardsContainer");
const generateButton = document.getElementById("generateButton");
const stopButton = document.getElementById("stopButton");
const resumeButton = document.getElementById("resumeButton");
const exportButton = document.getElementById("exportButton");
const clearAllButton = document.getElementById("clearAllButton");

const titleLength = document.getElementById("titleLength");
const titleLengthLabel = document.getElementById("titleLengthLabel");
const keywordCount = document.getElementById("keywordCount");
const keywordCountLabel = document.getElementById("keywordCountLabel");
const apiKeysInput = document.getElementById("apiKeysInput");
const modelSelect = document.getElementById("modelSelect");
const prefixEnabled = document.getElementById("prefixEnabled");
const prefixText = document.getElementById("prefixText");
const suffixEnabled = document.getElementById("suffixEnabled");
const suffixText = document.getElementById("suffixText");
const negativeTitleWords = document.getElementById("negativeTitleWords");
const negativeKeywords = document.getElementById("negativeKeywords");
const summaryFiles = document.getElementById("summaryFiles");
const summaryDone = document.getElementById("summaryDone");
const summaryFailed = document.getElementById("summaryFailed");
const fileCountLabel = document.getElementById("fileCount");
const fileSizeLabel = document.getElementById("fileSize");

// ImgToPrompt Elements
const imgToPromptBtn = document.getElementById("imgToPromptBtn");
const imgToPromptModal = document.getElementById("imgToPromptModal");
const closeImgToPromptModal = document.getElementById("closeImgToPromptModal");
const creativitySlider = document.getElementById("creativitySlider");
const creativityValue = document.getElementById("creativityValue");
const cameraSwitch = document.getElementById("cameraSwitch");
const runImgToPromptBtn = document.getElementById("runImgToPromptBtn");
const imgToPromptResult = document.getElementById("imgToPromptResult");
// --- ImgToPrompt Redirect Logic ---
if (imgToPromptBtn) {
  imgToPromptBtn.onclick = () => {
    window.location.href = "imgtoprompt.html";
  };
}

// --- LOG CONSOLE UTILITY ---
const logConsole = document.getElementById("logConsole");
const logBody = document.getElementById("logBody");
const toggleLogBtn = document.getElementById("toggleLogBtn");
const clearLogBtn = document.getElementById("clearLogBtn");

function logToConsole(message, type = "info") {
  const entry = document.createElement("div");
  const time = new Date().toLocaleTimeString();
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${time}] ${message}`;
  logBody.appendChild(entry);
  logBody.scrollTop = logBody.scrollHeight;
  
  // Also show in browser console
  if (type === "error") console.error(`[LOG] ${message}`);
  else console.log(`[LOG] ${message}`);
}

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

clearLogBtn.onclick = (e) => {
  e.stopPropagation();
  logBody.innerHTML = '<div class="log-entry system">Logs cleared.</div>';
};

// Header click also toggles
document.querySelector(".log-header").onclick = () => {
    logConsole.classList.toggle("minimized");
};

const state = {
  files: [],
  user: null,
  keys: [],
  activeKey: null,
  isGenerating: false,
  stopRequested: false,
  activeController: null
};

// --- AUTH & INITIALIZATION ---

async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me");
    const contentType = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (!contentType.includes("application/json")) {
      throw new Error(`Expected JSON but got: ${raw.slice(0, 200)}`);
    }
    const data = JSON.parse(raw);
    if (!data.authenticated) {
      window.location.href = "/login.html";
      return;
    }
    state.user = data.user;
    document.getElementById("userName").textContent = state.user.username;
    document.getElementById("userRole").textContent = state.user.role;
    document.getElementById("userProfile").style.display = "flex";
    
    // Show admin button if role is admin
    if (state.user.role === "admin") {
       document.getElementById("adminPanelBtn").style.display = "flex";
       await fetchUsers();
    }

    await fetchKeys();
  } catch (err) {
    console.error("Auth check failed", err);
    window.location.href = "/login.html";
  }
}

async function fetchKeys() {
  try {
    const res = await fetch("/api/keys");
    const contentType = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (!contentType.includes("application/json")) {
      throw new Error(`Expected JSON but got: ${raw.slice(0, 200)}`);
    }
    const data = JSON.parse(raw);
    state.keys = data.keys;
    renderKeySelector();
    renderKeyList();
  } catch (err) {
    console.error("Failed to fetch keys", err);
  }
}

function renderKeySelector() {
  const select = document.getElementById("activeKeySelect");
  const counter = document.getElementById("apiKeyCounter");
  
  if (state.keys.length === 0) {
    select.innerHTML = '<option value="">No keys saved</option>';
    counter.textContent = "0 keys available";
    return;
  }

  select.innerHTML = state.keys.map(k => `
    <option value="${k.key_value}">${k.label} (${k.key_value.substring(0, 4)}...${k.key_value.substring(k.key_value.length - 4)})</option>
  `).join("");
  
  counter.textContent = `${state.keys.length} keys available`;
}

function renderKeyList() {
  const list = document.getElementById("keyList");
  list.innerHTML = state.keys.map(k => `
    <div class="key-item">
      <div class="key-item-info">
        <span class="key-item-label">${k.label}</span>
        <span class="key-item-stub">${k.key_value.substring(0, 8)}...</span>
      </div>
      <button class="btn-icon delete" onclick="deleteKey(${k.id})">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    </div>
  `).join("");
}

window.deleteKey = async (id) => {
  if (!confirm("Are you sure you want to delete this key?")) return;
  try {
    await fetch(`/api/keys/${id}`, { method: "DELETE" });
    await fetchKeys();
  } catch (err) {
    alert("Failed to delete key");
  }
};

// --- MODAL HANDLERS ---
const keyModal = document.getElementById("keyModal");
const manageKeysBtn = document.getElementById("manageKeysBtn");
const closeKeyModal = document.getElementById("closeKeyModal");
const addKeyForm = document.getElementById("addKeyForm");

manageKeysBtn.onclick = () => keyModal.classList.add("active");
closeKeyModal.onclick = () => keyModal.classList.remove("active");

addKeyForm.onsubmit = async (e) => {
  e.preventDefault();
  const rawValue = document.getElementById("batchKeys").value;
  const keys = rawValue.split("\n").map(k => k.trim()).filter(Boolean);
  
  if (keys.length === 0) return alert("Please enter at least one key.");

  try {
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys })
    });
    
    const contentType = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (!contentType.includes("application/json")) {
      throw new Error(`Expected JSON but got: ${raw.slice(0, 200)}`);
    }
    const data = JSON.parse(raw);
    
    if (res.ok) {
      addKeyForm.reset();
      await fetchKeys();
      // Close modal on success for better UX
      keyModal.classList.remove("active");
    } else {
      alert(data.error || "Failed to add keys");
    }
  } catch (err) {
    console.error(err);
    alert("Error connecting to server");
  }
};

document.getElementById("logoutBtn").onclick = async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
};

// --- ADMIN HANDLERS ---
const adminModal = document.getElementById("adminModal");
const adminPanelBtn = document.getElementById("adminPanelBtn");
const closeAdminModal = document.getElementById("closeAdminModal");
const addUserForm = document.getElementById("addUserForm");

adminPanelBtn.onclick = () => adminModal.classList.add("active");
closeAdminModal.onclick = () => adminModal.classList.remove("active");

async function fetchUsers() {
  try {
    const res = await fetch("/api/admin/users");
    const contentType = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (!contentType.includes("application/json")) {
      throw new Error(`Expected JSON but got: ${raw.slice(0, 200)}`);
    }
    const data = JSON.parse(raw);
    renderUserList(data.users);
  } catch (err) {
    console.error("Failed to fetch users", err);
  }
}

function renderUserList(users) {
  const container = document.getElementById("userList");
  container.innerHTML = users.map(u => `
    <div class="key-item">
      <div class="key-item-info">
        <span class="key-item-label">${u.username}</span>
        <span class="badge-role">${u.role}</span>
      </div>
      ${u.id !== state.user.id ? `
        <button class="btn-icon delete" onclick="deleteUser(${u.id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      ` : ""}
    </div>
  `).join("");
}

window.deleteUser = async (id) => {
  if (!confirm("Are you sure you want to delete this user?")) return;
  try {
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (res.ok) await fetchUsers();
  } catch (err) {
    alert("Failed to delete user");
  }
};

addUserForm.onsubmit = async (e) => {
  e.preventDefault();
  const username = document.getElementById("newUsername").value;
  const password = document.getElementById("newUserPassword").value;
  
  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (res.ok) {
      addUserForm.reset();
      await fetchUsers();
    } else {
      const contentType = res.headers.get("content-type") || "";
      const raw = await res.text();
      if (!contentType.includes("application/json")) {
        throw new Error(`Expected JSON but got: ${raw.slice(0, 200)}`);
      }
      const data = JSON.parse(raw);
      alert(data.error || "Failed to create user");
    }
  } catch (err) {
    alert("Error creating user");
  }
};

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateSummary() {
  summaryFiles.textContent = state.files.length;
  summaryDone.textContent = state.files.filter((item) => item.status === "done").length;
  summaryFailed.textContent = state.files.filter((item) => item.status === "failed").length;
  fileCountLabel.textContent = `${state.files.length} files ready`;
  const totalBytes = state.files.reduce((sum, file) => sum + file.file.size, 0);
  fileSizeLabel.textContent = formatBytes(totalBytes);
}

function getMimeIcon(file) {
  if (file.type.startsWith("image/")) return "🖼️";
  if (file.type.startsWith("video/")) return "🎬";
  if (file.name.toLowerCase().endsWith(".svg")) return "🧩";
  if (file.name.toLowerCase().endsWith(".eps")) return "📐";
  return "📄";
}

function createCard(fileItem) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.id = fileItem.id;

  const preview = document.createElement("div");
  preview.className = "card-preview";
  
  if (fileItem.status === "converting") {
    const overlay = document.createElement("div");
    overlay.className = "card-loading-overlay";
    overlay.innerHTML = `
      <div class="spinner"></div>
      <div class="processing-text">Converting Vector...</div>
    `;
    preview.appendChild(overlay);
  } else if (fileItem.previewUrl) {
    const img = document.createElement("img");
    img.src = fileItem.previewUrl;
    preview.appendChild(img);
  } else if (fileItem.file.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(fileItem.file);
    img.alt = fileItem.file.name;
    preview.appendChild(img);
  } else if (fileItem.file.type.startsWith("video/")) {
    const videoPlaceholder = document.createElement("div");
    videoPlaceholder.className = "video-placeholder";
    videoPlaceholder.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    preview.appendChild(videoPlaceholder);
  } else {
    const icon = document.createElement("div");
    icon.className = "file-icon";
    icon.textContent = getMimeIcon(fileItem.file);
    preview.appendChild(icon);
  }
  
  card.appendChild(preview);

  const content = document.createElement("div");
  content.className = "card-content";

  const header = document.createElement("div");
  header.className = "card-header";
  
  const titleMetaWrapper = document.createElement("div");
  const name = document.createElement("h3");
  name.className = "card-title";
  name.textContent = fileItem.file.name;
  titleMetaWrapper.appendChild(name);
  
  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = `Size: ${formatBytes(fileItem.file.size)}`;
  titleMetaWrapper.appendChild(meta);

  header.appendChild(titleMetaWrapper);

  const status = document.createElement("div");
  status.className = `status-badge status-${fileItem.status}`;
  status.textContent = fileItem.status.toUpperCase();
  header.appendChild(status);

  content.appendChild(header);

  const inputs = document.createElement("div");
  inputs.className = "card-inputs";

  // Title
  const titleGroup = document.createElement("div");
  titleGroup.className = "input-group";
  const titleLabel = document.createElement("label");
  titleLabel.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg> Title`;
  const titleInput = document.createElement("textarea");
  titleInput.placeholder = "Title will appear here...";
  titleInput.value = fileItem.title || "";
  titleInput.rows = 2;
  titleInput.addEventListener("input", () => {
    fileItem.title = titleInput.value;
  });
  titleGroup.appendChild(titleLabel);
  titleGroup.appendChild(titleInput);
  inputs.appendChild(titleGroup);

  // Description
  const descriptionGroup = document.createElement("div");
  descriptionGroup.className = "input-group";
  const descriptionLabel = document.createElement("label");
  descriptionLabel.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg> Description`;
  const descriptionInput = document.createElement("textarea");
  descriptionInput.placeholder = "Description will appear here...";
  descriptionInput.value = fileItem.description || "";
  descriptionInput.rows = 3;
  descriptionInput.addEventListener("input", () => {
    fileItem.description = descriptionInput.value;
  });
  descriptionGroup.appendChild(descriptionLabel);
  descriptionGroup.appendChild(descriptionInput);
  inputs.appendChild(descriptionGroup);

  // Keywords
  const keywordsGroup = document.createElement("div");
  keywordsGroup.className = "input-group";
  const keywordsLabel = document.createElement("label");
  const updateKeywordsCount = () => {
    keywordsLabel.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Keywords (${(fileItem.keywords || []).length})`;
  };
  updateKeywordsCount();
  const keywordsInput = document.createElement("textarea");
  keywordsInput.placeholder = "Keywords will appear here...";
  keywordsInput.rows = 2;
  keywordsInput.value = (fileItem.keywords || []).join(", ");
  keywordsInput.addEventListener("input", () => {
    fileItem.keywords = keywordsInput.value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    updateKeywordsCount();
  });
  keywordsGroup.appendChild(keywordsLabel);
  keywordsGroup.appendChild(keywordsInput);
  inputs.appendChild(keywordsGroup);

  content.appendChild(inputs);

  if (fileItem.error) {
    const error = document.createElement("div");
    error.className = "card-error";
    error.textContent = fileItem.error;
    content.appendChild(error);
  }

  // Card Actions
  const actions = document.createElement("div");
  actions.className = "card-actions";
  
  const copyBtn = document.createElement("button");
  copyBtn.className = "btn-icon";
  copyBtn.title = "Copy Keywords";
  copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(keywordsInput.value);
  });
  
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn-icon delete";
  deleteBtn.title = "Remove File";
  deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
  deleteBtn.addEventListener("click", () => {
    state.files = state.files.filter(f => f.id !== fileItem.id);
    updateSummary();
    renderCards();
  });

  const regenBtn = document.createElement("button");
  regenBtn.className = "btn-icon";
  regenBtn.style.marginLeft = "auto"; 
  regenBtn.style.background = "#fff";
  regenBtn.style.color = "#000";
  regenBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> <span style="margin-left:6px; font-weight:500; font-size:12px">Regenerate</span>`;
  regenBtn.addEventListener("click", () => {
    logToConsole(`Regenerating metadata for: ${fileItem.file.name}`, "info");
    fileItem.status = "processing";
    fileItem.error = null;
    renderCards();
    runGeneration([fileItem]);
  });

  actions.appendChild(copyBtn);
  actions.appendChild(deleteBtn);
  actions.appendChild(regenBtn);

  content.appendChild(actions);

  card.appendChild(content);

  return card;
}

function renderCards() {
  cardsContainer.innerHTML = "";
  state.files.forEach((fileItem) => {
    const card = createCard(fileItem);
    cardsContainer.appendChild(card);
  });
}

function addFiles(acceptedFiles) {
  const existing = new Set(state.files.map((item) => item.file.name + item.file.size));
  for (const file of acceptedFiles) {
    if (state.files.length >= 100) break;
    const fingerprint = file.name + file.size;
    if (existing.has(fingerprint)) continue;
    
    const ext = file.name.split('.').pop().toLowerCase();
    const isVector = ext === 'svg' || ext === 'eps';
    
    const fileItem = {
      id: `${file.name}-${file.size}-${Date.now()}`,
      file,
      title: "",
      description: "",
      keywords: [],
      status: isVector ? "converting" : "pending",
      error: null,
      previewUrl: null
    };
    
    state.files.push(fileItem);
    existing.add(fingerprint);
    logToConsole(`Added file: ${file.name}`, "info");

    if (isVector) {
      processVectorFile(fileItem);
    }
  }
  updateSummary();
  renderCards();
  checkConvertingState();
}

async function processVectorFile(fileItem) {
  logToConsole(`Vector processing: ${fileItem.file.name}...`, "info");
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
    fileItem.error = "Vector conversion failed: " + err.message;
    logToConsole(`Vector conversion failed: ${fileItem.file.name}`, "error");
  } finally {
    renderCards();
    checkConvertingState();
  }
}

function checkConvertingState() {
  const isAnyConverting = state.files.some(f => f.status === "converting");
  generateButton.disabled = state.isGenerating || isAnyConverting || state.files.length === 0;
  stopButton.style.display = state.isGenerating ? "inline-flex" : "none";

  if (state.isGenerating) {
    generateButton.innerHTML = "Generating...";
  } else if (isAnyConverting) {
    generateButton.innerHTML = "Processing Vectors...";
  } else {
    generateButton.innerHTML = `Generate Metadata (${state.files.length})`;
  }
}

function normalizePlatformSelection() {
  return Array.from(document.querySelectorAll(".platformCheckbox:checked")).map((input) => input.value);
}

function prepareFormData(items) {
  const form = new FormData();
  items.forEach((item) => form.append("files", item.file));
  // API keys are now handled server-side if not explicitly sent.
  // We can still send the active one if we want rotation to be handled by the server.
  // For now, let's let the server use all stored keys.
  form.append("model", modelSelect.value);
  form.append("titleLength", titleLength.value);
  form.append("keywordCount", keywordCount.value);
  form.append("prefixEnabled", prefixEnabled.checked);
  form.append("prefixText", prefixText.value);
  form.append("suffixEnabled", suffixEnabled.checked);
  form.append("suffixText", suffixText.value);
  form.append("negativeTitleWords", negativeTitleWords.value);
  form.append("negativeKeywords", negativeKeywords.value);
  normalizePlatformSelection().forEach((platform) => form.append("platforms", platform));
  return form;
}

async function requestStop(tool) {
  try {
    await fetch("/api/process-control/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool })
    });
  } catch (error) {
    console.warn("Failed to notify server to stop process:", error);
  }
}

function setProcessingUI(isRunning) {
  state.isGenerating = isRunning;
  stopButton.style.display = isRunning ? "inline-flex" : "none";
  stopButton.disabled = !isRunning;
  resumeButton.disabled = isRunning;
  exportButton.disabled = isRunning;
  clearAllButton.disabled = isRunning;
  checkConvertingState();
}

function escapeCsv(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function runGeneration(items) {
  if (state.keys.length === 0) {
    alert("You haven't saved any Gemini API Keys yet. Click 'Manage' to add one.");
    return;
  }

  if (state.isGenerating) {
    return;
  }

  state.stopRequested = false;
  state.activeController = new AbortController();
  setProcessingUI(true);

  logToConsole(`Starting generation for ${items.length} file(s)...`, "system");
  let activeItem = null;

  try {
    for (const item of items) {
      if (state.stopRequested) break;

      activeItem = item;
      logToConsole(`File "${item.file.name}": Uploading and processing...`, "info");

      const form = new FormData();
      form.append("files", item.file);
      form.append("model", modelSelect.value);
      form.append("titleLength", titleLength.value);
      form.append("keywordCount", keywordCount.value);
      form.append("prefixEnabled", prefixEnabled.checked);
      form.append("prefixText", prefixText.value);
      form.append("suffixEnabled", suffixEnabled.checked);
      form.append("suffixText", suffixText.value);
      form.append("negativeTitleWords", negativeTitleWords.value);
      form.append("negativeKeywords", negativeKeywords.value);
      normalizePlatformSelection().forEach((platform) => form.append("platforms", platform));

      item.status = "processing";
      item.error = null;
      renderCards();
      updateSummary();

      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          body: form,
          signal: state.activeController.signal
        });
        const contentType = response.headers.get("content-type") || "";
        const raw = await response.text();
        if (!contentType.includes("application/json")) {
          throw new Error(`Expected JSON but got: ${raw.slice(0, 200)}`);
        }
        const data = JSON.parse(raw);
        
        if (!response.ok) throw new Error(data.error || "Server error");

        const result = data.items[0];
        if (!result || result.status === "failed") throw new Error(result?.error || "AI processing failed");

        item.status = "done";
        item.title = result.title;
        item.description = result.description;
        item.keywords = result.keywords;
        item.categoryAdobe = result.categoryAdobe;
        item.categoryShutterstock = result.categoryShutterstock;
        
        logToConsole(`File "${item.file.name}": Successfully generated!`, "success");
      } catch (error) {
        if (error.name === "AbortError" || state.stopRequested) {
          item.status = "pending";
          item.error = null;
          break;
        }

        item.status = "failed";
        item.error = error.message;
        logToConsole(`File "${item.file.name}": Error - ${error.message}`, "error");
      } finally {
        renderCards();
        updateSummary();
      }
    }

    if (state.stopRequested) {
      logToConsole("Metadata process stopped by user.", "system");
    } else {
      logToConsole("All tasks in the current batch completed.", "system");
    }
  } finally {
    if (state.stopRequested && activeItem?.status === "processing") {
      activeItem.status = "pending";
      activeItem.error = null;
    }

    state.stopRequested = false;
    state.activeController = null;
    setProcessingUI(false);
    renderCards();
    updateSummary();
  }
}

generateButton.addEventListener("click", () => {
  if (!state.files.length) {
    alert("Tambahkan file terlebih dahulu.");
    return;
  }
  state.files.forEach((item) => {
    item.status = "pending";
    item.error = null;
  });
  renderCards();
  runGeneration(state.files);
});

stopButton.addEventListener("click", async () => {
  if (!state.isGenerating) {
    return;
  }

  state.stopRequested = true;
  stopButton.disabled = true;
  logToConsole("Stopping metadata process...", "system");

  if (state.activeController) {
    state.activeController.abort();
  }

  await requestStop("metadata");
});

resumeButton.addEventListener("click", () => {
  const failedItems = state.files.filter((item) => item.status === "failed");
  if (!failedItems.length) {
    alert("Tidak ada item yang gagal untuk dilanjutkan.");
    return;
  }
  failedItems.forEach((item) => {
    item.status = "pending";
    item.error = null;
  });
  renderCards();
  runGeneration(failedItems);
});

exportButton.addEventListener("click", () => {
  if (!state.files.length) {
    alert("Tidak ada metadata untuk diekspor.");
    return;
  }

  const selectedPlatforms = normalizePlatformSelection();
  if (!selectedPlatforms.length) {
    alert("Pilih minimal satu platform.");
    return;
  }

  // CLEAN TEXT
  function clean(text) {
    return String(text || "")
      .replace(/\r?\n/g, " ")
      .replace(/"/g, '""')
      .trim();
  }

  function csvRow(arr, separator = ",") {
    return arr.map(v => `"${clean(v)}"`).join(separator);
  }

  function download(filename, content) {
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // ======================
  // ADOBE STOCK
  // ======================
  function exportAdobe() {
    const header = ["Filename", "Title", "Keywords", "Category", "Releases"];
    const rows = state.files.map(item => {
      // Adobe has 70 char limit and NO COMMAS in title for CSV
      const title = clean(item.title).replace(/,/g, "").slice(0, 70);
      const keywords = (item.keywords || []).slice(0, 49).join(", ");

      return [
        item.file.name,
        title,
        keywords,
        item.categoryAdobe || "11", // default to 11 (Landscape) if missing
        ""
      ];
    });

    const csv = [
      csvRow(header),
      ...rows.map(r => csvRow(r))
    ].join("\n");

    download("adobe_stock.csv", csv);
  }

  // ======================
  // SHUTTERSTOCK
  // ======================
  function exportShutterstock() {
    // Header WITHOUT quotes
    const header = "Filename,Description,Keywords,Categories,Editorial,Mature content,illustration";

    const rows = state.files.map(item => {
      // Columns 1-4 are quoted text, 5-7 are unquoted booleans
      const fName = `"${clean(item.file.name)}"`;
      const desc = `"${clean(item.description || "")}"`;
      const keyw = `"${(item.keywords || []).slice(0, 50).join(", ")}"`;
      const cats = `"${item.categoryShutterstock || "People"}"`;
      
      return `${fName},${desc},${keyw},${cats},no,no,no`;
    });

    const csv = [header, ...rows].join("\n");
    download("shutterstock.csv", csv);
  }

  // ======================
  // VECTEEZY
  // ======================
  function exportVecteezy() {
    const header = ["Filename", "Title", "Description", "Keywords"];

    const rows = state.files.map(item => [
      item.file.name,
      item.title,
      item.description,
      (item.keywords || []).join(", ")
    ]);

    const csv = [
      csvRow(header),
      ...rows.map(r => csvRow(r))
    ].join("\n");

    download("vecteezy.csv", csv);
  }

  // ======================
  // FREEPIK (pakai ;)
  // ======================
  function exportFreepik() {
    const header = ["File name", "Title", "Keywords", "Prompt", "Model"];

    const rows = state.files.map(item => [
      item.file.name,
      item.title,
      (item.keywords || []).join(", ") + ", _ai_generated",
      item.description || "",
      "Midjourney"
    ]);

    const csv = [
      header.join(";"),
      ...rows.map(r => r.map(v => clean(v)).join(";"))
    ].join("\n");

    download("freepik.csv", csv);
  }

  // ======================
  // RUN EXPORT
  // ======================
  selectedPlatforms.forEach(p => {
    if (p === "Adobe Stock") exportAdobe();
    if (p === "Shutterstock") exportShutterstock();
    if (p === "Vecteezy") exportVecteezy();
    if (p === "Freepik") exportFreepik();
  });
});

function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.remove("dragover");
  addFiles(Array.from(event.dataTransfer.files));
}

function handleDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.add("dragover");
}

function handleDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.remove("dragover");
}

fileInput.addEventListener("change", () => {
  addFiles(Array.from(fileInput.files));
});

dropZone.addEventListener("dragover", handleDragOver);
dropZone.addEventListener("dragleave", handleDragLeave);
dropZone.addEventListener("drop", handleDrop);

clearAllButton.addEventListener("click", () => {
  state.files = [];
  updateSummary();
  renderCards();
});

titleLength.addEventListener("input", () => {
  titleLengthLabel.textContent = titleLength.value;
});

keywordCount.addEventListener("input", () => {
  keywordCountLabel.textContent = keywordCount.value;
});

checkAuth();
updateSummary();
renderCards();
