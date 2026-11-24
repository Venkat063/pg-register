// Long-running server entry point for Docker / Kubernetes.
//
// On Vercel the same Express app (frontend/api/_lib/app.js) runs as a serverless
// function, so that file has no app.listen(). In a container we need a real
// process that listens on a port — that's all this file adds.
import Layer from "express/lib/router/layer.js";

// Express 4 does not catch errors from async route handlers. On Vercel a failed
// request only affects itself, but in a long-running container an unhandled
// rejection would crash the whole process. This forwards rejected promises to
// Express's error handling instead (same idea as the "express-async-errors"
// package, without adding a dependency). Upgrading to Express 5 makes it
// unnecessary.
const originalHandle = Layer.prototype.handle_request;
Layer.prototype.handle_request = function handleRequest(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return originalHandle.call(this, req, res, next); // error-handling middleware
  try {
    const result = fn(req, res, next);
    if (result && typeof result.catch === "function") result.catch(next);
  } catch (err) {
    next(err);
  }
};

const { default: app } = await import("./api/_lib/app.js");

// Registered last, so it catches errors from every route above.
app.use((err, req, res, next) => {
  console.error("Request failed:", req.method, req.originalUrl, "-", err?.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = Number(process.env.PORT) || 4000;
const server = app.listen(PORT, "0.0.0.0", () => console.log(`API listening on port ${PORT}`));

// Kubernetes sends SIGTERM when it stops a pod (every deploy). Stop accepting new
// connections, let in-flight requests finish, then exit — so a rolling update
// doesn't drop requests.
function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref(); // force-exit if something hangs
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
