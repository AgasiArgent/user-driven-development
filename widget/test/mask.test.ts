import { describe, expect, it } from "vitest";
import { applyMask } from "../src/mask";

describe("applyMask", () => {
  it("covers elements marked data-feedback-mask and every password input", () => {
    document.body.innerHTML = `
      <p id="email" data-feedback-mask>alice@example.com</p>
      <input id="pw" type="password" value="hunter2">
      <p id="plain">visible</p>`;
    applyMask(document);
    for (const id of ["email", "pw"]) {
      const el = document.getElementById(id)!;
      expect(el.style.backgroundColor).toBe("rgb(0, 0, 0)");
      expect(el.style.color).toBe("transparent");
    }
    expect(document.getElementById("plain")!.style.backgroundColor).toBe("");
  });
});
