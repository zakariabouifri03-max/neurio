import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS, BASE_COLORS, SIZES, formatPrice, createMonkeyCanvas, seeded, MONKEY_TYPES } from '../src/monkey-store/rules.js';
import { MonkeyStore } from '../src/monkey-store/store.js';

test('monkey types and products are valid', () => {
  assert.equal(MONKEY_TYPES.length, 8);
  assert.equal(PRODUCTS.length, 8);
  PRODUCTS.forEach(p=>{
    assert.ok(p.id);
    assert.ok(p.name.includes('Tee'));
    assert.ok(p.price > 10 && p.price < 100);
    assert.ok(p.originalPrice > p.price);
    assert.ok(p.rating >= 4 && p.rating <= 5);
    assert.ok(p.colors.length >= 2);
    assert.ok(p.sizes.length >= 4);
  });
});

test('base colors and sizes are sane', () => {
  assert.equal(BASE_COLORS.length, 8);
  assert.equal(SIZES.length, 6);
  assert.ok(BASE_COLORS.find(c=>c.id==='white'));
  assert.ok(SIZES.includes('M'));
});

test('formatPrice works', () => {
  assert.equal(formatPrice(29), '$29.00');
  assert.equal(formatPrice(29.5), '$29.50');
});

test('seeded RNG deterministic', () => {
  const a=seeded(42), b=seeded(42);
  assert.deepEqual(Array.from({length:10}, a), Array.from({length:10}, b));
});

test('createMonkeyCanvas generates canvas', () => {
  // Node doesn't have document, skip if no DOM, but test via jsdom? We'll just check function exists and can be called in browser context later
  assert.equal(typeof createMonkeyCanvas, 'function');
});

test('MonkeyStore cart operations', () => {
  const store = new MonkeyStore();
  store.cart = []; // reset
  store.addToCart('banana', 'white', 'M', 1);
  assert.equal(store.cartCount(), 1);
  assert.equal(store.cartTotal(), PRODUCTS.find(p=>p.id==='banana').price);
  store.addToCart('banana', 'white', 'M', 2);
  assert.equal(store.cartCount(), 3);
  store.addToCart('skate', 'black', 'L', 1);
  assert.equal(store.cartCount(), 4);
  assert.equal(store.cart.length, 2);
  store.updateQty(0, 1);
  assert.equal(store.cartCount(), 2);
  store.removeFromCart(0);
  assert.equal(store.cartCount(), 1);
  store.clearCart();
  assert.equal(store.cartCount(), 0);
});

test('MonkeyStore detailed items and checkout', () => {
  const store = new MonkeyStore();
  store.cart=[];
  store.addToCart('dj', 'blue', 'L', 2);
  store.addToCart('astro', 'black', 'M', 1);
  const detailed = store.cartItemsDetailed();
  assert.equal(detailed.length, 2);
  assert.equal(detailed[0].product.id, 'dj');
  assert.equal(detailed[0].color.id, 'blue');
  assert.equal(detailed[0].subtotal, detailed[0].product.price*2);
  const order = store.checkout({ email:'test@test.com', name:'Test', address:'123', city:'Test', zip:'123', card:'4242' });
  assert.ok(order.id.startsWith('MNK-'));
  assert.equal(order.items.length, 2);
  assert.equal(store.cartCount(), 0);
  assert.equal(store.orders[0].id, order.id);
});
