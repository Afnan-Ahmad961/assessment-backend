// /auth routes. Express 5 forwards errors from async handlers to the error handler on its own,
// so handlers are passed in directly with no async wrapper.
import { Router } from "express";

import * as authController from "../controllers/auth.controller.js";
import { authRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import { validate } from "../middleware/validate.js";
import { loginBodySchema, logoutBodySchema, refreshBodySchema, signupBodySchema } from "../schemas/auth.schema.js";

export const authRouter = Router();

authRouter.post("/signup", authRateLimiter, validate({ body: signupBodySchema }), authController.signup);
authRouter.post("/login", authRateLimiter, validate({ body: loginBodySchema }), authController.login);
authRouter.post("/refresh", validate({ body: refreshBodySchema }), authController.refresh);
authRouter.post("/logout", validate({ body: logoutBodySchema }), authController.logout);
authRouter.get("/me", requireAuth, authController.me);
