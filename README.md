# cowork-vs-code

Small arithmetic helpers exported by `sum.js` (CommonJS).

```js
const { sum, multiply, subtract } = require('./sum');
```

## sum

`sum(a, b)` returns `a + b`.

```js
sum(2, 3); // 5
```

## multiply

`multiply(a, b)` returns `a * b`.

```js
multiply(2, 3); // 6
```

## subtract

`subtract(a, b)` returns `a - b`.

```js
subtract(5, 3); // 2
```

## Running tests

```sh
node --test
```
