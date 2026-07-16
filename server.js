"use strict";

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const nodemailer = require("nodemailer");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const MAX_AUDIO_SIZE = 25 * 1024 * 1024;
const CONTACT_TO = process.env.CONTACT_TO || "nishima2210@gmail.com";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_SECURE =
  String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || SMTP_PORT === 465;
const CONTACT_FROM = process.env.CONTACT_FROM || SMTP_USER || CONTACT_TO;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/contact") {
      await handleContact(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/transcribe") {
      await handleTranscription(req, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "The local server hit an unexpected error." });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Local site running at http://${HOST}:${PORT}/`);
  });
}

async function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url;
  const pathname = decodeURIComponent(requestPath.split("?")[0]);
  const safePath = path.normalize(path.join(ROOT_DIR, pathname));

  if (!safePath.startsWith(ROOT_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  let filePath = safePath;

  try {
    const stats = await fsp.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch (error) {
    sendText(res, 404, "Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

async function handleTranscription(req, res) {
  if (!String(req.headers["content-type"] || "").includes("multipart/form-data")) {
    sendJson(res, 400, {
      error: "Submit the form as multipart data with an audio file attached.",
    });
    return;
  }

  const formData = await toFormData(req);
  const audioFile = formData.get("audio");
  const providedApiKey = String(formData.get("apiKey") || "").trim();
  const prompt = String(formData.get("prompt") || "").trim();
  const language = String(formData.get("language") || "").trim();
  const requestedModel = String(formData.get("model") || "").trim();
  const model = requestedModel || "gpt-4o-mini-transcribe";
  const apiKey = process.env.OPENAI_API_KEY || providedApiKey;

  if (!apiKey) {
    sendJson(res, 400, {
      error: "Add an OpenAI API key in the form or set OPENAI_API_KEY before starting the server.",
    });
    return;
  }

  if (!(audioFile instanceof File)) {
    sendJson(res, 400, { error: "Upload an audio file before transcribing." });
    return;
  }

  if (!audioFile.size) {
    sendJson(res, 400, { error: "The uploaded file is empty." });
    return;
  }

  if (audioFile.size > MAX_AUDIO_SIZE) {
    sendJson(res, 400, { error: "OpenAI currently supports files up to 25 MB for this endpoint." });
    return;
  }

  const outboundForm = new FormData();
  const buffer = Buffer.from(await audioFile.arrayBuffer());
  const outgoingFile = new File([buffer], audioFile.name || "audio.mp3", {
    type: audioFile.type || "application/octet-stream",
  });

  outboundForm.set("file", outgoingFile);
  outboundForm.set("model", model);
  outboundForm.set("response_format", "json");

  if (prompt) {
    outboundForm.set("prompt", prompt);
  }

  if (language) {
    outboundForm.set("language", language);
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: outboundForm,
  });

  const responseText = await response.text();

  if (!response.ok) {
    let message = "Transcription failed.";

    try {
      const payload = JSON.parse(responseText);
      message = payload.error?.message || message;
    } catch (error) {
      if (responseText.trim()) {
        message = responseText.trim();
      }
    }

    sendJson(res, response.status, { error: message });
    return;
  }

  let transcript = "";

  try {
    const payload = JSON.parse(responseText);
    transcript = String(payload.text || "").trim();
  } catch (error) {
    transcript = responseText.trim();
  }

  sendJson(res, 200, {
    transcript,
    fileName: swapExtension(audioFile.name || "transcript", ".txt"),
    model,
  });
}

async function handleContact(req, res) {
  if (!String(req.headers["content-type"] || "").includes("application/json")) {
    sendJson(res, 400, { error: "Submit the contact form as JSON." });
    return;
  }

  const body = await readJsonBody(req);
  const name = String(body?.name || "").trim();
  const email = String(body?.email || "").trim();
  const message = String(body?.message || "").trim();

  if (!name || !email || !message) {
    sendJson(res, 400, { error: "Name, email, and message are required." });
    return;
  }

  if (!isValidEmail(email)) {
    sendJson(res, 400, { error: "Please enter a valid email address." });
    return;
  }

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    sendJson(res, 500, {
      error:
        "Email delivery is not configured yet. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and optionally SMTP_SECURE, CONTACT_FROM, CONTACT_TO on the server.",
    });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: CONTACT_FROM,
    to: CONTACT_TO,
    replyTo: email,
    subject: `New consultation request from ${name}`,
    text: [
      "New consultation request",
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      "",
      "Message:",
      message,
    ].join("\n"),
    html: [
      "<h2>New consultation request</h2>",
      `<p><strong>Name:</strong> ${escapeHtml(name)}</p>`,
      `<p><strong>Email:</strong> ${escapeHtml(email)}</p>`,
      `<p><strong>Message:</strong></p>`,
      `<p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`,
    ].join(""),
  });

  sendJson(res, 200, { ok: true });
}

async function toFormData(req) {
  const url = `http://${req.headers.host || `localhost:${PORT}`}${req.url}`;
  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: req,
    duplex: "half",
  });

  return request.formData();
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function swapExtension(fileName, nextExtension) {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "transcript";
  return `${baseName}${nextExtension}`;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = server;
