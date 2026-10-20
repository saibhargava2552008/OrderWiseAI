import * as path from "node:path";
import express, { type Express } from "express";

/**
 * Serves the plain HTML/CSS/JS frontend from ./public during local development.
 *
 * On Vercel, files in public/ are served by the CDN and express.static() is
 * ignored, so calling this there is harmless.
 *
 * Call it after app.use(helmet()) and before any catch-all 404 or error handler.
 * Files are resolved from the project root (where `npm run dev` runs), so the
 * frontend does not depend on whether the compiled server lives in dist/.
 */
export function mountFrontend(app: Express): void {
  const publicDir = path.resolve(process.cwd(), "public");
  const isProduction = process.env.NODE_ENV === "production";

  app.use(
    express.static(publicDir, {
      index: "index.html",
      // Short cache in production; none in development so edits show up on refresh.
      maxAge: isProduction ? "1h" : 0,
    }),
  );
}
