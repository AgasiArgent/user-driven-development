import { describe, expect, it } from "vitest";
import { describeTarget } from "../src/target";

describe("describeTarget", () => {
  it("returns a selector that finds the same element, its tag and trimmed text", () => {
    document.body.innerHTML = `<main><form><button class="primary">  Book   this room  </button></form></main>`;
    const button = document.querySelector("button")!;
    const t = describeTarget(button);
    expect(document.querySelector(t.selector)).toBe(button);
    expect(t.tagName).toBe("button");
    expect(t.text).toBe("Book this room");
  });

  it("cuts element text to 200 characters", () => {
    document.body.innerHTML = `<p id="long">${"word ".repeat(100)}</p>`;
    expect(describeTarget(document.getElementById("long")!).text).toHaveLength(200);
  });
});

describe("describeTarget — masking", () => {
  it("leaves masked content out of the element text", () => {
    document.body.innerHTML = `<div id="row">Customer <span data-feedback-mask>alice@example.com</span> paid</div>`;
    expect(describeTarget(document.getElementById("row")!).text).toBe("Customer paid");
  });

  it("sends no text for an element inside a masked area", () => {
    document.body.innerHTML = `<div data-feedback-mask><b id="b">secret</b></div>`;
    expect(describeTarget(document.getElementById("b")!)).not.toHaveProperty("text");
  });
});
