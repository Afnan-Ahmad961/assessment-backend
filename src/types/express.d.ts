// Adds app-specific fields to Express's Request type.

declare global {
  namespace Express {
    interface Request {
      /** Set by the requireAuth middleware once the access token is verified. */
      auth?: { userId: string };
    }
  }
}

export {};
