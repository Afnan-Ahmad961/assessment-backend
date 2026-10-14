// Mounts every feature router. The app serves this under /api/v1.
import { Router } from "express";

import { appointmentRouter } from "./appointment.routes.js";
import { authRouter } from "./auth.routes.js";
import { availabilityRouter } from "./availability.routes.js";
import { chatRouter } from "./chat.routes.js";
import { healthRouter } from "./health.routes.js";
import { serviceCatalogRouter } from "./service-catalog.routes.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/services", serviceCatalogRouter);
apiRouter.use("/availability", availabilityRouter);
apiRouter.use("/appointments", appointmentRouter);
apiRouter.use("/chat", chatRouter);
