import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(express.json({ limit: "10mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});


/* ============================
   GOOGLE FORM
============================ */

app.post("/api/form-questions", async (req, res) => {
  try {
    const formUrl = String(req.body.url || "").trim();

    if (!formUrl) {
      return res.status(400).json({
        error: "Please enter a Google Form link."
      });
    }

    let url;

    try {
      url = new URL(formUrl);
    } catch {
      return res.status(400).json({
        error: "Invalid Google Form link."
      });
    }

    const isGoogleForm =
      url.hostname === "docs.google.com" ||
      url.hostname === "forms.gle" ||
      url.hostname === "www.docs.google.com";

    if (!isGoogleForm) {
      return res.status(400).json({
        error: "Please enter a valid Google Form link."
      });
    }

    const response = await fetch(formUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
      }
    });

    if (!response.ok) {
      throw new Error(
        `Google Form could not be opened. HTTP ${response.status}`
      );
    }

    const finalUrl = response.url;
    const html = await response.text();

    /*
      First try to extract question-like text
      from common Google Forms HTML patterns.
    */

    const questions = [];

    const patterns = [
      /aria-label="([^"]+)"/gi,
      /data-value="([^"]+)"/gi,
      /data-params="([^"]+)"/gi
    ];

    for (const pattern of patterns) {
      let match;

      while ((match = pattern.exec(html)) !== null) {
        let text = match[1];

        text = decodeHtml(text);
        text = cleanText(text);

        if (isQuestion(text)) {
          addQuestion(questions, text);
        }
      }
    }

    /*
      Backup: extract readable HTML text.
    */

    if (questions.length === 0) {

      const textOnly = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");

      const pieces = textOnly
        .split(/\r?\n/)
        .map(cleanText)
        .filter(isQuestion);

      for (const piece of pieces) {
        addQuestion(questions, piece);
      }
    }

    const finalQuestions = questions.slice(0, 20);

    if (finalQuestions.length === 0) {
      return res.status(422).json({
        error:
          "Google Form opened successfully, but questions could not be detected. You can still paste the questions manually or upload an image."
      });
    }

    res.json({
      questions: finalQuestions,
      formUrl: finalUrl
    });

  } catch (error) {

    console.error("Google Form error:", error);

    res.status(500).json({
      error:
        error.message ||
        "Unable to read the Google Form."
    });
  }
});


function cleanText(text) {
  return String(text || "")
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}


function isQuestion(text) {

  if (!text) return false;

  if (text.length < 4) return false;

  if (text.length > 500) return false;

  const lower = text.toLowerCase();

  const ignored = [
    "google forms",
    "submit",
    "clear form",
    "required",
    "email address",
    "your response",
    "never submit passwords",
    "sign in",
    "sign out",
    "next",
    "back",
    "previous",
    "this form was created",
    "loading"
  ];

  for (const word of ignored) {
    if (lower.includes(word)) {
      return false;
    }
  }

  return true;
}


function addQuestion(array, text) {

  const normalized =
    text
      .replace(/\s+/g, " ")
      .trim();

  if (!normalized) return;

  const exists = array.some(
    item =>
      item.toLowerCase() ===
      normalized.toLowerCase()
  );

  if (!exists) {
    array.push(normalized);
  }
}


/* ============================
   GENERATE C PROGRAMS
============================ */

app.post(
  "/api/generate",
  upload.single("image"),
  async (req, res) => {

    try {

      const studentId =
        String(req.body.studentId || "").trim();

      const questions =
        String(req.body.questions || "").trim();

      const count = Math.max(
        1,
        Math.min(
          Number(req.body.count || 1),
          20
        )
      );


      if (!studentId) {
        return res.status(400).json({
          error: "Please enter your Student ID."
        });
      }


      if (!questions && !req.file) {
        return res.status(400).json({
          error:
            "Please enter questions or upload an assignment image."
        });
      }


      const prompt = `
You are a C programming assignment generator for first-year engineering students.

Student ID: ${studentId}

Number of programs required: ${count}

Generate exactly ${count} separate C programs based on the assignment questions.

Rules:
- Use standard C only.
- Every program must compile independently.
- Every program must contain main().
- Include return 0;.
- Keep the code beginner-friendly.
- Use simple first-year engineering level C.
- Do not use C++.
- Do not combine questions.
- Each question must have its own program.
- Do not include Markdown code fences.
- Do not include unnecessary explanations.
- Return exactly ${count} programs.

For each program provide:
1. question
2. code

The server will create filenames:

${studentId}_1.c
${studentId}_2.c
${studentId}_3.c
etc.

Assignment questions:

${questions}
`;


      const parts = [
        {
          text: prompt
        }
      ];


      if (req.file) {

        parts.push({
          inlineData: {
            data:
              req.file.buffer.toString("base64"),
            mimeType:
              req.file.mimetype
          }
        });

      }


      const response =
        await ai.models.generateContent({

          model:
            "gemini-3.6-flash",

          contents: [
            {
              role: "user",
              parts: parts
            }
          ],

          config: {

            responseMimeType:
              "application/json",

            responseSchema: {

              type: Type.OBJECT,

              properties: {

                programs: {

                  type: Type.ARRAY,

                  items: {

                    type: Type.OBJECT,

                    properties: {

                      question: {
                        type: Type.STRING
                      },

                      code: {
                        type: Type.STRING
                      }

                    },

                    required: [
                      "question",
                      "code"
                    ]

                  }

                }

              },

              required: [
                "programs"
              ]

            }

          }

        });


      const text =
        response.text;


      if (!text) {
        throw new Error(
          "Gemini returned an empty response."
        );
      }


      const data =
        JSON.parse(text);


      if (
        !data.programs ||
        !Array.isArray(data.programs)
      ) {
        throw new Error(
          "Invalid Gemini response."
        );
      }


      const programs =
        data.programs
          .slice(0, count)
          .map((program, index) => ({

            filename:
              `${studentId}_${index + 1}.c`,

            question:
              program.question ||
              `Question ${index + 1}`,

            code:
              String(
                program.code || ""
              ).trim()

          }));


      if (programs.length === 0) {
        throw new Error(
          "No programs were generated."
        );
      }


      res.json({
        programs
      });

    } catch (error) {

      console.error(
        "Generation error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Something went wrong."
      });
    }
  }
);


/* ============================
   HOME PAGE
============================ */

app.get("/", (req, res) => {

  res.sendFile(
    "index.html",
    {
      root: "public"
    }
  );

});


/* ============================
   START SERVER
============================ */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `C Assignment Generator running on port ${PORT}`
    );

  }
);
