const HEADER = "OBCRYPT:v1:";
const SALT_LEN = 16;
const IV_LEN = 12;
const PBKDF2_ITERATIONS = 600_000;

const keyCache = new Map<string, CryptoKey>();
let cachedPasswordRef: string | null = null;

export function clearKeyCache() {
  keyCache.clear();
  cachedPasswordRef = null;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  if (password !== cachedPasswordRef) {
    keyCache.clear();
    cachedPasswordRef = password;
  }

  const saltB64 = toBase64(salt.buffer as ArrayBuffer);
  const cached = keyCache.get(saltB64);
  if (cached) return cached;

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password) as any,
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as any, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  keyCache.set(saltB64, key);
  return key;
}

export function isEncrypted(content: string): boolean {
  return content.startsWith(HEADER);
}

export async function encrypt(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt);

  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as any },
    key,
    enc.encode(plaintext) as any
  );

  return HEADER + toBase64(salt.buffer as ArrayBuffer) + ":" + toBase64(iv.buffer as ArrayBuffer) + ":" + toBase64(cipherBuf);
}

export async function decrypt(blob: string, password: string): Promise<string> {
  if (!isEncrypted(blob)) {
    throw new Error("Content is not encrypted");
  }

  const payload = blob.slice(HEADER.length);
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted content");
  }

  const salt = fromBase64(parts[0]);
  const iv = fromBase64(parts[1]);
  const ciphertext = fromBase64(parts[2]);

  const key = await deriveKey(password, salt);

  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as any },
    key,
    ciphertext as any
  );

  return new TextDecoder().decode(plainBuf);
}
