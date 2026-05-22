const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = getCorsHeaders(env, origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/health" && request.method === "GET") {
        return json({ ok: true }, 200, corsHeaders);
      }

      if (path === "/auth" && request.method === "POST") {
        return handleAuth(request, env, corsHeaders);
      }

      const auth = await requireAuth(request, env);
      if (!auth.ok) {
        return json({ error: auth.error }, auth.status, corsHeaders);
      }

      if (path === "/papers" && request.method === "GET") {
        return listPapers(env, corsHeaders);
      }

      if (path === "/papers" && request.method === "POST") {
        return createPaper(request, env, corsHeaders);
      }

      if (path === "/papers/import" && request.method === "POST") {
        return importPapers(request, env, corsHeaders);
      }

      const paperMatch = path.match(/^\/papers\/([^/]+)$/);
      if (paperMatch && request.method === "PATCH") {
        return updatePaper(paperMatch[1], request, env, corsHeaders);
      }

      if (paperMatch && request.method === "DELETE") {
        return deletePaper(paperMatch[1], env, corsHeaders);
      }

      return json({ error: "Not found" }, 404, corsHeaders);
    } catch (error) {
      return json({ error: "Internal server error" }, 500, corsHeaders);
    }
  },
};

async function handleAuth(request, env, corsHeaders) {
  if (!env.READPAPER_PASSWORD_HASH || !env.READPAPER_AUTH_SECRET) {
    return json({ error: "Server is not configured" }, 500, corsHeaders);
  }

  const body = await readJson(request);
  const password = String(body.password || "");
  const passwordHash = await sha256Hex(password);

  if (!timingSafeEqual(passwordHash, env.READPAPER_PASSWORD_HASH)) {
    return json({ error: "Wrong password" }, 401, corsHeaders);
  }

  const ttl = Number(env.TOKEN_TTL_SECONDS || 604800);
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const token = await signToken({ exp: expiresAt }, env.READPAPER_AUTH_SECRET);

  return json({ token, expiresAt }, 200, corsHeaders);
}

async function requireAuth(request, env) {
  if (!env.READPAPER_AUTH_SECRET) {
    return { ok: false, status: 500, error: "Server is not configured" };
  }

  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, error: "Missing token" };
  }

  const valid = await verifyToken(match[1], env.READPAPER_AUTH_SECRET);
  if (!valid) {
    return { ok: false, status: 401, error: "Invalid token" };
  }

  return { ok: true };
}

async function listPapers(env, corsHeaders) {
  const { results } = await env.DB.prepare(
    `SELECT id, url, title, description, status, arxiv_id AS arxivId,
            created_at AS createdAt, updated_at AS updatedAt
       FROM papers
      ORDER BY updated_at DESC`
  ).all();

  return json({ papers: results || [] }, 200, corsHeaders);
}

