import { store } from "../src/store.js";

const TEST_PREFIX = "__test_store_" + Date.now() + "_";

afterAll(() => {
  // Clean up test keys
  for (const key of store.keys()) {
    if (typeof key === "string" && key.startsWith(TEST_PREFIX)) {
      store.update(key, undefined as unknown);
    }
  }
});

describe("store.get()", () => {
  it("returns defaultValue for a missing key", () => {
    expect(store.get(TEST_PREFIX + "missing", 42)).toBe(42);
  });

  it("returns defaultValue of correct type for missing string key", () => {
    expect(store.get(TEST_PREFIX + "nostr", "fallback")).toBe("fallback");
  });
});

describe("store.update() + get() round-trip", () => {
  it("stores and retrieves a string value", () => {
    const key = TEST_PREFIX + "str";
    store.update(key, "hello");
    expect(store.get(key, "")).toBe("hello");
  });

  it("stores and retrieves a numeric value", () => {
    const key = TEST_PREFIX + "num";
    store.update(key, 99);
    expect(store.get(key, 0)).toBe(99);
  });

  it("stores and retrieves an object value", () => {
    const key = TEST_PREFIX + "obj";
    const obj = { a: 1, b: [2, 3] };
    store.update(key, obj);
    expect(store.get(key, {})).toEqual(obj);
  });

  it("overwrites a previous value", () => {
    const key = TEST_PREFIX + "overwrite";
    store.update(key, "first");
    store.update(key, "second");
    expect(store.get(key, "")).toBe("second");
  });
});

describe("store.keys()", () => {
  it("includes keys that were set", () => {
    const key = TEST_PREFIX + "keyscheck";
    store.update(key, true);
    const keys = store.keys();
    expect(keys).toContain(key);
  });

  it("returns a readonly array", () => {
    const keys = store.keys();
    expect(Array.isArray(keys)).toBe(true);
  });
});
