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
// Keeps track of the last used key index per user to ensure Round Robin across requests
const userRotationIndex = new Map();

// --- IMAGE TO PROMPT HELPERS ---
async function callGeminiImgToPromptWithRetry({ apiKeys, userId, model, prompt, imageBuffer }) {
  let startIndex = userRotationIndex.get(userId) || 0;
  let attempts = 0;
  const maxAttempts = apiKeys.length;

  while (attempts < maxAttempts) {
    const currentIndex = (startIndex + attempts) % apiKeys.length;
    const apiKey = apiKeys[currentIndex];
    userRotationIndex.set(userId, (currentIndex + 1) % apiKeys.length);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
      const parts = [
        { text: prompt },
        {
          inline_data: {
            mime_type: "image/jpeg",
            data: imageBuffer.toString("base64")
          }
        }
      ];

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }] })
      });

      if (response.status === 429) {
        console.warn(`Key ${currentIndex} rate limited (429). Retrying...`);
        attempts++;
        continue;
      }

      if (!response.ok) {
        const payload = await response.text();
        throw new Error(`Gemini failed: ${response.status} ${payload}`);
      }

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    } catch (err) {
      if (attempts === maxAttempts - 1) throw err;
      attempts++;
    }
  }
  throw new Error("All API keys are rate limited or failed.");
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
      
      // Use gswin64c - Windows Ghostscript
      try {
        await execPromise(`gswin64c -dSAFER -dBATCH -dNOPAUSE -dNOPROMPT -sDEVICE=png16m -r300 -sOutputFile="${tempOut}" "${tempIn}"`);
        const pngBuffer = await fs.readFile(tempOut);
        
        // Cleanup temp files
        await fs.unlink(tempIn).catch(() => {});
        await fs.unlink(tempOut).catch(() => {});

        return res.json({ png: pngBuffer.toString("base64") });
      } catch (gsError) {
        await fs.unlink(tempIn).catch(() => {});
        throw gsError;
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
  const keys = db.prepare("SELECT id, key_value, label FROM api_keys WHERE user_id = ?").all(req.session.userId);
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
- Title length should be around ${requestedTitle} characters.
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
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
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
        await execPromise(`gswin64c -dSAFER -dBATCH -dNOPAUSE -dNOPROMPT -sDEVICE=png16m -r300 -sOutputFile="${tempOut}" "${tempIn}"`);
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
        throw gsError;
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

async function callGeminiWithRetry({ apiKeys, userId, model, prompt, visualPart }) {
  let startIndex = userRotationIndex.get(userId) || 0;
  let attempts = 0;
  const maxAttempts = apiKeys.length;

  while (attempts < maxAttempts) {
    const currentIndex = (startIndex + attempts) % apiKeys.length;
    const apiKey = apiKeys[currentIndex];
    userRotationIndex.set(userId, (currentIndex + 1) % apiKeys.length);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
      const parts = [{ text: prompt }];
      if (visualPart) parts.push(visualPart);

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }] })
      });

      if (response.status === 429) {
        attempts++;
        continue;
      }

      if (!response.ok) {
        const payload = await response.text();
        throw new Error(`Gemini failed: ${response.status} ${payload}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const parsed = parseResponseText(text);

      if (!parsed || !parsed.title || !parsed.description || !Array.isArray(parsed.keywords)) {
        throw new Error(`Invalid JSON format from AI`);
      }

      return {
        title: parsed.title.trim(),
        description: parsed.description.trim().slice(0, 150),
        keywords: parsed.keywords.map((v) => String(v).trim()).filter(Boolean),
        categoryAdobe: parsed.categoryAdobe || 1,
        categoryShutterstock: parsed.categoryShutterstock || "People"
      };
    } catch (err) {
      if (attempts === maxAttempts - 1) throw err;
      attempts++;
    }
  }
  throw new Error("All API keys reached their rate limit.");
}

app.post("/api/generate", isAuthenticated, upload.array("files", 100), async (req, res) => {
  const savedKeys = db.prepare("SELECT key_value FROM api_keys WHERE user_id = ?").all(req.session.userId);
  const apiKeys = savedKeys.map(k => k.key_value);

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

  if (!apiKeys.length) return res.status(400).json({ error: "Masukkan minimal satu API key Gemini." });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "Unggah minimal satu file." });

  const items = [];
  for (const file of files) {
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
      const visualPart = await getVisualPart(file);
      const result = await callGeminiWithRetry({
        apiKeys,
        userId: req.session.userId,
        model,
        prompt,
        visualPart
      });
      entry.title = result.title;
      entry.description = result.description;
      entry.keywords = result.keywords;
      entry.adobeCategory = result.categoryAdobe;
      entry.shutterstockCategory = result.categoryShutterstock;
      entry.status = "done";
    } catch (error) {
      entry.status = "failed";
      entry.error = error.message;
    }
    items.push(entry);
  }
  res.json({ items });
});

// --- TEXT ONLY GENERATION HELPER ---
async function callGeminiTextOnlyWithRetry({ apiKeys, userId, model, prompt }) {
  let startIndex = userRotationIndex.get(userId) || 0;
  let attempts = 0;
  const maxAttempts = apiKeys.length;

  while (attempts < maxAttempts) {
    const currentIndex = (startIndex + attempts) % apiKeys.length;
    const apiKey = apiKeys[currentIndex];
    userRotationIndex.set(userId, (currentIndex + 1) % apiKeys.length);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
      const body = {
        contents: [{ parts: [{ text: prompt }] }]
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (response.status === 429) {
        attempts++;
        continue;
      }

      if (!response.ok) {
        const payload = await response.text();
        throw new Error(`Gemini failed: ${response.status} ${payload}`);
      }

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (err) {
      if (attempts === maxAttempts - 1) throw err;
      attempts++;
    }
  }
  throw new Error("All API keys reached their rate limit.");
}

// --- PROMPT STUDIO HELPERS ---
function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function jaccardSimilarity(a, b) {
  const A = new Set(normalizeText(a).split(" ").filter(Boolean));
  const B = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function isTooSimilar(existingPrompts, candidatePrompt) {
  const c = normalizeText(candidatePrompt);
  if (!c) return true;
  for (const p of existingPrompts) {
    const pn = normalizeText(p);
    if (!pn) continue;
    if (pn === c) return true;
    if (jaccardSimilarity(pn, c) >= 0.85) return true;
  }
  return false;
}

function buildStudioInstruction(payload) {
  const { mode, tujuan, objek, ekspresi, aktivitas, background, count, language } = payload;
  const n = Math.max(1, Math.min(20, Number(count || 1)));
  const targetLang = language === "English" ? "English" : "Bahasa Indonesia";

  return `Anda adalah "AI Prompt Studio" profesional.
Buat instruksi visual yang sangat mendetail untuk generator gambar AI (seperti Midjourney atau DALL-E 3) yang dioptimalkan untuk Microstock.

Output harus dalam bahasa: ${targetLang}.

Template Utama:
Foto [Tujuan] yang menampilkan [Objek] dengan [Ekspresi], sedang [Aktivitas], berlatar [Background].

Aturan Mode:
- Jika Mode=AUTO: Kembangkan ekspresi, aktivitas, dan background secara kreatif berdasarkan tujuan foto dan objek agar hasilnya variatif dan bernilai jual tinggi.
- Jika Mode=MANUAL: Gunakan nilai ekspresi/aktivitas/background yang diberikan pengguna secara presisi.

Batching:
- Buat tepat ${n} unik prompt.
- Variasikan framing (close-up, medium, wide), pencahayaan (natural, golden hour, studio), dan sudut kamera untuk setiap entri.

Output:
Keluarkan HANYA JSON VALID (tanpa markdown):
{
  "results": [
    {
      "prompt": "..."
    }
  ]
}

DATA USER:
Mode: ${mode}
Tujuan: ${tujuan}
Objek: ${objek}
Ekspresi: ${ekspresi || "N/A"}
Aktivitas: ${aktivitas || "N/A"}
Background: ${background || "N/A"}
`;
}

app.post("/api/prompt-studio", isAuthenticated, async (req, res) => {
  const { mode, tujuan, objek, ekspresi, aktivitas, background, count, model } = req.body;
  const targetCount = Math.max(1, Math.min(20, Number(count || 1)));

  const savedKeys = db.prepare("SELECT key_value FROM api_keys WHERE user_id = ?").all(req.session.userId);
  const apiKeys = savedKeys.map(k => k.key_value);
  if (!apiKeys.length) return res.status(400).json({ error: "Masukkan minimal satu API key Gemini." });

  const collected = [];
  const collectedPrompts = [];
  const maxRounds = 3;

  try {
    for (let round = 1; round <= maxRounds; round++) {
      const need = targetCount - collected.length;
      if (need <= 0) break;

      const instruction = buildStudioInstruction({ ...req.body, count: need });
      const rawResponse = await callGeminiTextOnlyWithRetry({
        apiKeys,
        userId: req.session.userId,
        model: model || "gemini-3-flash-preview",
        prompt: instruction
      });

      const parsed = parseResponseText(rawResponse);
      const batch = parsed?.results;
      if (!Array.isArray(batch)) continue;

      for (const item of batch) {
        if (!item.prompt_final) continue;
        if (!isTooSimilar(collectedPrompts, item.prompt_final)) {
          collected.push(item);
          collectedPrompts.push(item.prompt_final);
          if (collected.length >= targetCount) break;
        }
      }
    }
    res.json({ results: collected });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SASTOCK metadata tool listening on http://localhost:${PORT}`);
});


// --- IMG TO PROMPT ROUTE ---

app.post("/api/imgtoprompt", isAuthenticated, upload.array("images", 100), async (req, res) => {
  const images = req.files || [];
  const model = req.body.model || "gemini-3-flash-preview";
  const creativity = Math.max(0, Math.min(100, Number(req.body.creativity || 50)));
  const camera = req.body.camera === "on";

  const savedKeys = db.prepare("SELECT key_value FROM api_keys WHERE user_id = ?").all(req.session.userId);
  const apiKeys = savedKeys.map(k => k.key_value);
  
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

  const results = [];
  for (const file of images) {
    try {
      const promptText = buildImgPrompt();
      const prompt = await callGeminiImgToPromptWithRetry({
        apiKeys,
        userId: req.session.userId,
        model,
        prompt: promptText,
        imageBuffer: file.buffer
      });
      results.push({ fileName: file.originalname, prompt, error: null });
    } catch (err) {
      results.push({ fileName: file.originalname, prompt: "", error: err.message });
    }
  }
  res.json({ results });
});