import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { spawn, exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { Readable } from "stream";

const execPromise = promisify(exec);
import db from "./db.js";
import bcrypt from "bcrypt";
import session from "express-session";
import createSqliteStore from "connect-sqlite3";

const SQLiteStore = createSqliteStore(session);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const GHOSTSCRIPT_BIN =
  process.env.GHOSTSCRIPT_BIN ||
  (process.platform === "win32" ? "gswin64c" : "gs");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 100,
    fileSize: 200 * 1024 * 1024
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new SQLiteStore({ dir: "./", db: "sastock.db" }),
    secret: "sastock-secret-key-12345", // In production, use environment variable
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
  })
);

app.use(express.static(path.join(__dirname, "public")));

function buildGhostscriptPngCommand(inputPath, outputPath) {
  return `${GHOSTSCRIPT_BIN} -dSAFER -dBATCH -dNOPAUSE -dNOPROMPT -dEPSCrop -sDEVICE=png16m -r300 -sOutputFile="${outputPath}" "${inputPath}"`;
}

// Auth Middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
};

const isAdmin = (req, res, next) => {
  if (req.session.userId && req.session.role === "admin") {
    return next();
  }
  res.status(403).json({ error: "Forbidden" });
};

// --- AUTH ROUTES ---

app.post("/api/auth/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  try {
    const userCount = db.prepare("SELECT count(*) as count FROM users").get().count;
    const role = userCount === 0 ? "admin" : "user";
    
    // If not first user, only admin can create users
    if (userCount > 0 && (!req.session.userId || req.session.role !== "admin")) {
      return res.status(403).json({ error: "Only admin can create new users" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const stmt = db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)");
    const result = stmt.run(username, hashedPassword, role);
    
    res.json({ success: true, userId: result.lastInsertRowid, role });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (user && (await bcrypt.compare(password, user.password))) {
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    res.json({ success: true, user: { username: user.username, role: user.role } });
  } else {
    res.status(401).json({ error: "Invalid username or password" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get("/api/auth/me", (req, res) => {
  if (req.session.userId) {
    res.json({ authenticated: true, user: { username: req.session.username, role: req.session.role } });
  } else {
    const userCount = db.prepare("SELECT count(*) as count FROM users").get().count;
    res.json({ authenticated: false, firstRun: userCount === 0 });
  }
});

// --- ROTATION STATE ---
// Keeps track of the active key index per user.
// A key stays active until it hits limit/invalid, then moves to the next one.
const userRotationIndex = new Map();
const userProcessControllers = new Map();

function getProcessStateKey(userId, tool) {
  return `${userId}:${tool}`;
}

function createStopError(message = "Proses dihentikan oleh pengguna.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isAbortLikeError(error) {
  if (!error) return false;
  if (error.name === "AbortError") return true;

  const message = String(error.message || "").toLowerCase();
  return message.includes("aborted") || message.includes("dihentikan");
}

function assertProcessActive(signal) {
  if (!signal?.aborted) return;

  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw createStopError();
}

function startUserProcess(userId, tool) {
  const processKey = getProcessStateKey(userId, tool);
  const current = userProcessControllers.get(processKey);

  if (current?.controller) {
    current.controller.abort(createStopError("Proses sebelumnya digantikan oleh proses baru."));
  }

  const controller = new AbortController();
  userProcessControllers.set(processKey, { controller, startedAt: Date.now() });
  return controller;
}

function finishUserProcess(userId, tool, controller) {
  const processKey = getProcessStateKey(userId, tool);
  const current = userProcessControllers.get(processKey);
  if (current?.controller === controller) {
    userProcessControllers.delete(processKey);
  }
}

function getNormalizedRotationIndex(userId, totalKeys) {
  if (!totalKeys) return 0;
  const rawIndex = Number(userRotationIndex.get(userId) || 0);
  if (!Number.isFinite(rawIndex) || rawIndex < 0) return 0;
  return rawIndex % totalKeys;
}

function setRotationIndex(userId, index, totalKeys) {
  if (!totalKeys) {
    userRotationIndex.set(userId, 0);
    return;
  }

  const normalized = ((Number(index) || 0) % totalKeys + totalKeys) % totalKeys;
  userRotationIndex.set(userId, normalized);
}

function getUserApiKeys(userId) {
  return db
    .prepare("SELECT key_value FROM api_keys WHERE user_id = ? ORDER BY id ASC")
    .all(userId)
    .map((item) => String(item.key_value || "").trim())
    .filter(Boolean);
}



// --- VECTOR CONVERSION ROUTE ---
app.post("/api/convert-vector", isAuthenticated, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded" });

  const ext = path.extname(file.originalname).toLowerCase();
  
  try {
    if (ext === ".svg") {
      const pngBuffer = await sharp(file.buffer)
        .png()
        .toBuffer();
      return res.json({ png: pngBuffer.toString("base64") });
    }

    if (ext === ".eps") {
      const tempIn = path.join(__dirname, `temp_${Date.now()}.eps`);
      const tempOut = path.join(__dirname, `temp_${Date.now()}.png`);
      
      await fs.writeFile(tempIn, file.buffer);
      
      // Use Ghostscript to rasterize EPS before previewing in the UI.
      try {
        await execPromise(buildGhostscriptPngCommand(tempIn, tempOut));
        const pngBuffer = await fs.readFile(tempOut);
        
        // Cleanup temp files
        await fs.unlink(tempIn).catch(() => {});
        await fs.unlink(tempOut).catch(() => {});

        return res.json({ png: pngBuffer.toString("base64") });
      } catch (gsError) {
        await fs.unlink(tempIn).catch(() => {});
        throw new Error(`Ghostscript EPS conversion failed using "${GHOSTSCRIPT_BIN}": ${gsError.message}`);
      }
    }

    res.status(400).json({ error: "Unsupported vector format" });
  } catch (error) {
    console.error("Vector conversion failed:", error);
    res.status(500).json({ error: "Conversion failed: " + error.message });
  }
});

// --- KEY MANAGEMENT ROUTES ---

app.get("/api/keys", isAuthenticated, (req, res) => {
  const keys = db
    .prepare("SELECT id, key_value, label FROM api_keys WHERE user_id = ? ORDER BY id ASC")
    .all(req.session.userId);
  res.json({ keys });
});

app.post("/api/keys", isAuthenticated, (req, res) => {
  const { key, keys, label } = req.body;
  
  // Support both single key and array of keys
  const keysToInsert = keys && Array.isArray(keys) ? keys : (key ? [key] : []);
  
  if (keysToInsert.length === 0) {
    return res.status(400).json({ error: "No API keys provided" });
  }

  const stmt = db.prepare("INSERT INTO api_keys (user_id, key_value, label) VALUES (?, ?, ?)");
  
  // Use a transaction for batch insert
  const insertMany = db.transaction((userId, items) => {
    for (const k of items) {
      stmt.run(userId, k, label || `Key ${k.substring(0, 4)}...`);
    }
  });

  try {
    insertMany(req.session.userId, keysToInsert);
    res.json({ success: true, count: keysToInsert.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/keys/:id", isAuthenticated, (req, res) => {
  const stmt = db.prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?");
  stmt.run(req.params.id, req.session.userId);
  res.json({ success: true });
});

app.post("/api/process-control/stop", isAuthenticated, (req, res) => {
  const tool = String(req.body?.tool || "").trim();
  if (!tool) {
    return res.status(400).json({ error: "Tool wajib diisi." });
  }

  const processKey = getProcessStateKey(req.session.userId, tool);
  const current = userProcessControllers.get(processKey);

  if (current?.controller) {
    current.controller.abort(createStopError());
    userProcessControllers.delete(processKey);
    return res.json({ success: true, stopped: true });
  }

  res.json({ success: true, stopped: false });
});

// --- ADMIN ROUTES ---

app.get("/api/admin/users", isAdmin, (req, res) => {
  const users = db.prepare("SELECT id, username, role, created_at FROM users").all();
  res.json({ users });
});

app.delete("/api/admin/users/:id", isAdmin, (req, res) => {
  // Prevent deleting self
  if (req.params.id == req.session.userId) {
    return res.status(400).json({ error: "Cannot delete yourself" });
  }
  const stmt = db.prepare("DELETE FROM users WHERE id = ?");
  stmt.run(req.params.id);
  res.json({ success: true });
});

function parseApiKeys(raw) {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function truncateText(value, maxLength = 400) {
  if (!value) return "";
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function normalizePromptText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function jaccardSimilarity(a, b) {
  const wordsA = new Set(normalizePromptText(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizePromptText(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection += 1;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function isTooSimilar(existingPrompts, candidatePrompt) {
  const candidate = normalizePromptText(candidatePrompt);
  if (!candidate) return true;

  for (const existing of existingPrompts) {
    const normalizedExisting = normalizePromptText(existing);
    if (!normalizedExisting) continue;
    if (normalizedExisting === candidate) return true;
    if (jaccardSimilarity(normalizedExisting, candidate) >= 0.85) return true;
  }

  return false;
}

function isLimitError(status, bodyText) {
  const text = String(bodyText || "").toLowerCase();
  return (
    status === 429 ||
    text.includes("rate limit") ||
    text.includes("quota") ||
    text.includes("quota exceeded") ||
    text.includes("resource_exhausted")
  );
}

function isInvalidKeyError(status, bodyText) {
  const text = String(bodyText || "").toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    text.includes("api key not valid") ||
    text.includes("invalid api key") ||
    text.includes("permission")
  );
}

function safeParseJSONObject(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("Model output bukan JSON valid.");
  }
}

function buildPromptStudioInstruction(payload) {
  const {
    mode,
    purpose,
    object,
    expression,
    activity,
    background,
    count,
    lang,
    blockedPrompts = []
  } = payload;

  const batchSize = Math.max(1, Math.min(20, Number(count || 1)));
  const outputLanguage = lang === "id" ? "Bahasa Indonesia" : "English";
  const doNotRepeat = blockedPrompts.length
    ? `\nJANGAN mengulang atau membuat prompt_final yang mirip dengan daftar berikut:\n- ${blockedPrompts.join("\n- ")}\n`
    : "";

  return [
    'Anda adalah "Prompt Studio" untuk prompt fotografi stock realistis.',
    `Bahasa output wajib: ${outputLanguage}.`,
    "Gaya utama: realistic stock photography, natural, commercial-ready, tanpa elemen futuristik kecuali diminta user.",
    "",
    "Template utama:",
    "Buat foto [Tujuan foto] yang menampilkan [objek] dengan [ekspresi], sedang [aktivitas], berlatar [background].",
    "",
    'Jika mode=AUTO: isi "ekspresi", "aktivitas", dan "background" secara kreatif tapi relevan berdasarkan tujuan foto + objek.',
    'Jika mode=MANUAL: gunakan persis nilai ekspresi/aktivitas/background dari user, jangan mengubah makna.',
    "",
    `PENTING: Anda akan membuat ${batchSize} prompt dalam satu batch. Semua item HARUS BERBEDA JELAS.`,
    "Variasikan minimal 2 aspek per item: ekspresi, aktivitas, background, framing, angle, mood, waktu, atau setting.",
    "JANGAN mengulang kalimat prompt_final yang sama atau nyaris sama.",
    doNotRepeat.trimEnd(),
    "",
    "Tambahkan penjaga kualitas ringkas di setiap prompt_final: natural lighting, sharp details, clean composition, no text, no watermark.",
    "",
    "Keluarkan JSON VALID saja (tanpa markdown) dengan skema:",
    "{",
    '  "results": [',
    "    {",
    '      "mode": "AUTO|MANUAL",',
    '      "purpose": string,',
    '      "object": string,',
    '      "expression": string,',
    '      "activity": string,',
    '      "background": string,',
    '      "prompt_final": string',
    "    }",
    "  ]",
    "}",
    `Jumlah elemen results harus tepat ${batchSize}.`,
    "",
    "DATA USER:",
    `mode=${mode}`,
    `purpose=${purpose || ""}`,
    `object=${object || ""}`,
    `expression=${expression || ""}`,
    `activity=${activity || ""}`,
    `background=${background || ""}`
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPrompt(file, options) {
  const typeHint = file.ext || file.mimetype || "asset";
  const platformLabels = options.platforms.length > 0 ? options.platforms.join(", ") : "microstock platforms";
  const prefix = options.prefixEnabled && options.prefixText ? options.prefixText.trim() : "";
  const suffix = options.suffixEnabled && options.suffixText ? options.suffixText.trim() : "";
  const prefixInstruction = prefix ? `Use this prefix in the title: "${prefix}".` : "";
  const suffixInstruction = suffix ? `Use this suffix in the title: "${suffix}".` : "";
  const negativeTitle = options.negativeTitleWords ? `Avoid these words in the title: ${options.negativeTitleWords}.` : "";
  const negativeKeywords = options.negativeKeywords ? `Do not include these as keywords: ${options.negativeKeywords}.` : "";
  const requestedKeywords = Math.max(3, Math.min(50, options.keywordCount));
  const requestedTitle = Math.max(20, Math.min(200, options.titleLength));

  return `You are a metadata assistant for stock content. Create metadata for a ${typeHint} listed on ${platformLabels}.

File name: ${file.originalname}
File type: ${file.mimetype}
File extension: ${file.ext}

Requirements:
- Title MUST be <= ${requestedTitle} characters (count includes spaces). Do NOT exceed this limit.
- Do NOT cut words in the middle. If the title is too long, remove less important words and keep it natural.
- Description should be exactly 150 characters.
- Provide ${requestedKeywords} keywords.
- Title should be concise, searchable, and buyer-focused.
- ${prefixInstruction}
- ${suffixInstruction}
- ${negativeTitle}
- ${negativeKeywords}

Create output in valid JSON ONLY, with these fields:
{
  "title": "...",
  "description": "...", 
  "keywords": ["...", "...", "..."],
  "categoryAdobe": number, // Select 1-21: 1.Animals, 2.Buildings, 3.Business, 4.Drinks, 5.Environment, 6.States of Mind, 7.Food, 8.Graphic Resources, 9.Hobbies, 10.Industry, 11.Landscape, 12.Lifestyle, 13.People, 14.Plants, 15.Culture/Religion, 16.Science, 17.Social Issues, 18.Sports, 19.Technology, 20.Transport, 21.Travel
  "categoryShutterstock": "..." // Select 1 or 2 (comma separated) from: Animals/Wildlife, The Arts, Backgrounds/Textures, Beauty/Fashion, Business/Finance, Celebrities, Education, Food and Drink, Healthcare/Medical, Holidays, Industrial, Interiors, Miscellaneous, Nature, Objects, Parks/Outdoor, People, Religion, Science, Signs/Symbols, Sports/Recreation, Technology, Transportation, Vintage
}
`;
}

function parseResponseText(text) {
  if (!text) return null;
  try {
    // Robust extraction: find the first '{' and the last '}'
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
        console.warn("[Parser] No JSON object found in text.");
        return null;
    }
    const jsonStr = text.substring(start, end + 1);
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error(`[Parser] JSON Parse Error: ${err.message}. Raw: ${text.substring(0, 150)}...`);
    return null;
  }
}

async function getVisualPart(file) {
  const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
  
  try {
    if (file.mimetype.startsWith("image/") && (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp")) {
      return {
        inline_data: {
          mime_type: "image/jpeg",
          data: file.buffer.toString("base64")
        }
      };
    }

    if (ext === "svg") {
      const pngBuffer = await sharp(file.buffer).png().toBuffer();
      return {
        inline_data: {
          mime_type: "image/png",
          data: pngBuffer.toString("base64")
        }
      };
    }

    if (ext === "eps") {
      const tempIn = path.join(__dirname, `gen_temp_${Date.now()}.eps`);
      const tempOut = path.join(__dirname, `gen_temp_${Date.now()}.png`);
      await fs.writeFile(tempIn, file.buffer);
      try {
        await execPromise(buildGhostscriptPngCommand(tempIn, tempOut));
        const pngBuffer = await fs.readFile(tempOut);
        await fs.unlink(tempIn).catch(() => {});
        await fs.unlink(tempOut).catch(() => {});
        return {
          inline_data: {
            mime_type: "image/png",
            data: pngBuffer.toString("base64")
          }
        };
      } catch (gsError) {
        await fs.unlink(tempIn).catch(() => {});
        throw new Error(`Ghostscript EPS conversion failed using "${GHOSTSCRIPT_BIN}": ${gsError.message}`);
      }
    }

    if (file.mimetype.startsWith("video/")) {
      // Extract frame via FFmpeg
      return new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", [
          "-i", "pipe:0",
          "-ss", "00:00:01",
          "-frames:v", "1",
          "-f", "image2",
          "-vcodec", "png",
          "pipe:1"
        ]);

        const chunks = [];
        ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
        ffmpeg.on("close", (code) => {
          if (code === 0 && chunks.length > 0) {
            resolve({
              inline_data: {
                mime_type: "image/png",
                data: Buffer.concat(chunks).toString("base64")
              }
            });
          } else {
            console.warn("FFmpeg failed to extract frame. Fallback to text.");
            resolve(null);
          }
        });
        ffmpeg.stdin.write(file.buffer);
        ffmpeg.stdin.end();
      });
    }

    if (ext === "svg" || ext === "eps" || file.mimetype.includes("image/svg+xml")) {
      const pngBuffer = await sharp(file.buffer).png().toBuffer();
      return {
        inline_data: {
          mime_type: "image/png",
          data: pngBuffer.toString("base64")
        }
      };
    }
  } catch (error) {
    console.warn(`Visual processing failed for ${file.originalname}: ${error.message}. Falling back to text-only.`);
  }

  return null;
}

async function callGeminiWithRotation({
  apiKeys,
  userId,
  model,
  parts,
  generationConfig = {},
  signal
}) {
  const totalKeys = apiKeys.length;
  if (!totalKeys) {
    throw new Error("Masukkan minimal satu API key Gemini.");
  }

  let currentIndex = getNormalizedRotationIndex(userId, totalKeys);
  let attempts = 0;
  let lastErrorText = "";

  while (attempts < totalKeys) {
    assertProcessActive(signal);

    const activeIndex = currentIndex % totalKeys;
    const apiKey = apiKeys[activeIndex];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig
        })
      });

      const rawText = await response.text();
      lastErrorText = rawText;

      if (!response.ok) {
        if (isLimitError(response.status, rawText) || isInvalidKeyError(response.status, rawText)) {
          attempts += 1;
          currentIndex = (activeIndex + 1) % totalKeys;
          setRotationIndex(userId, currentIndex, totalKeys);
          continue;
        }

        throw new Error(`Gemini failed: ${response.status} ${truncateText(rawText)}`);
      }

      const parsedResponse = JSON.parse(rawText);
      const outputText =
        parsedResponse?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";

      // Keep using the same key until it reaches limit.
      setRotationIndex(userId, activeIndex, totalKeys);
      return { text: outputText, keyIndex: activeIndex };
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw createStopError();
      }

      if (attempts === totalKeys - 1) {
        throw error;
      }

      attempts += 1;
      currentIndex = (activeIndex + 1) % totalKeys;
      setRotationIndex(userId, currentIndex, totalKeys);
    }
  }

  throw new Error(`Semua API key gagal dipakai. Terakhir: ${truncateText(lastErrorText)}`);
}

async function callGeminiWithRetry({ apiKeys, userId, model, prompt, visualPart, signal }) {
  const parts = [{ text: prompt }];
  if (visualPart) {
    parts.push({
      inlineData: {
        mimeType: visualPart.inline_data?.mime_type || "image/jpeg",
        data: visualPart.inline_data?.data || ""
      }
    });
  }

  const { text } = await callGeminiWithRotation({
    apiKeys,
    userId,
    model,
    parts,
    signal
  });

  const parsed = parseResponseText(text);
  if (!parsed || !parsed.title || !parsed.description || !Array.isArray(parsed.keywords)) {
    throw new Error("Invalid JSON format from AI");
  }

  return {
    title: parsed.title.trim(),
    description: parsed.description.trim().slice(0, 150),
    keywords: parsed.keywords.map((value) => String(value).trim()).filter(Boolean),
    categoryAdobe: parsed.categoryAdobe || 1,
    categoryShutterstock: parsed.categoryShutterstock || "People"
  };
}

const PLATFORM_TITLE_LIMITS = {
  "Adobe Stock": 70
};

function getEffectiveTitleLength(options) {
  const base = Math.max(20, Math.min(200, Number(options?.titleLength ?? 80)));
  const platforms = Array.isArray(options?.platforms) ? options.platforms : [];
  const limits = platforms.map((platform) => PLATFORM_TITLE_LIMITS[platform]).filter((n) => Number.isFinite(n));
  if (!limits.length) return base;
  return Math.min(base, Math.min(...limits));
}

async function rewriteTitleToMaxLength({
  apiKeys,
  userId,
  model,
  originalTitle,
  maxLength,
  prefix,
  suffix,
  platformsLabel,
  signal
}) {
  const prefixInstruction = prefix ? `Use this prefix in the title: "${prefix}".` : "";
  const suffixInstruction = suffix ? `Use this suffix in the title: "${suffix}".` : "";

  const prompt = [
    `You are editing a stock content title for ${platformsLabel}.`,
    "",
    "Constraints:",
    `- Title MUST be <= ${maxLength} characters (count includes spaces).`,
    "- Do NOT cut words in the middle.",
    "- Keep meaning and searchability.",
    `- ${prefixInstruction}`,
    `- ${suffixInstruction}`,
    "",
    "Original title:",
    originalTitle,
    "",
    "Return VALID JSON ONLY (no markdown):",
    '{ "title": "..." }'
  ]
    .filter(Boolean)
    .join("\n");

  const { text } = await callGeminiWithRotation({
    apiKeys,
    userId,
    model,
    parts: [{ text: prompt }],
    signal
  });

  const parsed = parseResponseText(text);
  if (!parsed || !parsed.title) {
    throw new Error("Invalid JSON format from AI (title rewrite)");
  }

  return String(parsed.title).trim();
}

app.post("/api/generate", isAuthenticated, upload.array("files", 100), async (req, res) => {
  console.log(`[Metadata] Starting generation for ${req.files?.length || 0} files. User: ${req.session.userId}`);
  const userId = req.session.userId;
  const apiKeys = getUserApiKeys(userId);

  const model = req.body.model || "gemini-3-flash-preview";
  const titleLength = Number(req.body.titleLength ?? 80);
  const keywordCount = Number(req.body.keywordCount ?? 12);
  const platforms = Array.isArray(req.body.platforms) ? req.body.platforms : [req.body.platforms].filter(Boolean);

  const options = {
    titleLength,
    keywordCount,
    prefixEnabled: req.body.prefixEnabled === "true" || req.body.prefixEnabled === "on",
    prefixText: req.body.prefixText || "",
    suffixEnabled: req.body.suffixEnabled === "true" || req.body.suffixEnabled === "on",
    suffixText: req.body.suffixText || "",
    negativeTitleWords: req.body.negativeTitleWords || "",
    negativeKeywords: req.body.negativeKeywords || "",
    platforms
  };

  // If any selected platform has a strict max title length (e.g. Adobe 70),
  // clamp here so the AI is instructed correctly and we avoid any UI-side truncation.
  options.titleLength = getEffectiveTitleLength(options);

  if (!apiKeys.length) return res.status(400).json({ error: "Masukkan minimal satu API key Gemini." });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "Unggah minimal satu file." });

  console.log(`[Metadata] API key bank count: ${apiKeys.length}. Active index: ${getNormalizedRotationIndex(userId, apiKeys.length)}.`);
  const processController = startUserProcess(userId, "metadata");
  const { signal } = processController;

  try {
    const items = [];
    for (const file of files) {
      assertProcessActive(signal);

      const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
      const entry = {
        fileName: file.originalname,
        status: "pending",
        title: "",
        description: "",
        keywords: [],
        error: null
      };

      try {
        const prompt = buildPrompt({ ...file, ext }, options);
        console.log(`[Metadata] Processing: ${file.originalname}...`);
        const visualPart = await getVisualPart(file);
        const result = await callGeminiWithRetry({
          apiKeys,
          userId,
          model,
          prompt,
          visualPart,
          signal
        });

        if (result.title && result.title.length > options.titleLength) {
          const platformsLabel = options.platforms.length ? options.platforms.join(", ") : "microstock platforms";
          const prefix = options.prefixEnabled && options.prefixText ? options.prefixText.trim() : "";
          const suffix = options.suffixEnabled && options.suffixText ? options.suffixText.trim() : "";

          const rewritten = await rewriteTitleToMaxLength({
            apiKeys,
            userId,
            model,
            originalTitle: result.title,
            maxLength: options.titleLength,
            prefix,
            suffix,
            platformsLabel,
            signal
          });

          if (rewritten.length > options.titleLength) {
            throw new Error(`AI title exceeded max length (${options.titleLength}) even after rewrite`);
          }

          result.title = rewritten;
        }

        entry.title = result.title;
        entry.description = result.description;
        entry.keywords = result.keywords;
        entry.categoryAdobe = result.categoryAdobe;
        entry.categoryShutterstock = result.categoryShutterstock;
        entry.status = "done";
      } catch (error) {
        if (isAbortLikeError(error)) {
          throw error;
        }

        entry.status = "failed";
        entry.error = error.message;
      }

      items.push(entry);
    }

    console.log(`[Metadata] Finished processing ${items.length} files.`);
    return res.json({ items });
  } catch (error) {
    if (isAbortLikeError(error)) {
      return res.status(409).json({ error: "Proses metadata dihentikan oleh pengguna." });
    }

    throw error;
  } finally {
    finishUserProcess(userId, "metadata", processController);
  }
});



// --- HEALTH CHECK ---
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});




