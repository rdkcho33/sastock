// imgtoprompt.js

const state = {
  user: null,
  files: [],
  results: []
};

// Elements
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const creativitySlider = document.getElementById("creativitySlider");
const creativityValue = document.getElementById("creativityValue");
const cameraSwitch = document.getElementById("cameraSwitch");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const copyAllBtn = document.getElementById("copyAllBtn");
const resultsGrid = document.getElementById("resultsGrid");
const fileCountLabel = document.getElementById("fileCount");

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
  runBtn.disabled = isAnyConverting || state.files.length === 0;
  if (isAnyConverting) {
    runBtn.innerHTML = "Processing Vectors...";
  } else {
    runBtn.innerHTML = "Generate All Prompts";
  }
}

function updateUI() {
  fileCountLabel.textContent = `${state.files.length} images selected`;
  renderPendingCards();
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
  
  runBtn.disabled = true;
  runBtn.innerHTML = "Processing Queue...";
  resultsGrid.innerHTML = "";
  state.results = [];
  copyAllBtn.style.display = "none";
  
  logToConsole(`Starting batch process for ${state.files.length} images...`, "info");

  for (let i = 0; i < state.files.length; i++) {
    const fileItem = state.files[i];
    
    // Create a mini-log for this image
    logToConsole(`[${i+1}/${state.files.length}] Processing: ${fileItem.file.name}`, "info");

    const formData = new FormData();
    formData.append("image", fileItem.file);
    formData.append("model", document.getElementById("modelSelect").value);
    formData.append("creativity", creativitySlider.value);
    formData.append("camera", cameraSwitch.checked ? "on" : "off");

    try {
      const res = await fetch("/api/imgtoprompt/single", {
        method: "POST",
        body: formData
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
      logToConsole(`[${i+1}/${state.files.length}] Success: ${fileItem.file.name}`, "success");
    } catch (err) {
      logToConsole(`[${i+1}/${state.files.length}] Failed: ${fileItem.file.name} - ${err.message}`, "error");
      state.results.push({ fileName: fileItem.file.name, prompt: "", error: err.message });
    }
    
    // Render results immediately after each image is done
    renderResults(state.results);
    
    // Set 2 second delay to avoid Gemini rate limits
    await new Promise(r => setTimeout(r, 2000));
  }

  runBtn.disabled = false;
  runBtn.innerHTML = "Generate All Prompts";
  
  const successCount = state.results.filter(r => !r.error).length;
  logToConsole(`Batch finished! ${successCount}/${state.files.length} successful.`, "success");
  
  if (successCount > 0) {
    copyAllBtn.style.display = "inline-block";
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

init();
