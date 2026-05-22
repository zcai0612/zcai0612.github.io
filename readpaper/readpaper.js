(function () {
  "use strict";

  const API_BASE = String(window.READPAPER_API_BASE || "").replace(/\/+$/, "");
  const TOKEN_KEY = "readpaper.apiToken.v1";
  const TOKEN_EXPIRES_KEY = "readpaper.apiTokenExpires.v1";

  const state = {
    papers: [],
    filter: "all",
    query: "",
    sort: "updated-desc",
    editingId: null,
    fetchToken: 0,
    loading: false,
    syncError: "",
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

    if (hasValidToken()) {
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
        ensureApiConfigured();
        const response = await apiRequest("/auth", {
          method: "POST",
          auth: false,
          body: { password: els.passwordInput.value },
        });

        localStorage.setItem(TOKEN_KEY, response.token);
        localStorage.setItem(TOKEN_EXPIRES_KEY, String(response.expiresAt));
        els.passwordInput.value = "";
        await unlock();
      } catch (error) {
        setMessage(els.authMessage, error.message || "Login failed.", "error");
        els.passwordInput.select();
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

  async function unlock() {
    els.lockScreen.hidden = true;
    els.app.hidden = false;
    addSyncBanner();
    render();
    await refreshPapers();
    els.urlInput.focus();
  }

  function addSyncBanner() {
    if ($("[data-sync-banner]")) {
      return;
    }

    const banner = document.createElement("div");
    banner.className = "sync-banner";
    banner.dataset.syncBanner = "";

    const text = document.createElement("p");
    text.dataset.syncMessage = "";
    text.textContent = "Syncing with Cloudflare D1.";

    const button = document.createElement("button");
    button.className = "button button-secondary";
    button.type = "button";
    button.textContent = "Refresh";
    button.addEventListener("click", refreshPapers);

    banner.append(text, button);
    els.app.insertBefore(banner, els.app.firstChild);
    els.syncBanner = banner;
    els.syncMessage = text;
  }

  async function refreshPapers() {
    setLoading(true);
    state.syncError = "";
    updateSyncMessage("Loading papers...");

    try {
      const response = await apiRequest("/papers");
      state.papers = Array.isArray(response.papers) ? response.papers.map(normalizePaper).filter(Boolean) : [];
      updateSyncMessage("Synced.");
    } catch (error) {
      state.syncError = error.message || "Sync failed.";
      updateSyncMessage(state.syncError, true);
      if (String(error.message || "").toLowerCase().includes("token")) {
        clearToken();
        els.app.hidden = true;
        els.lockScreen.hidden = false;
        els.passwordInput.focus();
      }
    } finally {
      setLoading(false);
      render();
    }
  }

  async function handlePaperSubmit(event) {
    event.preventDefault();
    setMessage(els.formMessage, "");

    const payload = await collectPaperPayload();
    if (!payload) {
      return;
    }

    const editingId = state.editingId;
    const method = editingId ? "PATCH" : "POST";
    const path = editingId ? `/papers/${encodeURIComponent(editingId)}` : "/papers";

    try {
      setLoading(true);
      const response = await apiRequest(path, { method, body: payload });
      const paper = normalizePaper(response.paper);

      if (paper) {
        if (editingId) {
          state.papers = state.papers.map((item) => (item.id === editingId ? paper : item));
        } else {
          state.papers.unshift(paper);
        }
      } else {
        await refreshPapers();
      }

      render();
      resetForm();
      setMessage(els.formMessage, editingId ? "Saved." : "Added.", "success");
      updateSyncMessage("Synced.");
    } catch (error) {
      setMessage(els.formMessage, error.message || "Save failed.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function collectPaperPayload() {
    const url = normalizeUrl(els.urlInput.value);
    if (!url) {
      setMessage(els.formMessage, "Please enter a valid link.", "error");
      els.urlInput.focus();
      return null;
    }

    let title = els.titleInput.value.trim();
    const arxivId = extractArxivId(url);

    if (!title && arxivId) {
      title = await fetchArxivTitleSafely(url);
      if (title) {
        els.titleInput.value = title;
      }
    }

    return {
      url,
      title: title || titleFromUrl(url),
      description: els.descriptionInput.value.trim(),
      status: els.statusInput.value === "read" ? "read" : "unread",
      arxivId,
    };
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

  async function handleListClick(event) {
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
      await updatePaper(paper.id, {
        ...paper,
        status: paper.status === "read" ? "unread" : "read",
      });
      return;
    }

    if (button.dataset.action === "edit") {
      startEdit(paper);
      return;
    }

    if (button.dataset.action === "delete" && confirm(`Delete "${paper.title}"?`)) {
      await deletePaper(paper.id);
    }
  }

  async function updatePaper(id, payload) {
    try {
      setLoading(true);
      const response = await apiRequest(`/papers/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: payload,
      });
      const paper = normalizePaper(response.paper);
      if (paper) {
        state.papers = state.papers.map((item) => (item.id === id ? paper : item));
        render();
      }
      updateSyncMessage("Synced.");
    } catch (error) {
      setMessage(els.formMessage, error.message || "Update failed.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function deletePaper(id) {
    try {
      setLoading(true);
      await apiRequest(`/papers/${encodeURIComponent(id)}`, { method: "DELETE" });
      state.papers = state.papers.filter((item) => item.id !== id);
      render();
      updateSyncMessage("Synced.");
    } catch (error) {
      setMessage(els.formMessage, error.message || "Delete failed.", "error");
    } finally {
      setLoading(false);
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
    els.emptyState.textContent = state.loading ? "Loading papers..." : state.papers.length ? "No matching papers." : "No papers yet.";
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

  function createId() {
    if (crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `paper-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      setLoading(true);
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = Array.isArray(parsed) ? parsed : parsed.papers;
      if (!Array.isArray(incoming)) {
        throw new Error("Invalid import file");
      }

      const response = await apiRequest("/papers/import", {
        method: "POST",
        body: { papers: incoming },
      });
      state.papers = Array.isArray(response.papers) ? response.papers.map(normalizePaper).filter(Boolean) : [];
      render();
      setMessage(els.formMessage, `Imported ${response.imported || 0} papers.`, "success");
      updateSyncMessage("Synced.");
    } catch (error) {
      setMessage(els.formMessage, error.message || "Import failed.", "error");
    } finally {
      setLoading(false);
      els.importInput.value = "";
    }
  }

  async function apiRequest(path, options = {}) {
    ensureApiConfigured();

    const headers = {
      Accept: "application/json",
      ...(options.headers || {}),
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (options.auth !== false) {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        throw new Error("Missing token");
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }

    if (!response.ok) {
      if (response.status === 401) {
        clearToken();
      }
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
  }

  function ensureApiConfigured() {
    if (!API_BASE || API_BASE.includes("REPLACE_WITH_YOUR_WORKERS_SUBDOMAIN")) {
      throw new Error("Please set readpaper/api-config.js to your Worker URL.");
    }
  }

  function hasValidToken() {
    const token = localStorage.getItem(TOKEN_KEY);
    const expiresAt = Number(localStorage.getItem(TOKEN_EXPIRES_KEY) || 0);
    return Boolean(token && expiresAt && expiresAt > Math.floor(Date.now() / 1000) + 30);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRES_KEY);
  }

  function setLoading(loading) {
    state.loading = loading;
    [
      els.submitPaperButton,
      els.fetchTitleButton,
      els.importButton,
      els.exportButton,
      ...$$(".paper-actions .button"),
    ].forEach((button) => {
      if (button) {
        button.disabled = loading;
      }
    });
  }

  function updateSyncMessage(text, isError = false) {
    if (!els.syncMessage || !els.syncBanner) {
      return;
    }
    els.syncMessage.textContent = text;
    els.syncBanner.classList.toggle("is-error", isError);
  }

  function setMessage(element, text, type) {
    element.textContent = text;
    element.classList.toggle("is-error", type === "error");
    element.classList.toggle("is-success", type === "success");
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
})();