// --- IMG TO PROMPT ROUTE ---

app.post("/api/imgtoprompt", isAuthenticated, upload.array("images", 100), async (req, res) => {
  console.log(`[ImgToPrompt] Starting for ${req.files?.length || 0} images. User: ${req.session.userId}`);
  const images = req.files || [];
  const model = req.body.model || "gemini-3-flash-preview";
  const creativity = Math.max(0, Math.min(100, Number(req.body.creativity || 50)));
  const camera = req.body.camera === "on";
  const userId = req.session.userId;
  const apiKeys = getUserApiKeys(userId);
  
  if (!apiKeys.length) return res.status(400).json({ error: "Masukkan minimal satu API key Gemini." });
  if (!images.length) return res.status(400).json({ error: "Unggah minimal satu file gambar." });

  function buildImgPrompt() {
    return `Analyze this image and generate a high-quality, professional prompt for AI image generators (like Midjourney or Stable Diffusion). 
The prompt should be realistic, natural, and suitable for commercial stock photography.

Constraints:
- Focus on realism and detailed descriptions.
- Creativity Level: ${creativity}/100 (where 100 is highly descriptive and artistic).
${camera ? "- Include professional camera settings (lens, lighting, aperture, etc)." : ""}
- IMPORTANT: DO NOT use these words: cyber, futuristic, sci-fi, robot, ai, hologram, technology, logo, brand, watermark.
- Do not mention any famous names or trademarks.
- Return ONLY the prompt text. No explanation or JSON.`;
  }

  console.log(`[ImgToPrompt] API key bank count: ${apiKeys.length}. Active index: ${getNormalizedRotationIndex(userId, apiKeys.length)}.`);
  const processController = startUserProcess(userId, "imgtoprompt");
  const { signal } = processController;

  try {
    const results = [];
    for (const file of images) {
      assertProcessActive(signal);

      try {
        const promptText = buildImgPrompt();
        const prompt = await callGeminiMultimodalWithSDK({
          apiKeys,
          userId,
          model,
          prompt: promptText,
          imageBuffer: file.buffer,
          mimeType: file.mimetype,
          signal
        });
        results.push({ fileName: file.originalname, prompt, error: null });
      } catch (err) {
        if (isAbortLikeError(err)) {
          throw err;
        }

        results.push({ fileName: file.originalname, prompt: "", error: err.message });
      }
    }

    return res.json({ results });
  } catch (error) {
    if (isAbortLikeError(error)) {
      return res.status(409).json({ error: "Proses Img To Prompt dihentikan oleh pengguna." });
    }

    throw error;
  } finally {
    finishUserProcess(userId, "imgtoprompt", processController);
  }
});

