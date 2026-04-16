/**
 * tests/logger.test.ts — leveled logger seam.
 */
import { jest } from "@jest/globals";
import { logger } from "../src/logger.js";
import { saveConfig } from "../src/config.js";

function captureStderr<T>(fn: () => T): { out: T; stderr: string } {
  const original = process.stderr.write.bind(process.stderr);
  let buf = "";
  (process.stderr as unknown as { write: typeof original }).write = ((chunk: string | Uint8Array) => {
    buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof original;
  try {
    return { out: fn(), stderr: buf };
  } finally {
    (process.stderr as unknown as { write: typeof original }).write = original;
  }
}

describe("logger", () => {
  afterEach(() => {
    saveConfig("log.level", "info");
  });

  test("writes to stderr, not stdout", () => {
    saveConfig("log.level", "info");
    const spyStdout = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { stderr } = captureStderr(() => logger.info("hello world"));
    expect(stderr).toContain("hello world");
    expect(spyStdout).not.toHaveBeenCalled();
    spyStdout.mockRestore();
  });

  test("honours log.level threshold", () => {
    saveConfig("log.level", "warn");
    const { stderr: s1 } = captureStderr(() => {
      logger.debug("hidden");
      logger.info("also hidden");
      logger.warn("visible");
      logger.error("visible too");
    });
    expect(s1).not.toContain("hidden");
    expect(s1).toContain("visible");
    expect(s1).toContain("visible too");
  });

  test("silent level suppresses everything", () => {
    saveConfig("log.level", "silent");
    const { stderr } = captureStderr(() => {
      logger.info("a");
      logger.warn("b");
      logger.error("c");
    });
    expect(stderr).toBe("");
  });

  test("formats Error stacks", () => {
    saveConfig("log.level", "error");
    const err = new Error("boom");
    const { stderr } = captureStderr(() => logger.error(err));
    expect(stderr).toContain("Error: boom");
  });

  test("stringifies objects", () => {
    saveConfig("log.level", "info");
    const { stderr } = captureStderr(() => logger.info("obj", { a: 1, b: [2, 3] }));
    expect(stderr).toContain("obj");
    expect(stderr).toContain('"a":1');
  });

  test("isEnabled reflects current level", () => {
    saveConfig("log.level", "warn");
    expect(logger.isEnabled("debug")).toBe(false);
    expect(logger.isEnabled("info")).toBe(false);
    expect(logger.isEnabled("warn")).toBe(true);
    expect(logger.isEnabled("error")).toBe(true);
  });
});
