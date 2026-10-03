import { describe, expect, it, vi } from "vitest";
import { captureScreenshot } from "../src/screenshot";

function fakeCanvas(dataUrlLength: number) {
  const canvas = {
    width: 1000,
    height: 800,
    toDataURL: () => "data:image/png;base64," + "A".repeat(dataUrlLength),
  };
  return canvas as unknown as HTMLCanvasElement;
}

describe("captureScreenshot", () => {
  it("returns the PNG data URL when it fits", async () => {
    const url = await captureScreenshot({ render: async () => fakeCanvas(100), timeoutMs: 1000, maxBytes: 1000 });
    expect(url).toMatch(/^data:image\/png;base64,A{100}$/);
  });

  it("gives up after the timeout and resolves to undefined", async () => {
    vi.useFakeTimers();
    const pending = captureScreenshot({ render: () => new Promise(() => {}), timeoutMs: 15000, maxBytes: 1000 });
    await vi.advanceTimersByTimeAsync(15000);
    await expect(pending).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("resolves to undefined when rendering throws", async () => {
    const url = await captureScreenshot({
      render: async () => { throw new Error("tainted canvas"); },
      timeoutMs: 1000,
      maxBytes: 1000,
    });
    expect(url).toBeUndefined();
  });

  it("downscales a too-large image up to three times, then drops it", async () => {
    const shrink = vi.fn((c: HTMLCanvasElement) => fakeCanvas(5000));
    const url = await captureScreenshot({ render: async () => fakeCanvas(5000), timeoutMs: 1000, maxBytes: 1000, shrink });
    expect(shrink).toHaveBeenCalledTimes(3);
    expect(url).toBeUndefined();
  });

  it("keeps the first downscaled version that fits", async () => {
    const shrink = vi.fn(() => fakeCanvas(500));
    const url = await captureScreenshot({ render: async () => fakeCanvas(5000), timeoutMs: 1000, maxBytes: 1000, shrink });
    expect(shrink).toHaveBeenCalledTimes(1);
    expect(url).toMatch(/A{500}$/);
  });
});
