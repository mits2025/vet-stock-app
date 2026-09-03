import { hashes, sign } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

hashes.sha512 = sha512;

const LICENSE_PREFIX = "SFP1";
const LICENSE_PRODUCT = "stockflow-pos";
const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export default {
  async fetch(request, env, context) {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      if (request.method === "GET" && url.pathname === "/") return htmlResponse(publicPage(env));
      if (request.method === "GET" && url.pathname === "/admin") return htmlResponse(adminPage(env));
      if (request.method === "GET" && url.pathname === "/api/config") {
        return jsonResponse({
          providerName: env.PROVIDER_NAME || "Vet POS",
          gcashAccountName: env.GCASH_ACCOUNT_NAME || "",
          gcashNumber: env.GCASH_NUMBER || "",
          gcashQrUrl: new URL("/gcash-qr.png", request.url).href,
          messageUrl: env.MESSAGE_URL || "",
          plans: planCatalog(env),
        }, 200, request, env);
      }
      if (request.method === "POST" && url.pathname === "/api/payment-requests") {
        await enforceRateLimit(request, env, "payment-submit", 5, 600);
        return createPaymentRequest(request, env);
      }
      const statusMatch = url.pathname.match(/^\/api\/payment-requests\/([^/]+)\/status$/);
      if (request.method === "GET" && statusMatch) {
        await enforceRateLimit(request, env, "payment-status", 60, 600);
        return paymentRequestStatus(request, env, statusMatch[1]);
      }
      if (request.method === "GET" && url.pathname === "/api/admin/payment-requests") {
        await requireAdmin(request, env);
        return listPaymentRequests(request, env);
      }
      const approveMatch = url.pathname.match(/^\/api\/admin\/payment-requests\/([^/]+)\/approve$/);
      if (request.method === "POST" && approveMatch) {
        await requireAdmin(request, env);
        return approvePaymentRequest(request, env, approveMatch[1]);
      }
      const rejectMatch = url.pathname.match(/^\/api\/admin\/payment-requests\/([^/]+)\/reject$/);
      if (request.method === "POST" && rejectMatch) {
        await requireAdmin(request, env);
        return rejectPaymentRequest(request, env, rejectMatch[1]);
      }
      return jsonResponse({ message: "Not found." }, 404, request, env);
    } catch (error) {
      const status = Number(error.status) || 500;
      if (status === 500) console.error(error);
      return jsonResponse({
        message: status === 500 ? "The licensing service could not complete the request." : error.message,
      }, status, request, env);
    } finally {
      if (context?.waitUntil && Math.random() < 0.02) context.waitUntil(cleanupExpiredRecords(env));
    }
  },
  async scheduled(_event, env, context) {
    context.waitUntil(cleanupExpiredRecords(env));
  },
};

