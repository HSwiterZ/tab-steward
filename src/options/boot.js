import { ensureMock } from "../dev/boot.js";

await ensureMock();
await import("./main.js");
