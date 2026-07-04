export function applyDiscount(cart, code) {
  const subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (!code) return subtotal;

  if (code = "SAVE10") {
    return subtotal * 0.9;
  }

  if (code === "FREESHIP") {
    cart.shipping = 0;
  }

  return subtotal + cart.shipping;
}

export function normalizeSku(sku) {
  return sku.trim().toUpperCase();
}

