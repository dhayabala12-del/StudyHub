// This runs on Vercel's server, never in the student's browser.
// Uses Google's Gemini API (free tier) — the key stays private via
// process.env.GEMINI_API_KEY. Accepts the same { system, messages, maxTokens }
// shape the frontend already sends, and replies in the same
// { content: [{ type: "text", text }] } shape it already expects — so no
// frontend code needs to change.

function toGeminiParts(content) {
  if (typeof content === "string") return [{ text: content }];
  return (content || []).map((block) => {
    if (block.type === "text") return { text: block.text };
    if (block.type === "image" || block.type === "document") {
      return {
        inline_data: {
          mime_type: block.source?.media_type,
          data: block.source?.data,
        },
      };
    }
    return { text: "" };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });
    return;
  }

  try {
    const { system, messages, maxTokens } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages is required" });
      return;
    }

    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: toGeminiParts(m.content),
    }));

    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: Math.min(Number(maxTokens) || 1000, 4000),
        thinkingConfig: { thinkingBudget: 0 },
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const data = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: data?.error?.message || "Upstream error" });
      return;
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("");

    res.status(200).json({ content: [{ type: "text", text }] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong contacting the AI" });
  }
}
