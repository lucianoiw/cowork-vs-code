const test = require('node:test');
const assert = require('node:assert');
const { sum, multiply, subtract } = require('./sum');

test('sums two positive numbers', () => {
  assert.strictEqual(sum(2, 3), 5);
});

test('sums negative numbers', () => {
  assert.strictEqual(sum(-2, -3), -5);
});

test('sums with zero', () => {
  assert.strictEqual(sum(7, 0), 7);
});

test('multiplies two positive numbers', () => {
  assert.strictEqual(multiply(4, 5), 20);
});

test('multiplies by zero', () => {
  assert.strictEqual(multiply(9, 0), 0);
});

test('subtracts two positive numbers', () => {
  assert.strictEqual(subtract(9, 4), 5);
});

test('subtracts to a negative result', () => {
  assert.strictEqual(subtract(3, 8), -5);
});