// --- SHARED HELPERS FOR PROMPT STUDIO & IMG TO PROMPT ---

async function callGeminiWithSDK({ apiKeys, userId, model: modelId, prompt, signal }) {
  const { text } = await callGeminiWithRotation({
    apiKeys,
    userId,
    model: modelId,
    parts: [{ text: prompt }],
    generationConfig: { temperature: 0.9 },
    signal
  });

  return text;
}

async function callGeminiMultimodalWithSDK({
  apiKeys,
  userId,
  model: modelId,
  prompt,
  imageBuffer,
  mimeType,
  signal
}) {
  const { text } = await callGeminiWithRotation({
    apiKeys,
    userId,
    model: modelId,
    parts: [
      { text: prompt },
      {
        inlineData: {
          data: imageBuffer.toString("base64"),
          mimeType: mimeType || "image/jpeg"
        }
      }
    ],
    signal
  });

  return text;
}

async function callPromptStudioWithRotation({ apiKeys, userId, model, instruction, signal }) {
  const { text, keyIndex } = await callGeminiWithRotation({
    apiKeys,
    userId,
    model,
    parts: [{ text: instruction }],
    generationConfig: { temperature: 0.7 },
    signal
  });

  return {
    result: safeParseJSONObject(text),
    keyIndex
  };
}