async function createPaper(request, env, corsHeaders) {
  const input = normalizePaperInput(await readJson(request));
  if (!input.ok) {
    return json({ error: input.error }, 400, corsHeaders);
  }

  const now = new Date().toISOString();
  const paper = {
    id: crypto.randomUUID(),
    ...input.paper,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await env.DB.prepare(
      `INSERT INTO papers (id, url, title, description, status, arxiv_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        paper.id,
        paper.url,
        paper.title,
        paper.description,
        paper.status,
        paper.arxivId,
        paper.createdAt,
        paper.updatedAt
      )
      .run();
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return json({ error: "This link is already in the list" }, 409, corsHeaders);
    }
    throw error;
  }

  return json({ paper }, 201, corsHeaders);
}

async function updatePaper(id, request, env, corsHeaders) {
  const existing = await getPaper(env, id);
  if (!existing) {
    return json({ error: "Paper not found" }, 404, corsHeaders);
  }

  const body = await readJson(request);
  const merged = {
    url: body.url ?? existing.url,
    title: body.title ?? existing.title,
    description: body.description ?? existing.description,
    status: body.status ?? existing.status,
    arxivId: body.arxivId ?? existing.arxivId,
  };
  const input = normalizePaperInput(merged);
  if (!input.ok) {
    return json({ error: input.error }, 400, corsHeaders);
  }

  const updatedAt = new Date().toISOString();

  try {
    await env.DB.prepare(
      `UPDATE papers
          SET url = ?, title = ?, description = ?, status = ?, arxiv_id = ?, updated_at = ?
        WHERE id = ?`
    )
      .bind(
        input.paper.url,
        input.paper.title,
        input.paper.description,
        input.paper.status,
        input.paper.arxivId,
        updatedAt,
        id
      )
      .run();
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return json({ error: "This link is already in the list" }, 409, corsHeaders);
    }
    throw error;
  }

  const paper = await getPaper(env, id);
  return json({ paper }, 200, corsHeaders);
}

async function deletePaper(id, env, corsHeaders) {
  await env.DB.prepare("DELETE FROM papers WHERE id = ?").bind(id).run();
  return json({ ok: true }, 200, corsHeaders);
}

async function importPapers(request, env, corsHeaders) {
  const body = await readJson(request);
  const incoming = Array.isArray(body) ? body : body.papers;

  if (!Array.isArray(incoming)) {
    return json({ error: "Invalid import payload" }, 400, corsHeaders);
  }

  const now = new Date().toISOString();
  let imported = 0;

  for (const rawPaper of incoming) {
    const input = normalizePaperInput(rawPaper);
    if (!input.ok) {
      continue;
    }

    const id = crypto.randomUUID();
    const createdAt = rawPaper.createdAt || now;
    const updatedAt = now;

    await env.DB.prepare(
      `INSERT INTO papers (id, url, title, description, status, arxiv_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         status = excluded.status,
         arxiv_id = excluded.arxiv_id,
         updated_at = excluded.updated_at`
    )
      .bind(
        id,
        input.paper.url,
        input.paper.title,
        input.paper.description,
        input.paper.status,
        input.paper.arxivId,
        createdAt,
        updatedAt
      )
      .run();
    imported += 1;
  }

  const { results } = await env.DB.prepare(
    `SELECT id, url, title, description, status, arxiv_id AS arxivId,
            created_at AS createdAt, updated_at AS updatedAt
       FROM papers
      ORDER BY updated_at DESC`
  ).all();

  return json({ imported, papers: results || [] }, 200, corsHeaders);
}

async function getPaper(env, id) {
  return env.DB.prepare(
    `SELECT id, url, title, description, status, arxiv_id AS arxivId,
            created_at AS createdAt, updated_at AS updatedAt
       FROM papers
      WHERE id = ?`
  )
    .bind(id)
    .first();
}

function normalizePaperInput(input) {
  const url = normalizeUrl(input.url);
  if (!url) {
    return { ok: false, error: "A valid URL is required" };
  }

  const title = cleanTitle(input.title) || titleFromUrl(url);
  const status = input.status === "read" ? "read" : "unread";
  const arxivId = cleanTitle(input.arxivId) || extractArxivId(url) || null;

  return {
    ok: true,
    paper: {
      url,
      title,
      description: String(input.description || ""),
      status,
      arxivId,
    },
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (error) {
    return {};
  }
}

function json(payload, status, corsHeaders) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders,
    },
  });
}

function getCorsHeaders(env, origin) {
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

async function signToken(payload, secret) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function verifyToken(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return false;
  }

  const [encodedPayload, signature] = parts;
  const expected = await hmacSha256(encodedPayload, secret);
  if (!timingSafeEqual(signature, expected)) {
    return false;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    return Number(payload.exp || 0) > Math.floor(Date.now() / 1000);
  } catch (error) {
    return false;
  }
}

async function hmacSha256(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bufferToHex(signature);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bufferToHex(digest);
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const arxivId = extractArxivId(trimmed);
  if (arxivId && !trimmed.match(/^https?:\/\//i)) {
    return `https://arxiv.org/abs/${arxivId}`;
  }

  try {
    const url = new URL(trimmed.match(/^https?:\/\//i) ? trimmed : `https://${trimmed}`);
    url.hash = "";
    return url.toString();
  } catch (error) {
    return "";
  }
}

function cleanTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const pathName = parsed.pathname.split("/").filter(Boolean).pop();
    return cleanTitle(pathName ? decodeURIComponent(pathName).replace(/[-_]+/g, " ") : parsed.hostname);
  } catch (error) {
    return "Untitled Paper";
  }
}

function extractArxivId(value) {
  const source = String(value || "").trim();
  if (!source) {
    return "";
  }

  const direct = source.replace(/^arxiv:/i, "").replace(/\.pdf$/i, "");
  if (isArxivId(direct)) {
    return direct;
  }

  let url;
  try {
    url = new URL(source.match(/^https?:\/\//i) ? source : `https://${source}`);
  } catch (error) {
    return "";
  }

  const host = url.hostname.toLowerCase();
  if (!host.endsWith("arxiv.org")) {
    return "";
  }

  const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const parts = path.split("/").filter(Boolean);
  let id = "";

  if (["abs", "pdf", "html", "e-print"].includes(parts[0])) {
    id = parts.slice(1).join("/");
  } else {
    id = parts.join("/");
  }

  id = id.replace(/\.pdf$/i, "");
  return isArxivId(id) ? id : "";
}

function isArxivId(value) {
  return (
    /^\d{4}\.\d{4,5}(v\d+)?$/i.test(value) ||
    /^[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/i.test(value)
  );
}
