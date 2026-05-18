import express from "express";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Store conversation history per user (in-memory)
const conversations = {};

// ─── 1. WEBHOOK VERIFICATION (Meta requires this) ─────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook verified!");
    res.status(200).send(challenge); // Must send this back to Meta
  } else {
    res.sendStatus(403);
  }
});

// ─── 2. RECEIVE MESSAGES ──────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Always respond immediately to Meta

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Ignore status updates (delivered, read, etc.)
    if (!value?.messages) return;

    const message = value.messages[0];
    const from = message.from; // Sender's phone number
    const msgType = message.type;

    // Only handle text messages for now
    if (msgType !== "text") {
      await sendWhatsApp(from, "Sorry, I can only handle text messages right now.");
      return;
    }

    const userText = message.text.body;
    console.log(`📩 From ${from}: ${userText}`);

    // Get AI reply
    const aiReply = await getClaudeReply(from, userText);
    console.log(`🤖 Claude: ${aiReply}`);

    // Send reply back via WhatsApp
    await sendWhatsApp(from, aiReply);

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
});

// ─── 3. CLAUDE AI WITH MEMORY ─────────────────────────────────────────────────
async function getClaudeReply(userId, userMessage) {
  // Initialize conversation history for new users
  if (!conversations[userId]) {
    conversations[userId] = [];
  }

  // Add user message to history
  conversations[userId].push({
    role: "user",
    content: userMessage,
  });

  // Keep only last 20 messages to avoid token overflow
  if (conversations[userId].length > 20) {
    conversations[userId] = conversations[userId].slice(-20);
  }

  const response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are a helpful AI assistant on WhatsApp. 
Keep your replies concise and conversational — this is a chat app.
Avoid long bullet lists unless really necessary.
Today's date: ${new Date().toDateString()}`,
    messages: conversations[userId],
  });

  const assistantReply = response.content[0].text;

  // Save assistant reply to history
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

// ─── 5. START SERVER ──────────────────────────────────────────────────────────
app.listen(process.env.PORT, () => {
  console.log(`🚀 Server running on port ${process.env.PORT}`);
});