// --- PROMPT STUDIO ENDPOINT ---
app.post("/api/prompt-studio/generate", isAuthenticated, async (req, res) => {
  const userId = req.session.userId;
  const payload = req.body || {};
  const batchSize = Math.max(1, Math.min(20, Number(payload.count || 1)));
  const mode = payload.mode === "MANUAL" ? "MANUAL" : "AUTO";
  const purpose = String(payload.purpose || "").trim();
  const object = String(payload.object || "").trim();
  const expression = String(payload.expression || "").trim();
  const activity = String(payload.activity || "").trim();
  const background = String(payload.background || "").trim();
  const lang = payload.lang === "id" ? "id" : "en";
  const model = String(payload.model || "").trim() || "gemini-2.5-flash";

  if (!purpose) {
    return res.status(400).json({ error: "Purpose wajib diisi." });
  }

  if (!object) {
    return res.status(400).json({ error: "Object wajib diisi." });
  }

  if (mode === "MANUAL") {
    for (const [field, label] of [
      ["expression", "Expression"],
      ["activity", "Activity"],
      ["background", "Background"]
    ]) {
      if (!String(payload[field] || "").trim()) {
        return res.status(400).json({ error: `${label} wajib diisi pada mode MANUAL.` });
      }
    }
  }

  const apiKeys = getUserApiKeys(userId);
  if (!apiKeys.length) {
    return res.status(400).json({ error: "Masukkan minimal satu API key Gemini." });
  }

  const collected = [];
  const collectedPrompts = [];
  const maxRounds = 4;
  const processController = startUserProcess(userId, "prompt-studio");
  const { signal } = processController;

  try {
    console.log(`[PromptStudio] API key bank count: ${apiKeys.length}. Active index: ${getNormalizedRotationIndex(userId, apiKeys.length)}.`);

    for (let round = 1; round <= maxRounds; round += 1) {
      assertProcessActive(signal);

      const needed = batchSize - collected.length;
      if (needed <= 0) break;

      const instruction = buildPromptStudioInstruction({
        mode,
        purpose,
        object,
        expression,
        activity,
        background,
        count: needed,
        lang,
        blockedPrompts: collectedPrompts
      });

      const output = await callPromptStudioWithRotation({
        apiKeys,
        userId,
        model,
        instruction,
        signal
      });

      const batch = output.result?.results;
      if (!Array.isArray(batch)) {
        throw new Error("Format output model tidak sesuai (results[] tidak ada).");
      }

      for (const item of batch) {
        const promptFinal = String(item?.prompt_final || "").replace(/\r?\n/g, " ").trim();
        if (!isTooSimilar(collectedPrompts, promptFinal)) {
          collected.push(promptFinal);
          collectedPrompts.push(promptFinal);
        }
        if (collected.length >= batchSize) break;
      }
    }

    if (!collected.length) {
      return res.status(500).json({ error: "Gagal membuat prompt unik." });
    }

    res.json({ prompts: collected });
  } catch (err) {
    if (isAbortLikeError(err)) {
      return res.status(409).json({ error: "Proses Prompt Studio dihentikan oleh pengguna." });
    }

    console.error(`[PromptStudio] Error: ${err.message}`);
    res.status(500).json({ error: err.message || "Internal server error" });
  } finally {
    finishUserProcess(userId, "prompt-studio", processController);
  }
});

