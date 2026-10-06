'use strict';

/* ==========================================================================
   1. CONSTANTS AND HELPERS
   ========================================================================== */

const MAX_DIGITS = 15;                              // longest number a user can type
const OPERATORS = ['+', '−', '×', '÷'];             // symbols shown on screen
const isOperator = (token) => OPERATORS.includes(token);

/**
 * Turns a raw JavaScript number into a clean string.
 *  - Removes floating-point noise: 0.1 + 0.2 becomes "0.3", not "0.30000000000000004".
 *  - Switches to exponent form for huge or tiny values (e.g. "1.5e20").
 *  - Throws an Error instead of ever returning NaN or Infinity.
 */
function formatNumber(value) {
  if (Number.isNaN(value)) throw new Error('Invalid calculation');
  if (!Number.isFinite(value)) throw new Error('Number too large');

  let rounded = parseFloat(value.toPrecision(12));
  if (Object.is(rounded, -0)) rounded = 0;          // never show "-0"

  const size = Math.abs(rounded);
  if (size !== 0 && (size >= 1e15 || size < 1e-9)) {
    return rounded.toExponential(6).replace(/\.?0+e/, 'e').replace('e+', 'e');
  }
  return String(rounded);
}

/** Removes a dangling "." ("5." -> "5") and turns "-0" into "0". */
function cleanNumber(text) {
  const withoutDot = text.endsWith('.') ? text.slice(0, -1) : text;
  return Number(withoutDot) === 0 ? '0' : withoutDot;
}

/**
 * Calculates a list of tokens such as ["2", "+", "3", "×", "4"] and returns "14".
 * It follows normal precedence: × and ÷ are done BEFORE + and −.
 */
function evaluate(tokens) {
  // Pass 1: resolve every × and ÷, leave + and − for later.
  const reduced = [Number(tokens[0])];
  for (let i = 1; i < tokens.length; i += 2) {
    const operator = tokens[i];
    const right = Number(tokens[i + 1]);

    if (operator === '×' || operator === '÷') {
      const left = reduced.pop();
      if (operator === '÷' && right === 0) throw new Error('Cannot divide by zero');
      reduced.push(operator === '×' ? left * right : left / right);
    } else {
      reduced.push(operator, right);
    }
  }

  // Pass 2: resolve + and − from left to right.
  let result = reduced[0];
  for (let i = 1; i < reduced.length; i += 2) {
    result = reduced[i] === '+' ? result + reduced[i + 1] : result - reduced[i + 1];
  }
  return formatNumber(result);
}

/* ==========================================================================
   2. CALCULATOR STATE (no HTML in here, so it is easy to test)
   ========================================================================== */

class Calculator {
  constructor() { this.clear(); }

  /** AC: put everything back to the starting state. */
  clear() {
    this.tokens = [];            // finished parts of the expression, e.g. ["12", "+", "3", "×"]
    this.current = '0';          // the number being typed ("" while waiting for the next number)
    this.expression = '';        // text shown after "=" (e.g. "2 + 3 =")
    this.justEvaluated = false;  // true right after "=" so the next digit starts fresh
    this.error = '';             // error message, or "" when everything is fine
  }

  /** Shows an error and resets the rest. The next key press starts over. */
  setError(message) {
    this.clear();
    this.error = message;
  }

  /** A digit or decimal after "=" or an error starts a brand-new calculation. */
  startFreshIfNeeded() {
    if (this.error || this.justEvaluated) this.clear();
  }

  inputDigit(digit) {
    this.startFreshIfNeeded();
    if (this.current === '0') this.current = digit;                      // replace leading zero
    else if (this.current === '-0') this.current = '-' + digit;
    else if (this.current.replace(/\D/g, '').length < MAX_DIGITS) this.current += digit;
  }

  inputDecimal() {
    this.startFreshIfNeeded();
    if (this.current === '') this.current = '0.';                        // "." after an operator
    else if (!this.current.includes('.')) this.current += '.';           // only one decimal point
  }

  /** ± : switch the current number between positive and negative. */
  toggleSign() {
    if (this.error) return;
    if (this.current === '') this.current = '-0';                        // "5 × ±" starts a negative
    else if (this.current.startsWith('-')) this.current = this.current.slice(1);
    else this.current = '-' + this.current;
  }

  /** Operators: add to the expression, or swap the last one if pressed twice. */
  chooseOperator(operator) {
    if (this.error) return;
    if (this.justEvaluated) {                                            // keep going with the result
      this.justEvaluated = false;
      this.expression = '';
      this.tokens = [];
    }
    if (this.current !== '') {
      this.tokens.push(cleanNumber(this.current), operator);
      this.current = '';
    } else if (this.tokens.length) {
      this.tokens[this.tokens.length - 1] = operator;                    // repeated operator: replace
    }
  }

  /**
   * % : divides the number by 100.
   * After + or − it means "percent of the first number": 200 + 10% -> 200 + 20.
   */
  percent() {
    if (this.error || this.current === '') return;
    let value = Number(this.current) / 100;
    const lastToken = this.tokens[this.tokens.length - 1];
    if (lastToken === '+' || lastToken === '−') {
      try {
        const base = Number(evaluate(this.tokens.slice(0, -1)));
        value = (base * Number(this.current)) / 100;
      } catch (err) { /* fall back to plain /100 */ }
    }
    try { this.current = formatNumber(value); }
    catch (err) { this.setError(err.message); }
  }

