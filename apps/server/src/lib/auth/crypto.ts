import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function randomBase64Url(bytes = 32) {
  const raw = randomBytes(bytes);
  return raw
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function constantTimeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function toBase64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64");
}

export type EncryptedPayload = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

export function encryptAes256Gcm(plaintext: string, key: Buffer): EncryptedPayload {
  if (key.length !== 32) {
    throw new Error("MFA encryption key must be 32 bytes (base64 decoded).");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    iv: toBase64Url(iv),
    tag: toBase64Url(tag),
    ciphertext: toBase64Url(ciphertext)
  };
}

export function decryptAes256Gcm(payload: EncryptedPayload, key: Buffer) {
  if (payload.version !== 1) {
    throw new Error("Unsupported encrypted payload version.");
  }
  if (key.length !== 32) {
    throw new Error("MFA encryption key must be 32 bytes (base64 decoded).");
  }

  const iv = fromBase64Url(payload.iv);
  const tag = fromBase64Url(payload.tag);
  const ciphertext = fromBase64Url(payload.ciphertext);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export function encodeEncryptedPayload(payload: EncryptedPayload) {
  return `v${payload.version}.${payload.iv}.${payload.tag}.${payload.ciphertext}`;
}

export function decodeEncryptedPayload(encoded: string): EncryptedPayload | null {
  const parts = encoded.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const versionRaw = parts[0];
  if (!versionRaw.startsWith("v")) {
    return null;
  }

  const version = Number(versionRaw.slice(1));
  if (version !== 1) {
    return null;
  }

  const [_, iv, tag, ciphertext] = parts;
  return { version: 1, iv, tag, ciphertext };
}
