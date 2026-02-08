export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = isAllowedOrigin(origin);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin)
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (!allowedOrigin) {
      return new Response(JSON.stringify({ error: "Origin not allowed", origin }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    const responseText = String(body.response_text || "").trim();
    const learningObjective = String(body.learning_objective || "").trim();
    const criteria = Array.isArray(body.criteria) ? body.criteria : [];

    if (responseText.length < 10 || responseText.length > 2000) {
      return new Response(JSON.stringify({ error: "Response length out of range" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    if (!learningObjective) {
      return new Response(JSON.stringify({ error: "Missing learning_objective" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    /* ============================
       PROMPTS (READY TO USE)
       ============================ */

    const systemPrompt = `
You are an instructional feedback assistant for a college-level course.
Your job is to evaluate a learner's response against a learning objective and explicit criteria.

Rules:
- Be supportive, neutral, and precise.
- Do not reveal chain-of-thought.
- Do not mention being an AI.
- Return ONLY valid JSON.
- Do NOT include markdown or extra text.
`;

    const userPrompt = `
Learning objective:
${learningObjective}

Evaluation criteria:
${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Learner response:
${responseText}

Evaluate the response.

Return ONLY JSON with exactly these fields:
{
  "verdict": "Correct" | "Not quite right" | "Incorrect",
  "summary": "1–3 sentences referencing the learning objective or criteria",
  "criteria_feedback": [
    {
      "criterion": "string",
      "met": true | false,
      "comment": "brief explanation"
    }
  ],
  "next_step": "one concrete suggestion for improvement"
}
`;

    const openaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        text: { format: { type: "json_object" } }
      })
    });

    if (!openaiResp.ok) {
      const err = await openaiResp.text();
      return new Response(JSON.stringify({ error: "OpenAI error", detail: err.slice(0, 300) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    const data = await openaiResp.json();

    const jsonText =
      (typeof data.output_text === "string" && data.output_text.trim()) ||
      extractTextFromResponsesOutput(data) ||
      "";

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return new Response(
        JSON.stringify({
          error: "Model returned non-JSON",
          raw: jsonText.slice(0, 400)
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
        }
      );
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
    });
  }
};

function extractTextFromResponsesOutput(d) {
  try {
    const out = Array.isArray(d.output) ? d.output : [];
    for (const item of out) {
      const content = Array.isArray(item.content) ? item.content : [];
      for (const c of content) {
        if (c && typeof c.text === "string" && c.text.trim()) {
          return c.text.trim();
        }
      }
    }
    return "";
  } catch {
    return "";
  }
}

/* ============================
   ALLOWED ORIGINS
   ============================ */

function isAllowedOrigin(origin) {
  if (!origin) return null;

  // Allow local testing (Captivate preview, local HTML)
  if (/^http:\/\/localhost:\d+$/.test(origin)) return origin;


  // Example: https://gaodeg-source.github.io
  if (origin === "https://gaodeg-source.github.io") return origin;

  return null;
}

function corsHeaders(origin) {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
