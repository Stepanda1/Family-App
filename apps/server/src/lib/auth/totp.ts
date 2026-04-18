import { authenticator } from "otplib";

authenticator.options = {
  window: 1
};

export function generateTotpSecret() {
  return authenticator.generateSecret();
}

export function buildOtpAuthUrl(params: { email: string; issuer: string; secret: string }) {
  return authenticator.keyuri(params.email, params.issuer, params.secret);
}

export function verifyTotp(params: { token: string; secret: string }) {
  return authenticator.verify({ token: params.token, secret: params.secret });
}

