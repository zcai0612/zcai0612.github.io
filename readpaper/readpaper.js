(function () {
  "use strict";

  const PASSWORD_HASH = "bb644300fbc1dc770ecb4342af41c77b97c7b72aea66ea299b64f647df8116b1";
  const AUTH_KEY = "readpaper.auth.v1";
  const STORAGE_KEY = "readpaper.papers.v1";

  const state = {
    papers: [],
    filter: "all",
    query: "",
    sort: "updated-desc",
    editingId: null,
    fetchToken: 0,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const els = {};

  document.addEventListener("DOMContentLoaded", () => {
    Object.assign(els, {
      lockScreen: $("[data-lock-screen]"),
      authForm: $("[data-auth-form]"),
      passwordInput: $("[data-password-input]"),
      authMessage: $("[data-auth-message]"),
      app: $("[data-paper-app]"),
      paperForm: $("[data-paper-form]"),
      paperId: $("[data-paper-id]"),
      urlInput: $("[data-url-input]"),
      titleInput: $("[data-title-input]"),
      statusInput: $("[data-status-input]"),
      descriptionInput: $("[data-description-input]"),
      fetchTitleButton: $("[data-fetch-title]"),
      cancelEditButton: $("[data-cancel-edit]"),
      submitPaperButton: $("[data-submit-paper]"),
      formMessage: $("[data-form-message]"),
      searchInput: $("[data-search-input]"),
      sortSelect: $("[data-sort-select]"),
      paperList: $("[data-paper-list]"),
      emptyState: $("[data-empty-state]"),
      importButton: $("[data-import-button]"),
      exportButton: $("[data-export-button]"),
      importInput: $("[data-import-input]"),
      statTotal: $("[data-stat-total]"),
      statUnread: $("[data-stat-unread]"),
      statRead: $("[data-stat-read]"),
    });

    bindAuth();
    bindApp();

    if (sessionStorage.getItem(AUTH_KEY) === PASSWORD_HASH) {
      unlock();
    } else {
      els.passwordInput.focus();
    }
  });

  function bindAuth() {
    els.authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setMessage(els.authMessage, "");

      try {
        const enteredHash = await sha256(els.passwordInput.value);

        if (enteredHash === PASSWORD_HASH) {
          sessionStorage.setItem(AUTH_KEY, PASSWORD_HASH);
          els.passwordInput.value = "";
          unlock();
          return;
        }

        setMessage(els.authMessage, "Wrong password.", "error");
        els.passwordInput.select();
      } catch (error) {
        setMessage(els.authMessage, "Password check is unavailable in this browser.", "error");
      }
    });
  }

  function bindApp() {
    els.paperForm.addEventListener("submit", handlePaperSubmit);
    els.fetchTitleButton.addEventListener("click", () => fillTitleFromArxiv(true));
    els.urlInput.addEventListener("blur", () => {
      if (!els.titleInput.value.trim() && extractArxivId(els.urlInput.value)) {
        fillTitleFromArxiv(false);
      }
    });
    els.cancelEditButton.addEventListener("click", resetForm);
    els.searchInput.addEventListener("input", () => {
      state.query = els.searchInput.value.trim().toLowerCase();
      render();
    });
    els.sortSelect.addEventListener("change", () => {
      state.sort = els.sortSelect.value;
      render();
    });
    $$("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.filter = button.dataset.filter;
        $$("[data-filter]").forEach((item) => {
          item.classList.toggle("is-active", item === button);
        });
        render();
      });
    });
    els.paperList.addEventListener("click", handleListClick);
    els.exportButton.addEventListener("click", exportPapers);
    els.importButton.addEventListener("click", () => els.importInput.click());
    els.importInput.addEventListener("change", importPapers);
  }

  function unlock() {
    els.lockScreen.hidden = true;
    els.app.hidden = false;
    state.papers = loadPapers();
    render();
    els.urlInput.focus();
  }

  async function sha256(text) {
    if (!crypto.subtle) {
      return sha256Fallback(text);
    }

    const bytes = new TextEncoder().encode(text);
    const buffer = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function sha256Fallback(text) {
    const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
    const bytes = new TextEncoder().encode(text);
    const bitLength = bytes.length * 8;
    const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;

    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 4, bitLength, false);

    const hash = [
      0x6a09e667,
      0xbb67ae85,
      0x3c6ef372,
      0xa54ff53a,
      0x510e527f,
      0x9b05688c,
      0x1f83d9ab,
      0x5be0cd19,
    ];
    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
      0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
      0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
      0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
      0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
      0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    for (let offset = 0; offset < paddedLength; offset += 64) {
      const words = new Uint32Array(64);
      for (let index = 0; index < 16; index += 1) {
        words[index] = view.getUint32(offset + index * 4, false);
      }
      for (let index = 16; index < 64; index += 1) {
        const s0 =
          rightRotate(words[index - 15], 7) ^
          rightRotate(words[index - 15], 18) ^
          (words[index - 15] >>> 3);
        const s1 =
          rightRotate(words[index - 2], 17) ^
          rightRotate(words[index - 2], 19) ^
          (words[index - 2] >>> 10);
        words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
      }

      let [a, b, c, d, e, f, g, h] = hash;

      for (let index = 0; index < 64; index += 1) {
        const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temp1 = (h + s1 + choice + constants[index] + words[index]) >>> 0;
        const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + majority) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }

    return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
  }

  async function handlePaperSubmit(event) {
    event.preventDefault();
    setMessage(els.formMessage, "");

    const url = normalizeUrl(els.urlInput.value);
    if (!url) {
      setMessage(els.formMessage, "Please enter a valid link.", "error");
      els.urlInput.focus();
      return;
    }

    let title = els.titleInput.value.trim();
    const arxivId = extractArxivId(url);

    if (!title && arxivId) {
      title = await fetchArxivTitleSafely(url);
      if (title) {
        els.titleInput.value = title;
      }
    }

    if (!title) {
      title = titleFromUrl(url);
    }

    const description = els.descriptionInput.value.trim();
    const status = els.statusInput.value === "read" ? "read" : "unread";
    const now = new Date().toISOString();
    const editingId = state.editingId;
    const duplicate = state.papers.find((paper) => paper.url === url && paper.id !== editingId);

    if (duplicate) {
      setMessage(els.formMessage, "This link is already in the list.", "error");
      return;
    }

    if (editingId) {
      state.papers = state.papers.map((paper) => {
        if (paper.id !== editingId) {
          return paper;
        }
        return {
          ...paper,
          url,
          title,
          description,
          status,
          arxivId,
          updatedAt: now,
        };
      });
      savePapers();
      render();
      resetForm();
      setMessage(els.formMessage, "Saved.", "success");
      return;
    }

    state.papers.unshift({
      id: createId(),
      url,
      title,
      description,
      status,
      arxivId,
      createdAt: now,
      updatedAt: now,
    });
    savePapers();
    render();
    resetForm();
    setMessage(els.formMessage, "Added.", "success");
  }

  async function fillTitleFromArxiv(showErrors) {
    const token = ++state.fetchToken;
    const source = els.urlInput.value.trim();

    if (!extractArxivId(source)) {
      if (showErrors) {
        setMessage(els.formMessage, "This is not an arXiv link.", "error");
      }
      return;
    }

    const previousText = els.fetchTitleButton.textContent;
    els.fetchTitleButton.disabled = true;
    els.fetchTitleButton.textContent = "Fetching...";
    setMessage(els.formMessage, "");

    try {
      const title = await fetchArxivTitle(source);
      if (token !== state.fetchToken) {
        return;
      }
      els.titleInput.value = title;
      setMessage(els.formMessage, "Title fetched.", "success");
    } catch (error) {
      if (showErrors) {
        setMessage(els.formMessage, "Could not fetch the title.", "error");
      }
    } finally {
      if (token === state.fetchToken) {
        els.fetchTitleButton.disabled = false;
        els.fetchTitleButton.textContent = previousText;
      }
    }
  }

  async function fetchArxivTitleSafely(source) {
    try {
      return await fetchArxivTitle(source);
    } catch (error) {
      return "";
    }
  }

  async function fetchArxivTitle(source) {
    const arxivId = extractArxivId(source);
    if (!arxivId) {
      throw new Error("Not an arXiv link");
    }

    try {
      const semanticUrl = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${encodeURIComponent(arxivId)}?fields=title`;
      const semanticResponse = await fetchWithTimeout(semanticUrl, {
        headers: { Accept: "application/json" },
      });

      if (semanticResponse.ok) {
        const data = await semanticResponse.json();
        if (data && data.title) {
          return cleanTitle(data.title);
        }
      }
    } catch (error) {
      // Continue to the arXiv Atom API below.
    }

    const arxivUrl = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
    const arxivResponse = await fetchWithTimeout(arxivUrl, {
      headers: { Accept: "application/atom+xml" },
    });

    if (!arxivResponse.ok) {
      throw new Error("arXiv request failed");
    }

    const xml = await arxivResponse.text();
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const title = doc.querySelector("entry > title");
    if (!title || !title.textContent.trim()) {
      throw new Error("No title found");
    }
    return cleanTitle(title.textContent);
  }

  async function fetchWithTimeout(url, options = {}, timeout = 9000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
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

  function handleListClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const card = button.closest("[data-paper-id]");
    const paper = state.papers.find((item) => item.id === card.dataset.paperId);
    if (!paper) {
      return;
    }

    if (button.dataset.action === "toggle") {
      paper.status = paper.status === "read" ? "unread" : "read";
      paper.updatedAt = new Date().toISOString();
      savePapers();
      render();
      return;
    }

    if (button.dataset.action === "edit") {
      startEdit(paper);
      return;
    }

    if (button.dataset.action === "delete" && confirm(`Delete "${paper.title}"?`)) {
      state.papers = state.papers.filter((item) => item.id !== paper.id);
      savePapers();
      render();
    }
  }

  function startEdit(paper) {
    state.editingId = paper.id;
    els.paperId.value = paper.id;
    els.urlInput.value = paper.url;
    els.titleInput.value = paper.title;
    els.statusInput.value = paper.status;
    els.descriptionInput.value = paper.description || "";
    els.submitPaperButton.textContent = "Save Changes";
    els.cancelEditButton.hidden = false;
    setMessage(els.formMessage, "");
    $("#add-paper").scrollIntoView({ behavior: "smooth", block: "start" });
    els.titleInput.focus();
  }

  function resetForm() {
    state.editingId = null;
    els.paperForm.reset();
    els.paperId.value = "";
    els.statusInput.value = "unread";
    els.submitPaperButton.textContent = "Add Paper";
    els.cancelEditButton.hidden = true;
  }

  function render() {
    renderStats();

    const papers = getVisiblePapers();
    els.paperList.replaceChildren(...papers.map(createPaperCard));
    els.emptyState.hidden = papers.length > 0;
    els.emptyState.textContent = state.papers.length ? "No matching papers." : "No papers yet.";
  }

  function renderStats() {
    const total = state.papers.length;
    const read = state.papers.filter((paper) => paper.status === "read").length;
    els.statTotal.textContent = total;
    els.statUnread.textContent = total - read;
    els.statRead.textContent = read;
  }

  function getVisiblePapers() {
    const query = state.query;
    const filtered = state.papers.filter((paper) => {
      if (state.filter !== "all" && paper.status !== state.filter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        paper.title,
        paper.url,
        paper.description,
        paper.status,
        paper.arxivId,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });

    return filtered.sort((a, b) => {
      if (state.sort === "created-asc") {
        return a.createdAt.localeCompare(b.createdAt);
      }
      if (state.sort === "created-desc") {
        return b.createdAt.localeCompare(a.createdAt);
      }
      if (state.sort === "title-asc") {
        return a.title.localeCompare(b.title);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  function createPaperCard(paper) {
    const card = document.createElement("article");
    card.className = "paper-card";
    card.dataset.paperId = paper.id;

    const body = document.createElement("div");
    body.className = "paper-body";

    const titleRow = document.createElement("div");
    titleRow.className = "paper-title-row";

    const heading = document.createElement("h2");
    const link = document.createElement("a");
    link.href = paper.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = paper.title;
    heading.append(link);

    const badge = document.createElement("span");
    badge.className = `status-badge ${paper.status === "read" ? "is-read" : ""}`;
    badge.textContent = paper.status === "read" ? "Read" : "Unread";

    titleRow.append(heading, badge);

    const paperLink = document.createElement("p");
    paperLink.className = "paper-link";
    paperLink.textContent = paper.url;

    body.append(titleRow, paperLink);

    if (paper.description) {
      const description = document.createElement("p");
      description.className = "paper-description";
      description.textContent = paper.description;
      body.append(description);
    }

    const meta = document.createElement("p");
    meta.className = "paper-meta";
    meta.append(
      metaSpan(`Added ${formatDate(paper.createdAt)}`),
      metaSpan(`Updated ${formatDate(paper.updatedAt)}`)
    );
    if (paper.arxivId) {
      meta.append(metaSpan(`arXiv ${paper.arxivId}`));
    }
    body.append(meta);

    const actions = document.createElement("div");
    actions.className = "paper-actions";
    actions.append(
      actionButton(paper.status === "read" ? "Mark Unread" : "Mark Read", "toggle", "button-secondary"),
      actionButton("Edit", "edit", "button-secondary"),
      actionButton("Delete", "delete", "danger-button")
    );

    card.append(body, actions);
    return card;
  }

  function metaSpan(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
  }

  function actionButton(label, action, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${className}`;
    button.dataset.action = action;
    button.textContent = label;
    return button;
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(new Date(value));
  }

  function createId() {
    if (crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `paper-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function loadPapers() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map(normalizePaper).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  function normalizePaper(paper) {
    if (!paper || !paper.url) {
      return null;
    }

    const now = new Date().toISOString();
    return {
      id: paper.id || createId(),
      url: String(paper.url),
      title: cleanTitle(paper.title) || titleFromUrl(paper.url),
      description: String(paper.description || ""),
      status: paper.status === "read" ? "read" : "unread",
      arxivId: paper.arxivId || extractArxivId(paper.url),
      createdAt: paper.createdAt || now,
      updatedAt: paper.updatedAt || paper.createdAt || now,
    };
  }

  function savePapers() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.papers));
  }

  function exportPapers() {
    const payload = {
      exportedAt: new Date().toISOString(),
      papers: state.papers,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `readpaper-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importPapers() {
    const file = els.importInput.files[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = Array.isArray(parsed) ? parsed : parsed.papers;
      if (!Array.isArray(incoming)) {
        throw new Error("Invalid import file");
      }

      const byUrl = new Map(state.papers.map((paper) => [paper.url, paper]));
      incoming.map(normalizePaper).filter(Boolean).forEach((paper) => {
        byUrl.set(paper.url, {
          ...byUrl.get(paper.url),
          ...paper,
          updatedAt: new Date().toISOString(),
        });
      });
      state.papers = Array.from(byUrl.values());
      savePapers();
      render();
      setMessage(els.formMessage, "Imported.", "success");
    } catch (error) {
      setMessage(els.formMessage, "Import failed.", "error");
    } finally {
      els.importInput.value = "";
    }
  }

  function setMessage(element, text, type) {
    element.textContent = text;
    element.classList.toggle("is-error", type === "error");
    element.classList.toggle("is-success", type === "success");
  }
})();
