const test = require('node:test');
const assert = require('node:assert');
const { isValidCpf } = require('./cpf');

// CPFs below are synthetic: check digits computed with the algorithm from made-up bases.

test('accepts a valid unmasked CPF', () => {
  assert.strictEqual(isValidCpf('12345678909'), true);
});

test('accepts another valid unmasked CPF', () => {
  assert.strictEqual(isValidCpf('11144477735'), true);
});

test('accepts a valid masked CPF', () => {
  assert.strictEqual(isValidCpf('111.444.777-35'), true);
});

test('rejects a wrong check digit', () => {
  assert.strictEqual(isValidCpf('12345678900'), false);
  assert.strictEqual(isValidCpf('111.444.777-34'), false);
});

test('rejects repeated digits', () => {
  assert.strictEqual(isValidCpf('111.111.111-11'), false);
  assert.strictEqual(isValidCpf('00000000000'), false);
});

test('rejects wrong lengths', () => {
  assert.strictEqual(isValidCpf('1234567890'), false);
  assert.strictEqual(isValidCpf('123456789099'), false);
  assert.strictEqual(isValidCpf(''), false);
});

test('rejects non-string and malformed input', () => {
  assert.strictEqual(isValidCpf(12345678909), false);
  assert.strictEqual(isValidCpf(null), false);
  assert.strictEqual(isValidCpf('123.456.789.09'), false);
});
