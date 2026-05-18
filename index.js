import express from "express";
import axios from "axios";
import Groq from "groq-sdk";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const conversations = {};

// ─── 1. WEBHOOK VERIFICATION ──────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook verified!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── 2. RECEIVE MESSAGES ──────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages) return;

    const message = value.messages[0];
    const from = message.from;
    const msgType = message.type;

    if (msgType !== "text") {
      await sendWhatsApp(from, "Sorry, I can only handle text messages right now.");
      return;
    }

    const userText = message.text.body;
    console.log(`📩 From ${from}: ${userText}`);

    const aiReply = await getGroqReply(from, userText);
    console.log(`🤖 Groq: ${aiReply}`);

    await sendWhatsApp(from, aiReply);

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
});

// ─── 3. GROQ AI WITH MEMORY ───────────────────────────────────────────────────
async function getGroqReply(userId, userMessage) {
  if (!conversations[userId]) {
    conversations[userId] = [];
  }

  conversations[userId].push({
    role: "user",
    content: userMessage,
  });

  if (conversations[userId].length > 20) {
    conversations[userId] = conversations[userId].slice(-20);
  }

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile", // Free & fast
    max_tokens: 1024,
    messages: [
      {
        role: "system",
        content: `You are a helpful AI assistant on WhatsApp.
Keep your replies concise and conversational — this is a chat app.
Avoid long bullet lists unless really necessary.
Today's date: ${new Date().toDateString()}`,
      },
      ...conversations[userId],
    ],
  });

  const assistantReply = response.choices[0].message.content;

  conversations[userId].push({
    role: "assistant",
    content: assistantReply,
  });

  return assistantReply;
}

// ─── 4. SEND WHATSAPP MESSAGE ─────────────────────────────────────────────────
async function sendWhatsApp(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ─── 5. KEEP ALIVE ────────────────────────────────────────────────────────────
setInterval(() => {
  axios.get("https://wab-kt2c.onrender.com/webhook").catch(() => {});
}, 10 * 60 * 1000);

// ─── 6. START SERVER ──────────────────────────────────────────────────────────
app.listen(process.env.PORT, () => {
  console.log(`🚀 Server running on port ${process.env.PORT}`);
});