const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

export function randomB64(len = 16) {
  return toB64(crypto.getRandomValues(new Uint8Array(len)));
}

export async function deriveKey(password, saltB64) {
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromB64(saltB64), iterations: 150000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
}

export async function generateDataKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function exportKeyB64(key) {
  return toB64(await crypto.subtle.exportKey("raw", key));
}

export async function importDataKey(rawB64) {
  return crypto.subtle.importKey("raw", fromB64(rawB64), "AES-GCM", true, ["encrypt", "decrypt"]);
}

export async function wrapKey(dk, pk) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey("raw", dk, pk, { name: "AES-GCM", iv });
  return { wrapped: toB64(wrapped), iv: toB64(iv) };
}

export async function unwrapKey(wrappedB64, ivB64, pk) {
  return crypto.subtle.unwrapKey(
    "raw", fromB64(wrappedB64), pk,
    { name: "AES-GCM", iv: fromB64(ivB64) },
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJSON(dk, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dk, enc.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptJSON(dk, payload) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(payload.iv) }, dk, fromB64(payload.ct)
  );
  return JSON.parse(dec.decode(pt));
}
