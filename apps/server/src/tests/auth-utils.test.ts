import test from "node:test";
import assert from "node:assert/strict";
import { authenticator } from "otplib";
import {
  decodeEncryptedPayload,
  decryptAes256Gcm,
  encodeEncryptedPayload,
  encryptAes256Gcm
} from "../lib/auth/crypto.js";
import { generateTotpSecret, verifyTotp } from "../lib/auth/totp.js";

test("AES-256-GCM encrypt/decrypt roundtrip", () => {
  const key = Buffer.alloc(32, 7);
  const plaintext = "totp-secret-example";

  const encrypted = encryptAes256Gcm(plaintext, key);
  const encoded = encodeEncryptedPayload(encrypted);
  const decoded = decodeEncryptedPayload(encoded);

  assert.ok(decoded);
  const restored = decryptAes256Gcm(decoded, key);
  assert.equal(restored, plaintext);
});

test("TOTP verifies generated token", () => {
  const secret = generateTotpSecret();
  const token = authenticator.generate(secret);

  assert.equal(verifyTotp({ token, secret }), true);
});

