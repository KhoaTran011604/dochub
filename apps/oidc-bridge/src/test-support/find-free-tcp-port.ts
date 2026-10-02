import { createServer } from "node:net";

/** Port loopback còn trống (issuer của bridge phải biết port trước khi listen). */
export function findFreeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        resolve(typeof address === "object" && address ? address.port : 0),
      );
    });
  });
}