  /** ⌫ : delete the last digit (or the last operator if no number is being typed). */
  backspace() {
    if (this.error) { this.clear(); return; }
    if (this.justEvaluated) return;                                      // a result cannot be edited

    if (this.current !== '') {
      this.current = this.current.slice(0, -1);
      if (this.current === '' || this.current === '-') {
        this.current = this.tokens.length ? '' : '0';
      }
    } else if (this.tokens.length) {
      this.tokens.pop();                                                 // remove the operator
      this.current = this.tokens.pop() || '0';                           // edit the number before it
    }
  }

  /** = : calculate the whole expression. */
  equals() {
    if (this.error || this.justEvaluated) return;

    const list = [...this.tokens];
    if (this.current !== '') list.push(cleanNumber(this.current));
    if (isOperator(list[list.length - 1])) list.pop();                   // ignore a trailing operator
    if (list.length < 3) return;                                         // nothing to calculate yet

    try {
      const result = evaluate(list);
      this.expression = list.join(' ') + ' =';
      this.current = result;
      this.tokens = [];
      this.justEvaluated = true;
    } catch (err) {
      this.setError(err.message);
    }
  }

  /** Everything the screen needs, in one object. */
  getView() {
    const waitingForNumber = this.current === '' && this.tokens.length > 0;
    let expression = this.expression;
    if (!this.justEvaluated && this.tokens.length) {
      expression = [...this.tokens, this.current].join(' ').trim();
    }
    return {
      expression: this.error ? '' : expression,
      display: this.error || (waitingForNumber ? this.tokens[this.tokens.length - 2] : this.current),
      isError: Boolean(this.error),
      activeOperator: waitingForNumber ? this.tokens[this.tokens.length - 1] : null,
    };
  }
}

/* ==========================================================================
   3. USER INTERFACE (connects the Calculator to the page)
   ========================================================================== */

function startApp() {
  const calculator = new Calculator();
  const keypad = document.getElementById('keypad');
  const valueEl = document.getElementById('value');
  const expressionEl = document.getElementById('expression');

  /** 1234567.5 -> "1,234,567.5" (exponent numbers are left alone). */
  function addThousandsSeparators(text) {
    if (text.includes('e')) return text;
    const sign = text.startsWith('-') ? '-' : '';
    const [whole, decimals] = text.replace('-', '').split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + grouped + (decimals !== undefined ? '.' + decimals : '');
  }

  /** Shrinks the font until the number fits on one line. */
  function fitTextToDisplay() {
    valueEl.style.fontSize = '';
    let size = parseFloat(getComputedStyle(valueEl).fontSize);
    while (valueEl.scrollWidth > valueEl.clientWidth && size > 14) {
      size -= 1;
      valueEl.style.fontSize = size + 'px';
    }
  }

  /** Redraw the screen and highlight the waiting operator. */
  function render(animate) {
    const view = calculator.getView();
    valueEl.textContent = view.isError ? view.display : addThousandsSeparators(view.display);
    valueEl.classList.toggle('is-error', view.isError);
    expressionEl.textContent = view.expression;

    keypad.querySelectorAll('[data-action="operator"]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.value === view.activeOperator));
    });

    if (!view.isError) fitTextToDisplay();
    if (animate) {                                    // small "pop" when a result appears
      valueEl.classList.remove('is-new');
      void valueEl.offsetWidth;                       // restart the CSS animation
      valueEl.classList.add('is-new');
    }
  }

  /** Runs one calculator action, then updates the screen. */
  function perform(action, value) {
    switch (action) {
      case 'digit':     calculator.inputDigit(value); break;
      case 'decimal':   calculator.inputDecimal(); break;
      case 'operator':  calculator.chooseOperator(value); break;
      case 'equals':    calculator.equals(); break;
      case 'clear':     calculator.clear(); break;
      case 'backspace': calculator.backspace(); break;
      case 'percent':   calculator.percent(); break;
      case 'sign':      calculator.toggleSign(); break;
    }
    render(action === 'equals' || action === 'percent');
  }

  // Mouse and touch
  keypad.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    perform(button.dataset.action, button.dataset.value);
    if (event.detail > 0) button.blur();              // so Enter never re-presses a clicked key
  });

  // Keyboard: maps a pressed key to [action, value]
  function actionForKey(key) {
    if (/^[0-9]$/.test(key)) return ['digit', key];
    if (key === '.' || key === ',') return ['decimal'];
    if (key === '+') return ['operator', '+'];
    if (key === '-') return ['operator', '−'];
    if (key === '*' || key === 'x' || key === 'X') return ['operator', '×'];
    if (key === '/') return ['operator', '÷'];
    if (key === '%') return ['percent'];
    if (key === 'Enter' || key === '=') return ['equals'];
    if (key === 'Backspace') return ['backspace'];
    if (key === 'Escape') return ['clear'];
    return null;
  }

  /** Briefly "presses" the matching on-screen key. */
  function flashKey(action, value) {
    const selector = value
      ? `[data-action="${action}"][data-value="${value}"]`
      : `[data-action="${action}"]`;
    const button = keypad.querySelector(selector);
    if (!button) return;
    button.classList.add('is-pressed');
    setTimeout(() => button.classList.remove('is-pressed'), 110);
  }

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;       // keep browser shortcuts
    if (event.key === 'Enter' && event.target.closest('button')) return; // let focused buttons work
    const match = actionForKey(event.key);
    if (!match) return;
    event.preventDefault();                           // stops "/" opening Firefox quick-find
    perform(match[0], match[1]);
    flashKey(match[0], match[1]);
  });

  window.addEventListener('resize', fitTextToDisplay);
  render(false);
}

// Start in the browser; export the logic when loaded by Node (for testing).
if (typeof document !== 'undefined') startApp();
if (typeof module !== 'undefined') module.exports = { Calculator, evaluate, formatNumber };
