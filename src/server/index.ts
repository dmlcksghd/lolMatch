import { createAppServer } from "./http";

const PORT = Number(process.env.PORT ?? 3000);
const { httpServer } = createAppServer();

httpServer.on("error", (err) => {
  console.error("[server] listen error", err);
  process.exit(1);
});

httpServer.listen(PORT, () => {
  console.log(`LOLMatch listening on http://localhost:${PORT}`);
});
