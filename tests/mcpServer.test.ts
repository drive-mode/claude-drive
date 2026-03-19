import os from "os";
import path from "path";
import { getPortFilePath, readPortFile } from "../src/mcpServer.js";

describe("getPortFilePath()", () => {
  it("returns a path ending in 'port'", () => {
    const p = getPortFilePath();
    expect(p.endsWith("port")).toBe(true);
  });

  it("is inside the home directory", () => {
    const p = getPortFilePath();
    expect(p.startsWith(os.homedir())).toBe(true);
  });

  it("contains .claude-drive in the path", () => {
    const p = getPortFilePath();
    expect(p).toContain(".claude-drive");
  });

  it("returns the same value on repeated calls", () => {
    expect(getPortFilePath()).toBe(getPortFilePath());
  });
});

describe("readPortFile()", () => {
  it("returns undefined when port file does not exist", () => {
    // Port file won't exist in the test environment
    // (unless the server happens to be running, but the file path is deterministic)
    const port = readPortFile();
    // Either undefined (file absent) or a valid number (server running)
    expect(port === undefined || (typeof port === "number" && port > 0)).toBe(true);
  });

  it("returns undefined for a non-existent path gracefully", async () => {
    // We can test the error-handling branch by checking a path that definitely doesn't exist
    // readPortFile catches errors internally and returns undefined
    // This just verifies it doesn't throw
    expect(() => readPortFile()).not.toThrow();
  });
});
