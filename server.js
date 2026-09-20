import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Frontend
app.use(express.static("public"));
app.use(express.json({ limit: "10mb" }));

// Image upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

// Gemini
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

IMPORTANT:
- Return ONLY valid JSON.
- Do NOT use markdown.
- Do NOT use ```json.
- The JSON must contain a top-level key named "programs".
- "programs" must be an array.
- Each program must contain "question" and "code".

Requirements for every C program:
1. Use standard C.
2. Each program must compile independently.
3. Include #include <stdio.h> when required.
4. Include main().
5. Include return 0;.
6. Keep code beginner-friendly for first-year engineering students.
7. Do not use C++.
8. Do not put explanations outside the JSON.
9. Do not combine multiple questions into one program.
10. Generate exactly ${count} programs.

Filename format:
${studentId}_1.c
${studentId}_2.c
${studentId}_3.c
and so on.

Required JSON format:

{
  "programs": [
    {
      "question": "Question 1",
      "code": "#include <stdio.h>\\n\\nint main() {\\n    return 0;\\n}"
    }
  ]
}

Assignment questions:
${questions}
`;

    const parts = [{ text: prompt }];

    // Add assignment image if uploaded
    if (req.file) {
      parts.push({
        inlineData: {
          data: req.file.buffer.toString("base64"),
          mimeType: req.file.mimetype
        }
      });
    }

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: parts
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    const responseText = result.response.text();

    console.log("Gemini response:", responseText);

    let cleanText = responseText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let data;

    try {
      data = JSON.parse(cleanText);
    } catch (error) {
      const start = cleanText.indexOf("{");
      const end = cleanText.lastIndexOf("}");

      if (start === -1 || end === -1) {
        throw new Error(
          "Gemini did not return valid JSON. Response was: " + cleanText
        );
      }

      data = JSON.parse(cleanText.slice(start, end + 1));
    }

    if (!data.programs || !Array.isArray(data.programs)) {
      throw new Error(
        "Gemini response does not contain a valid 'programs' array."
      );
    }

    data.programs = data.programs
      .slice(0, count)
      .map((program, index) => ({
        filename: `${studentId}_${index + 1}.c`,
        question: program.question || `Question ${index + 1}`,
        code: String(program.code || "").trim()
      }));

    if (data.programs.length === 0) {
      throw new Error("No programs were returned by Gemini.");
    }

    res.json(data);

  } catch (error) {
    console.error("Generation error:", error);

    res.status(500).json({
      error: error.message || "Something went wrong while generating programs."
    });
  }
});

// Home page
app.get("/", (req, res) => {
  res.sendFile("index.html", {
    root: "public"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`C Assignment Generator running on port ${PORT}`);
});
