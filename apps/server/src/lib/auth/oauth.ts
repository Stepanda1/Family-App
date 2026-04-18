import { createRemoteJWKSet, jwtVerify } from "jose";

type VerifiedIdToken = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
};

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const appleJwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export async function verifyGoogleIdToken(idToken: string, audience: string): Promise<VerifiedIdToken> {
  const { payload } = await jwtVerify(idToken, googleJwks, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience
  });

  const email = typeof payload.email === "string" ? payload.email : null;
  const emailVerified = payload.email_verified === true;
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  const name = typeof payload.name === "string" ? payload.name : undefined;

  if (!email || !sub) {
    throw new Error("Invalid Google id_token payload.");
  }

  return { sub, email, emailVerified, name };
}

export async function verifyAppleIdToken(idToken: string, audience: string): Promise<VerifiedIdToken> {
  const { payload } = await jwtVerify(idToken, appleJwks, {
    issuer: "https://appleid.apple.com",
    audience
  });

  const email = typeof payload.email === "string" ? payload.email : null;
  const emailVerified = payload.email_verified === true;
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  const name = typeof payload.name === "string" ? payload.name : undefined;

  if (!email || !sub) {
    throw new Error("Invalid Apple id_token payload.");
  }

  return { sub, email, emailVerified, name };
}

