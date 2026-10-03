export interface ScreenshotOptions {
  render: () => Promise<HTMLCanvasElement>;
  timeoutMs: number;
  /** Maximum length of the data URL, in characters. */
  maxBytes: number;
  shrink?: (canvas: HTMLCanvasElement) => HTMLCanvasElement;
}

const MAX_SHRINKS = 3;

function halve(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = canvas.ownerDocument.createElement("canvas");
  out.width = Math.max(1, Math.floor(canvas.width / 2));
  out.height = Math.max(1, Math.floor(canvas.height / 2));
  out.getContext("2d")?.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/**
 * Renders a screenshot as a PNG data URL. Never throws and never waits longer than
 * `timeoutMs`: a report without a screenshot is better than a report that is not sent.
 */
export async function captureScreenshot(opts: ScreenshotOptions): Promise<string | undefined> {
  const shrink = opts.shrink ?? halve;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), opts.timeoutMs);
  });
  const work = (async () => {
    let canvas = await opts.render();
    let url = canvas.toDataURL("image/png");
    for (let i = 0; url.length > opts.maxBytes && i < MAX_SHRINKS; i++) {
      canvas = shrink(canvas);
      url = canvas.toDataURL("image/png");
    }
    return url.length > opts.maxBytes ? undefined : url;
  })().catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
