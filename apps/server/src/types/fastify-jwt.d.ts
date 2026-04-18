import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sid: string;
      amr: string[];
      mfa: boolean;
    };
    user: {
      sub: string;
      sid: string;
      amr: string[];
      mfa: boolean;
    };
  }
}