// --- UPDATED IMG TO PROMPT ROUTE (SDK) ---
app.post("/api/imgtoprompt/single", isAuthenticated, upload.single("image"), async (req, res) => {
  const file = req.file;
  const userId = req.session.userId;
  const { model, creativity, camera } = req.body;

  if (!file) return res.status(400).json({ error: "No image uploaded" });

  const apiKeys = getUserApiKeys(userId);
  if (!apiKeys.length) return res.status(400).json({ error: "Empty API keys" });

  const processController = startUserProcess(userId, "imgtoprompt");
  const { signal } = processController;

  try {
    console.log(`[ImgToPrompt] API key bank count: ${apiKeys.length}. Active index: ${getNormalizedRotationIndex(userId, apiKeys.length)}.`);
    const creativityVal = Math.max(0, Math.min(100, Number(creativity || 50)));
    const cameraOn = camera === "true" || camera === "on";
    
    const promptText = `Analyze this image and generate a high-quality, professional prompt for AI image generators. 
Realistic, commercial stock style. Creativity: ${creativityVal}/100.
${cameraOn ? "Include camera settings." : ""}
Return ONLY the prompt text.`;

    const prompt = await callGeminiMultimodalWithSDK({
      apiKeys,
      userId,
      model: model || "gemini-3-flash-preview",
      prompt: promptText,
      imageBuffer: file.buffer,
      mimeType: file.mimetype,
      signal
    });

    res.json({ fileName: file.originalname, prompt });
  } catch (err) {
    if (isAbortLikeError(err)) {
      return res.status(409).json({ error: "Proses Img To Prompt dihentikan oleh pengguna." });
    }

    console.error(`[ImgToPrompt SDK] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  } finally {
    finishUserProcess(userId, "imgtoprompt", processController);
  }
});

// --- ERROR HANDLER ---
app.use("/api", (err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error"
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SASTOCK metadata tool listening on http://localhost:${PORT}`);
});
