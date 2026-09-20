import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Serve frontend
app.use(express.static("public"));
app.use(express.json({ limit: "10mb" }));

// File upload setup
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

// Gemini setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    const studentId = (req.body.studentId || "126106043").trim();
    const questions = (req.body.questions || "").trim();
    const count = Number(req.body.count || 1);

    if (!questions && !req.file) {
      return res.status(400).json({
        error: "Please enter questions or upload an assignment image."
      });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-3.6-flash"
    });

    const prompt = `
You are a C programming assignment generator for first-year engineering students.

Student ID: ${studentId}
Number of programs requested: ${count}

Generate exactly ${count} separate C programs based on the assignment questions.

Requirements:
1. Use standard C.
2. Each program must be independently compilable.
3. Use #include <stdio.h> when required.
4. Keep the programs beginner-friendly.
5. Use clear variable names.
6. Include main().
7. Include return 0;.
8. Do not use C++.
9. Do not use markdown code fences inside the code.
10. Do not add unnecessary explanations inside the code.
11. Each program must solve its corresponding question.
12. Return valid JSON only.

For every program return:
- filename
- question
- code

Filename format:
${studentId}_1.c
${studentId}_2.c
${studentId}_3.c
and so on.

Assignment questions:
${questions}
`;

    const parts = [{ text: prompt }];

    // Add uploaded image if present
    if (req.file) {
      parts.push({
        inlineData: {
          data: req.file.buffer.toString("base64"),
          mimeType: req.file.mimetype
        }
      });
    }

    const result = await model.generateContent(parts);
    const responseText = result.response.text();

    // Remove accidental markdown fences
    let cleanText = responseText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let data;

    try {
      data = JSON.parse(cleanText);
    } catch (error) {
      // Try extracting JSON object from response
      const start = cleanText.indexOf("{");
      const end = cleanText.lastIndexOf("}");

      if (start === -1 || end === -1) {
        throw new Error("Gemini returned invalid JSON.");
      }

      data = JSON.parse(cleanText.slice(start, end + 1));
    }

    if (!data.programs || !Array.isArray(data.programs)) {
      throw new Error("No programs were returned.");
    }

    // Make sure filenames follow required format
    data.programs = data.programs.map((program, index) => ({
      filename: `${studentId}_${index + 1}.c`,
      question: program.question || `Question ${index + 1}`,
      code: String(program.code || "").trim()
    }));

    res.json(data);

  } catch (error) {
    console.error("Generation error:", error);

    res.status(500).json({
      error: error.message || "Something went wrong while generating programs."
    });
  }
});

// Fallback for frontend
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`C Assignment Generator running on port ${PORT}`);
});
