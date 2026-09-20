import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function cleanCode(s) {
  return String(s || "").replace(/^```(?:c|cpp)?\s*/i, "").replace(/\s*```$/i, "").trim() + "\n";
}

function safeName(name, fallback) {
  const n = String(name || "").replace(/[^a-zA-Z0-9_.-]/g, "_");
  return n.endsWith(".c") ? n : `${n || fallback}.c`;
}

app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });

    const studentId = String(req.body.studentId || "").trim();
    const questions = String(req.body.questions || "").trim();
    const count = Math.min(Math.max(Number(req.body.count || 13), 1), 20);

    if (!studentId) return res.status(400).json({ error: "Student ID is required." });
    if (!questions && !req.file) return res.status(400).json({ error: "Paste questions or upload an image." });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL });

    const prompt = `You are a first-year engineering C programming lab assistant.
Generate one separate, complete, compilable STANDARD C program for every assignment question.
Student ID/prefix: ${studentId}
Expected number of programs: ${count}

Rules:
- Preserve question order.
- Beginner-friendly standard C.
- Each program must be independently compilable.
- Use appropriate #include headers and main().
- Do not invent unreadable questions.
- Return ONLY valid JSON, no markdown.
- JSON shape:
{"programs":[{"number":1,"filename":"${studentId}_1.c","code":"..."}]}
- Escape newlines and quotes correctly for JSON.
- No markdown fences inside code.
${questions ? `Questions:\n${questions}` : "Read the attached image and extract the assignment questions."}`;

    const parts = [{ text: prompt }];
    if (req.file) {
      parts.push({ inlineData: { mimeType: req.file.mimetype, data: req.file.buffer.toString("base64") } });
    }

    const result = await model.generateContent(parts);
    const raw = result.response.text().trim().replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(raw);

    const programs = (parsed.programs || []).slice(0, 20).map((p, i) => ({
      number: Number(p.number) || i + 1,
      filename: safeName(p.filename, `${studentId}_${i + 1}`),
      code: cleanCode(p.code)
    }));

    if (!programs.length) throw new Error("No programs were generated.");
    res.json({ programs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Generation failed." });
  }
});

app.listen(process.env.PORT || 3000, () => console.log(`C Assignment Generator running on port ${process.env.PORT || 3000}`));