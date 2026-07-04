import { applyDiscount, normalizeSku } from "../src/cart.js";

test("SAVE10 applies ten percent discount", () => {
  const cart = { items: [{ price: 100, quantity: 2 }], shipping: 15 };
  expect(applyDiscount(cart, "SAVE10")).toBe(180);
});

test("unknown code keeps subtotal plus shipping", () => {
  const cart = { items: [{ price: 100, quantity: 1 }], shipping: 15 };
  expect(applyDiscount(cart, "NOPE")).toBe(115);
});

test("normalizeSku tolerates missing sku", () => {
  expect(normalizeSku(null)).toBe("");
});

