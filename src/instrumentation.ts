export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const [{ restoreGatewayConnections }, { pruneExpiredEvents }] = await Promise.all([
    import("@/lib/gateway-manager"),
    import("@/lib/event-retention"),
  ]);
  setTimeout(() => {
    pruneExpiredEvents();
    void restoreGatewayConnections();
  }, 250);
}
