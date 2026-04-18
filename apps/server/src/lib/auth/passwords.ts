import { hash, verify } from "@node-rs/argon2";

export async function hashPassword(password: string) {
  return hash(password, {
    algorithm: 2, // argon2id
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });
}

export async function verifyPassword(hashValue: string, password: string) {
  return verify(hashValue, password);
}

