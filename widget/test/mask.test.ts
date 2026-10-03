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

describe("applyMask — descendants", () => {
  it("hides child elements that set their own color", () => {
    document.body.innerHTML = `<div id="m" data-feedback-mask>Card <a id="link" style="color:red">4111 1111</a><img id="img"></div>`;
    applyMask(document);
    expect(document.getElementById("link")!.style.visibility).toBe("hidden");
    expect(document.getElementById("img")!.style.visibility).toBe("hidden");
    expect(document.getElementById("m")!.style.visibility).not.toBe("hidden");
  });
});