async function createPaymentRequest(request, env) {
  const body = await readJson(request);
  await verifyTurnstile(request, env, body.turnstileToken);
  const plans = planCatalog(env);
  const plan = cleanText(body.plan, 40).toLowerCase();
  if (!plans[plan]) throw httpError(400, "Choose a valid subscription plan.");

  const customerName = cleanText(body.customerName, 120);
  const installationId = cleanInstallationId(body.installationId);
  const senderName = cleanText(body.gcashSenderName, 120);
  const gcashReference = cleanReference(body.gcashReference);
  if (!customerName) throw httpError(400, "Clinic or customer name is required.");
  if (!installationId) throw httpError(400, "Installation ID is required.");
  if (!senderName) throw httpError(400, "GCash sender name is required.");
  if (!gcashReference) throw httpError(400, "GCash reference number is required.");

  const id = `payreq_${crypto.randomUUID().replaceAll("-", "")}`;
  const claimToken = randomToken(32);
  const submittedAt = new Date().toISOString();
  try {
    await env.DB.prepare(`
      INSERT INTO payment_requests (
        id, claim_token_hash, customer_name, installation_id, gcash_sender_name,
        gcash_reference, amount_centavos, plan, status, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(
      id,
      await sha256Base64Url(claimToken),
      customerName,
      installationId,
      senderName,
      gcashReference,
      plans[plan].amountCentavos,
      plan,
      submittedAt,
    ).run();
  } catch (error) {
    if (`${error.message || error}`.toLowerCase().includes("unique")) {
      throw httpError(409, "That GCash reference number has already been submitted.");
    }
    throw error;
  }

  await audit(env, id, "submitted", "customer", { plan, amountCentavos: plans[plan].amountCentavos });
  return jsonResponse({
    requestId: id,
    claimToken,
    status: "pending",
    plan,
    amountCentavos: plans[plan].amountCentavos,
    submittedAt,
  }, 201, request, env);
}

async function paymentRequestStatus(request, env, id) {
  const claimToken = bearerToken(request);
  if (!claimToken) throw httpError(401, "The payment request claim token is required.");
  const record = await env.DB.prepare("SELECT * FROM payment_requests WHERE id = ?").bind(id).first();
  if (!record || !constantTimeEqual(await sha256Base64Url(claimToken), record.claim_token_hash)) {
    throw httpError(404, "Payment request not found.");
  }
  return jsonResponse(publicPaymentRequest(record), 200, request, env);
}

async function listPaymentRequests(request, env) {
  const status = new URL(request.url).searchParams.get("status") || "pending";
  const query = status === "all"
    ? env.DB.prepare("SELECT * FROM payment_requests ORDER BY submitted_at DESC LIMIT 200")
    : env.DB.prepare("SELECT * FROM payment_requests WHERE status = ? ORDER BY submitted_at DESC LIMIT 200").bind(status);
  const result = await query.all();
  return jsonResponse({ items: (result.results || []).map(adminPaymentRequest) }, 200, request, env);
}

async function approvePaymentRequest(request, env, id) {
  const body = await readJson(request);
  let record = await env.DB.prepare("SELECT * FROM payment_requests WHERE id = ?").bind(id).first();
  if (!record) throw httpError(404, "Payment request not found.");
  if (record.status === "approved" && record.license_token) {
    return jsonResponse(adminPaymentRequest(record), 200, request, env);
  }
  if (record.status !== "pending") throw httpError(409, "Only pending payment requests can be approved.");
  if (!env.LICENSE_SIGNING_PRIVATE_KEY_HEX) throw httpError(503, "License signing is not configured.");
  const lockToken = await acquireReviewLock(env, record.installation_id);

  try {
    record = await env.DB.prepare("SELECT * FROM payment_requests WHERE id = ?").bind(id).first();
    if (record.status === "approved" && record.license_token) return jsonResponse(adminPaymentRequest(record), 200, request, env);
    if (record.status !== "pending") throw httpError(409, "Only pending payment requests can be approved.");
    const previous = await env.DB.prepare(`
      SELECT license_expires_at FROM payment_requests
      WHERE installation_id = ? AND status = 'approved' AND id <> ?
        AND license_expires_at IS NOT NULL
      ORDER BY license_expires_at DESC LIMIT 1
    `).bind(record.installation_id, id).first();
    const expiresAt = resolveExpiry(body.expiresAt, previous?.license_expires_at, licenseDays(env));
    const reviewedBy = cleanText(body.reviewedBy, 100) || "Administrator";
    const reviewedAt = new Date().toISOString();
    const token = issueLicenseToken({
      installationId: record.installation_id,
      customerName: record.customer_name,
      expiresAt,
      paymentRequestId: record.id,
      plan: record.plan,
      issuedAt: reviewedAt.slice(0, 10),
    }, env.LICENSE_SIGNING_PRIVATE_KEY_HEX);

    const update = await env.DB.prepare(`
      UPDATE payment_requests
      SET status = 'approved', reviewed_at = ?, reviewed_by = ?, rejection_reason = NULL,
          license_token = ?, license_expires_at = ?
      WHERE id = ? AND status = 'pending'
    `).bind(reviewedAt, reviewedBy, token, expiresAt, id).run();
    if (!update.meta?.changes) throw httpError(409, "This request was already reviewed.");
    await audit(env, id, "approved", reviewedBy, { expiresAt });
    const updated = await env.DB.prepare("SELECT * FROM payment_requests WHERE id = ?").bind(id).first();
    return jsonResponse(adminPaymentRequest(updated), 200, request, env);
  } finally {
    await releaseReviewLock(env, record.installation_id, lockToken);
  }
}

async function acquireReviewLock(env, installationId) {
  const now = new Date().toISOString();
  await env.DB.prepare("DELETE FROM review_locks WHERE installation_id = ? AND expires_at < ?").bind(installationId, now).run();
  const token = randomToken(18);
  try {
    await env.DB.prepare("INSERT INTO review_locks (installation_id, lock_token, expires_at) VALUES (?, ?, ?)")
      .bind(installationId, token, new Date(Date.now() + 30000).toISOString()).run();
    return token;
  } catch {
    throw httpError(409, "Another review for this installation is already in progress.");
  }
}

async function releaseReviewLock(env, installationId, token) {
  await env.DB.prepare("DELETE FROM review_locks WHERE installation_id = ? AND lock_token = ?").bind(installationId, token).run();
}

async function rejectPaymentRequest(request, env, id) {
  const body = await readJson(request);
  const record = await env.DB.prepare("SELECT * FROM payment_requests WHERE id = ?").bind(id).first();
  if (!record) throw httpError(404, "Payment request not found.");
  if (record.status !== "pending") throw httpError(409, "Only pending payment requests can be rejected.");
  const reason = cleanText(body.reason, 300) || "Payment could not be verified.";
  const reviewedBy = cleanText(body.reviewedBy, 100) || "Administrator";
  const reviewedAt = new Date().toISOString();
  const update = await env.DB.prepare(`
    UPDATE payment_requests
    SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, rejection_reason = ?
    WHERE id = ? AND status = 'pending'
  `).bind(reviewedAt, reviewedBy, reason, id).run();
  if (!update.meta?.changes) throw httpError(409, "This request was already reviewed.");
  await audit(env, id, "rejected", reviewedBy, { reason });
  const updated = await env.DB.prepare("SELECT * FROM payment_requests WHERE id = ?").bind(id).first();
  return jsonResponse(adminPaymentRequest(updated), 200, request, env);
}

export function issueLicenseToken(details, privateKeyHex) {
  const privateKey = hexToBytes(privateKeyHex);
  if (privateKey.length !== 32) throw new Error("The license signing key must be 32 bytes.");
  const payload = {
    v: 1,
    product: LICENSE_PRODUCT,
    licenseId: crypto.randomUUID(),
    installationId: details.installationId,
    customer: details.customerName,
    issuedAt: details.issuedAt,
    expiresAt: details.expiresAt,
    paymentRequestId: details.paymentRequestId,
    plan: details.plan,
  };
  const payloadPart = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${LICENSE_PREFIX}.${payloadPart}`;
  const signature = sign(new TextEncoder().encode(signingInput), privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

function planCatalog(env) {
  return {
    standard: {
      label: env.PLAN_LABEL || "Vet POS license (45 days)",
      amountCentavos: positiveInteger(env.PLAN_PRICE_CENTAVOS, 50000),
    },
  };
}

function licenseDays(env) {
  return positiveInteger(env.LICENSE_DAYS, 45);
}

function resolveExpiry(explicitValue, previousValue, days) {
  const today = utcDateString(new Date());
  if (explicitValue) {
    const explicit = cleanDate(explicitValue);
    if (!explicit || explicit <= today) throw httpError(400, "Choose a future license expiration date.");
    return explicit;
  }

  const now = new Date(`${today}T00:00:00Z`);
  const previous = cleanDate(previousValue);
  const graceStart = new Date(now);
  graceStart.setUTCDate(graceStart.getUTCDate() - 15);
  const previousDate = previous ? new Date(`${previous}T00:00:00Z`) : null;
  const base = previousDate && previousDate >= graceStart ? previousDate : now;
  const expiry = new Date(base);
  expiry.setUTCDate(expiry.getUTCDate() + days);
  return utcDateString(expiry);
}

function publicPaymentRequest(record) {
  return {
    requestId: record.id,
    customerName: record.customer_name,
    status: record.status,
    plan: record.plan,
    amountCentavos: record.amount_centavos,
    submittedAt: record.submitted_at,
    reviewedAt: record.reviewed_at,
    rejectionReason: record.rejection_reason,
    licenseToken: record.status === "approved" ? record.license_token : undefined,
    licenseExpiresAt: record.license_expires_at,
  };
}

function adminPaymentRequest(record) {
  return {
    ...publicPaymentRequest(record),
    installationId: record.installation_id,
    gcashSenderName: record.gcash_sender_name,
    gcashReference: record.gcash_reference,
    reviewedBy: record.reviewed_by,
  };
}

async function audit(env, paymentRequestId, eventType, actor, detail = {}) {
  await env.DB.prepare(`
    INSERT INTO audit_events (id, payment_request_id, event_type, actor, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    `audit_${crypto.randomUUID().replaceAll("-", "")}`,
    paymentRequestId,
    eventType,
    actor,
    JSON.stringify(detail),
    new Date().toISOString(),
  ).run();
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_API_KEY) throw httpError(503, "Administrator access is not configured.");
  await enforceRateLimit(request, env, "admin-auth", 10, 600);
  if (!constantTimeEqual(bearerToken(request), env.ADMIN_API_KEY)) {
    await securityAudit(request, env, "admin-auth-failed", {});
    throw httpError(401, "Administrator authorization failed.");
  }
}

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 16384) throw httpError(413, "The request is too large.");
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > 16384) throw httpError(413, "The request is too large.");
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error?.status === 413 || length > 16384) throw httpError(413, "The request is too large.");
    throw httpError(400, "A valid JSON request body is required.");
  }
}

async function enforceRateLimit(request, env, scope, limit, windowSeconds) {
  const source = request.headers.get("CF-Connecting-IP") || "unknown";
  const sourceHash = await sha256Base64Url(`${env.RATE_LIMIT_SALT || "vet-pos"}:${source}`);
  const bucketStart = Math.floor(Date.now() / (windowSeconds * 1000));
  const bucketKey = `${scope}:${sourceHash}:${bucketStart}`;
  const expiresAt = new Date((bucketStart + 1) * windowSeconds * 1000).toISOString();
  const result = await env.DB.prepare(`
    INSERT INTO request_rate_limits (bucket_key, request_count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET request_count = request_count + 1
    RETURNING request_count
  `).bind(bucketKey, expiresAt).first();
  if (Number(result?.request_count) > limit) {
    await securityAudit(request, env, "rate-limit-exceeded", { scope });
    const error = httpError(429, "Too many requests. Please wait before trying again.");
    error.retryAfter = windowSeconds;
    throw error;
  }
}

async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET_KEY) return;
  if (!token) throw httpError(400, "Complete the security check before submitting payment.");
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", `${token}`);
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) form.set("remoteip", remoteIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await response.json();
  if (!result.success) {
    await securityAudit(request, env, "turnstile-failed", { codes: result["error-codes"] || [] });
    throw httpError(403, "The security check could not be verified.");
  }
}

async function securityAudit(request, env, eventType, detail) {
  const source = request.headers.get("CF-Connecting-IP") || "unknown";
  const sourceHash = await sha256Base64Url(`${env.RATE_LIMIT_SALT || "vet-pos"}:${source}`);
  await env.DB.prepare(`
    INSERT INTO security_events (id, event_type, source_hash, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    `security_${crypto.randomUUID().replaceAll("-", "")}`,
    eventType,
    sourceHash,
    JSON.stringify(detail || {}),
    new Date().toISOString(),
  ).run();
}

async function cleanupExpiredRecords(env) {
  const now = new Date().toISOString();
  const stalePending = new Date(Date.now() - positiveInteger(env.PAYMENT_REQUEST_TTL_HOURS, 168) * 3600000).toISOString();
  const oldSecurityEvents = new Date(Date.now() - 90 * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM request_rate_limits WHERE expires_at < ?").bind(now),
    env.DB.prepare("UPDATE payment_requests SET status = 'expired' WHERE status = 'pending' AND submitted_at < ?").bind(stalePending),
    env.DB.prepare("DELETE FROM security_events WHERE created_at < ?").bind(oldSecurityEvents),
    env.DB.prepare("DELETE FROM review_locks WHERE expires_at < ?").bind(now),
  ]);
}

function cleanText(value, maxLength) {
  return `${value || ""}`.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanInstallationId(value) {
  const cleaned = cleanText(value, 160);
  return /^[a-zA-Z0-9-]{8,160}$/.test(cleaned) ? cleaned : "";
}

function cleanReference(value) {
  return `${value || ""}`.trim().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 80);
}

function cleanDate(value) {
  const cleaned = `${value || ""}`.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : "";
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

function randomToken(byteLength) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256Base64Url(value) {
  const bytes = new TextEncoder().encode(value);
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function constantTimeEqual(left = "", right = "") {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function hexToBytes(value) {
  const clean = `${value || ""}`.trim().replace(/[^a-fA-F0-9]/g, "");
  if (clean.length % 2) return new Uint8Array();
  return Uint8Array.from(clean.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) || []);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const configured = `${env.ALLOWED_ORIGINS || ""}`.split(",").map((item) => item.trim()).filter(Boolean);
  const allowedOrigin = origin === "null" || configured.includes(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function jsonResponse(payload, status, request, env) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...jsonHeaders, ...corsHeaders(request, env) },
  });
}

function htmlResponse(html) {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function publicPage(env) {
  const plan = planCatalog(env).standard;
  return pageShell("Vet POS GCash licensing", `
    <main><h1>Vet POS licensing</h1>
    <p>Submit your payment from the Vet POS activation or renewal screen.</p>
    <section><h2>GCash payment</h2>
      <a class="qr-link" href="/gcash-qr.png" target="_blank" rel="noopener"><img class="gcash-qr" src="/gcash-qr.png" alt="Official GCash payment QR code"></a>
      <p><b>Account:</b> ${escapeHtml(env.GCASH_ACCOUNT_NAME || "Not configured")}</p>
      <p><b>Number:</b> ${escapeHtml(env.GCASH_NUMBER || "Not configured")}</p>
      <p><b>${escapeHtml(plan.label)}:</b> ${formatMoney(plan.amountCentavos)}</p>
      ${env.MESSAGE_URL ? `<a class="message-provider" href="${escapeHtml(env.MESSAGE_URL)}" target="_blank" rel="noopener">Send receipt to provider</a>` : ""}
    </section></main>`);
}

function adminPage(env) {
  return pageShell(`${escapeHtml(env.PROVIDER_NAME || "Vet POS")} payment review`, `
    <main><h1>GCash payment review</h1>
    <div class="toolbar"><input id="key" type="password" placeholder="Administrator API key"><button onclick="loadItems()">Load pending</button></div>
    <p id="message"></p><div id="items"></div></main>
    <script>
      const money=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(value/100);
      async function api(path,options={}){const key=document.getElementById('key').value;const response=await fetch(path,{...options,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...(options.headers||{})}});const body=await response.json();if(!response.ok)throw new Error(body.message||'Request failed');return body}
      async function loadItems(){const box=document.getElementById('items'),message=document.getElementById('message');try{const {items}=await api('/api/admin/payment-requests?status=pending');message.textContent=items.length?items.length+' pending request(s)':'No pending requests.';box.innerHTML=items.map(item=>\`<article><h2>\${esc(item.customerName)}</h2><p><b>\${money(item.amountCentavos)}</b> · \${esc(item.plan)}</p><p>Sender: \${esc(item.gcashSenderName)}<br>Reference: <code>\${esc(item.gcashReference)}</code><br>Installation: <code>\${esc(item.installationId)}</code><br>Submitted: \${new Date(item.submittedAt).toLocaleString()}</p><div><button onclick="approve('\${item.requestId}')">Approve</button><button class="reject" onclick="rejectItem('\${item.requestId}')">Reject</button></div></article>\`).join('')}catch(error){message.textContent=error.message}}
      async function approve(id){const reviewedBy=prompt('Reviewed by:','Administrator');if(reviewedBy===null)return;const expiresAt=prompt('Optional expiry (YYYY-MM-DD). Leave blank for the default:','');try{await api('/api/admin/payment-requests/'+id+'/approve',{method:'POST',body:JSON.stringify({reviewedBy,expiresAt:expiresAt||undefined})});loadItems()}catch(error){alert(error.message)}}
      async function rejectItem(id){const reason=prompt('Reason for rejection:','Payment could not be verified.');if(reason===null)return;try{await api('/api/admin/payment-requests/'+id+'/reject',{method:'POST',body:JSON.stringify({reason})});loadItems()}catch(error){alert(error.message)}}
      function esc(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
    </script>`);
}

function pageShell(title, content) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0;background:#f4f7fb;color:#172b3a;font:15px system-ui}main{max-width:760px;margin:40px auto;padding:24px}section,article{background:#fff;border:1px solid #d7e1e8;border-radius:14px;padding:18px;margin:14px 0}h1,h2{margin-top:0}.toolbar{display:flex;gap:8px}.toolbar input{flex:1}input,button{min-height:40px;border:1px solid #aebfca;border-radius:8px;padding:0 12px}button,.message-provider{background:#137d72;color:#fff;font-weight:800;cursor:pointer}.reject{background:#9f1f1f;margin-left:8px}code{overflow-wrap:anywhere}.qr-link{display:block;width:min(320px,100%);margin:14px auto}.gcash-qr{display:block;width:100%;height:auto;border-radius:14px}.message-provider{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:9px;text-decoration:none}</style></head><body>${content}</body></html>`;
}

function escapeHtml(value) {
  return `${value}`.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function formatMoney(centavos) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(centavos / 100);
}
