// Study Buddy's math practice: endless questions for a skill, made up fresh each time, with the steps to solve them.
// Each skill: make(level 1–3, random) → { q (the question), a (the answer, as text), check(typed) → true/false, steps (how to solve it) }.
// Works in the browser (window.StudyPractice) and in Node (for tests).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyPractice = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ri = (r, a, b) => a + Math.floor(r() * (b - a + 1));
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
  const fmt = x => (Number.isInteger(x) ? x.toLocaleString('en-US') : String(+x.toFixed(4)));
  const neg = x => (x < 0 ? `(${fmt(x)})` : fmt(x));
  // what was typed, as a number: 12, -3.5, 1,200, 3/4, 1 1/2, ½
  function num(s) {
    s = String(s).trim().replace(/[−–]/g, '-').replace(/,(?=\d{3}\b)/g, '').replace(/^x\s*=\s*/i, '').replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').trim();
    let m = s.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (m) { const w = +m[1]; return w + Math.sign(w || 1) * (+m[2] / +m[3]); }
    m = s.match(/^(-?\d*\.?\d+)\s*\/\s*(-?\d*\.?\d+)$/);
    if (m) return +m[2] ? +m[1] / +m[2] : NaN;
    return /^-?\d*\.?\d+$/.test(s) ? +s : NaN;
  }
  const near = (x, y, tol = 1e-9) => isFinite(x) && Math.abs(x - y) <= tol;
  const exact = v => t => near(num(t), v, 1e-9);
  const within = (v, tol) => t => near(num(t), v, tol);
  const frac = (n, d) => { const g = gcd(n, d) || 1, s = d < 0 ? -1 : 1; return [s * n / g, s * d / g]; };
  const fracText = ([n, d]) => (d === 1 ? fmt(n) : `${n}/${d}`);
  const simplest = (n, d) => t => {   // the right value, written in its simplest form
    const m = String(t).trim().replace(/[−–]/g, '-').match(/^(-?\d+)\s*\/\s*(\d+)$/);
    if (d === 1) return exact(n)(t);
    return !!m && +m[2] !== 0 && gcd(+m[1], +m[2]) === 1 && near(+m[1] / +m[2], n / d);
  };
  const numbersIn = t => (String(t).replace(/[−–]/g, '-').match(/-?\d*\.?\d+(\s*\/\s*\d+)?/g) || []).map(num).filter(isFinite);
  const yesNo = yes => t => (/^\s*(y|yes|yeah|yep|true|prime)\b/i.test(t) ? yes : /^\s*(n|no|nope|false|not)\b/i.test(t) ? !yes : false);

  // ✏️ The skills. words: topics that bring it up straight away; weak: words that only count in a math topic ("area" could be Area 51…)
  const SKILLS = [
    { id: 'add', name: 'Addition', emoji: '➕', words: ['addition', 'adding numbers', 'column addition'], weak: ['sum', 'add', 'plus'],
      make(L, r) {
        const big = [0, 99, 999, 9999][L], a = ri(r, L === 1 ? 2 : 10, big), b = ri(r, L === 1 ? 2 : 10, big);
        if (L === 3 && r() < 0.5) { const x = ri(r, 100, 9999) / 100, y = ri(r, 100, 9999) / 100, s = +(x + y).toFixed(2); return { q: `${x} + ${y} = ?`, a: fmt(s), check: within(s, 1e-6), steps: ['Line the decimal points up.', `Add like whole numbers, keeping the point in place: ${x} + ${y} = ${fmt(s)}.`] }; }
        return { q: `${fmt(a)} + ${fmt(b)} = ?`, a: fmt(a + b), check: exact(a + b), steps: [`Add the ones, then the tens, then the hundreds, carrying when a column goes over 9.`, `${fmt(a)} + ${fmt(b)} = ${fmt(a + b)}`] };
      } },
    { id: 'sub', name: 'Subtraction', emoji: '➖', words: ['subtraction', 'subtracting'], weak: ['minus', 'difference', 'subtract'],
      make(L, r) {
        const big = [0, 99, 999, 9999][L]; let a = ri(r, 5, big), b = ri(r, 1, big);
        if (L < 3 && b > a) [a, b] = [b, a];
        return { q: `${fmt(a)} − ${fmt(b)} = ?`, a: fmt(a - b), check: exact(a - b), steps: L === 3 && b > a ? [`${fmt(b)} is bigger than ${fmt(a)}, so the answer is negative.`, `${fmt(b)} − ${fmt(a)} = ${fmt(b - a)}, so ${fmt(a)} − ${fmt(b)} = ${fmt(a - b)}.`]
          : ['Subtract column by column from the right, borrowing 10 from the next column when you need to.', `${fmt(a)} − ${fmt(b)} = ${fmt(a - b)}`] };
      } },
    { id: 'mul', name: 'Multiplication', emoji: '✖️', words: ['multiplication', 'times table', 'times tables', 'multiplying'], weak: ['product', 'multiply', 'times'],
      make(L, r) {
        const a = L === 1 ? ri(r, 2, 12) : L === 2 ? ri(r, 12, 99) : ri(r, 12, 99), b = L === 1 ? ri(r, 2, 12) : L === 2 ? ri(r, 3, 9) : ri(r, 11, 99);
        const t = Math.floor(a / 10) * 10, o = a % 10;
        return { q: `${a} × ${b} = ?`, a: fmt(a * b), check: exact(a * b), steps: L === 1 ? [`Count up in ${b}s ${a} times, or use your ${b} times table.`, `${a} × ${b} = ${a * b}`]
          : [`Split ${a} into ${t} + ${o}.`, `${t} × ${b} = ${t * b} and ${o} × ${b} = ${o * b}.`, `Add them: ${t * b} + ${o * b} = ${fmt(a * b)}.`] };
      } },
    { id: 'div', name: 'Division', emoji: '➗', words: ['division', 'long division', 'dividing'], weak: ['quotient', 'divide', 'divided'],
      make(L, r) {
        if (L === 3) { const d = pick(r, [4, 5, 8, 20, 25]), n = ri(r, 101, 999), v = n / d; return { q: `${n} ÷ ${d} = ? (as a decimal)`, a: fmt(v), check: within(v, 1e-6), steps: [`${d} goes into ${n} ${Math.floor(v)} times with ${n % d} left over.`, `Keep dividing into the decimal places: ${n} ÷ ${d} = ${fmt(v)}.`] }; }
        const d = L === 1 ? ri(r, 2, 12) : ri(r, 3, 9), q = L === 1 ? ri(r, 2, 12) : ri(r, 12, 150), n = d * q;
        return { q: `${fmt(n)} ÷ ${d} = ?`, a: fmt(q), check: exact(q), steps: [`How many ${d}s make ${fmt(n)}? Think: ${d} × ? = ${fmt(n)}.`, `${d} × ${q} = ${fmt(n)}, so ${fmt(n)} ÷ ${d} = ${q}.`] };
      } },
    { id: 'order', name: 'Order of operations', emoji: '🧮', words: ['order of operations', 'pemdas', 'bodmas', 'bidmas', 'bedmas'], weak: [],
      make(L, r) {
        const a = ri(r, 2, 12), b = ri(r, 2, 9), c = ri(r, 2, 9), d = ri(r, 1, 20);
        const forms = [
          [`${d} + ${b} × ${c}`, d + b * c, [`Multiply first: ${b} × ${c} = ${b * c}.`, `Then add: ${d} + ${b * c} = ${d + b * c}.`]],
          [`(${d} + ${b}) × ${c}`, (d + b) * c, [`Brackets first: ${d} + ${b} = ${d + b}.`, `Then multiply: ${d + b} × ${c} = ${(d + b) * c}.`]],
          [`${a * b} ÷ ${b} + ${c} × ${c}`, a + c * c, [`Divide and multiply first: ${a * b} ÷ ${b} = ${a} and ${c} × ${c} = ${c * c}.`, `Then add: ${a} + ${c * c} = ${a + c * c}.`]],
          [`${d} − ${b}² + ${c}`, d - b * b + c, [`Powers first: ${b}² = ${b * b}.`, `Then work left to right: ${d} − ${b * b} + ${c} = ${d - b * b + c}.`]],
          [`(${a} + ${b})² − ${c} × ${b}`, (a + b) ** 2 - c * b, [`Brackets: ${a} + ${b} = ${a + b}. Power: ${a + b}² = ${(a + b) ** 2}.`, `Multiply: ${c} × ${b} = ${c * b}.`, `Subtract: ${(a + b) ** 2} − ${c * b} = ${(a + b) ** 2 - c * b}.`]],
        ];
        const [q, v, steps] = forms[Math.min(forms.length - 1, ri(r, 0, L + 1))];
        return { q: `${q} = ?`, a: fmt(v), check: exact(v), steps: ['Brackets, then powers, then × and ÷, then + and − (left to right).', ...steps] };
      } },
    { id: 'neg', name: 'Negative numbers', emoji: '🌡️', words: ['negative number', 'negative numbers', 'integers'], weak: ['integer', 'negative'],
      make(L, r) {
        const a = ri(r, -20, 20) || -3, b = ri(r, -20, 20) || 4, op = L === 1 ? pick(r, ['+', '−']) : L === 2 ? pick(r, ['×', '÷']) : pick(r, ['+', '−', '×', '÷']);
        let v, q;
        if (op === '÷') { const k = ri(r, -9, 9) || 2, d = ri(r, -9, 9) || -3; v = k; q = `${neg(k * d)} ÷ ${neg(d)}`; }
        else { v = op === '+' ? a + b : op === '−' ? a - b : a * b; q = `${neg(a)} ${op} ${neg(b)}`; }
        const rule = op === '+' || op === '−' ? 'Subtracting a negative is the same as adding; adding a negative is the same as subtracting.' : 'Same signs give a positive answer; different signs give a negative one.';
        return { q: `${q} = ?`, a: fmt(v), check: exact(v), steps: [rule, `${q} = ${fmt(v)}`] };
      } },
    { id: 'frac', name: 'Fractions', emoji: '🍕', words: ['fraction', 'fractions', 'numerator', 'denominator', 'simplifying fractions', 'equivalent fractions'], weak: [],
      make(L, r) {
        if (L === 1) { const d0 = ri(r, 2, 9), n0 = ri(r, 1, d0 - 1), [n, d] = frac(n0, d0), k = ri(r, 2, 6); return { q: `Simplify ${n * k}/${d * k}`, a: `${n}/${d}`, check: simplest(n, d), steps: [`Find the biggest number that divides both ${n * k} and ${d * k}: it's ${k}.`, `Divide top and bottom by it: ${n * k}/${d * k} = ${n}/${d}.`] }; }
        const b = ri(r, 2, 9), a = ri(r, 1, b - 1), d = ri(r, 2, 9), c = ri(r, 1, d - 1);   // (proper fractions)
        if (L === 2) {
          const plus = r() < 0.6, [n, m] = frac(plus ? a * d + c * b : a * d - c * b, b * d);
          return { q: `${a}/${b} ${plus ? '+' : '−'} ${c}/${d} = ? (simplest form)`, a: fracText([n, m]), check: simplest(n, m), steps: [`Use a common bottom number: ${b} × ${d} = ${b * d}.`, `${a}/${b} = ${a * d}/${b * d} and ${c}/${d} = ${c * b}/${b * d}.`, `${plus ? 'Add' : 'Subtract'} the tops: ${a * d} ${plus ? '+' : '−'} ${c * b} = ${plus ? a * d + c * b : a * d - c * b}, so ${plus ? a * d + c * b : a * d - c * b}/${b * d} = ${fracText([n, m])}.`] };
        }
        const times = r() < 0.5, [n, m] = times ? frac(a * c, b * d) : frac(a * d, b * c);
        return { q: `${a}/${b} ${times ? '×' : '÷'} ${c}/${d} = ? (simplest form)`, a: fracText([n, m]), check: simplest(n, m), steps: times ? [`Multiply the tops and the bottoms: ${a * c}/${b * d}.`, `Simplify: ${fracText([n, m])}.`] : [`Dividing by ${c}/${d} is multiplying by ${d}/${c}.`, `${a}/${b} × ${d}/${c} = ${a * d}/${b * c} = ${fracText([n, m])}.`] };
      } },
    { id: 'dec', name: 'Decimals', emoji: '🔟', words: ['decimal', 'decimals', 'decimal point'], weak: [],
      make(L, r) {
        if (L === 1) { const a = ri(r, 11, 99) / 10, b = ri(r, 11, 99) / 10, v = +(a + b).toFixed(1); return { q: `${a} + ${b} = ?`, a: fmt(v), check: within(v, 1e-6), steps: ['Line up the decimal points and add.', `${a} + ${b} = ${fmt(v)}`] }; }
        if (L === 2) { const a = ri(r, 11, 99) / 10, b = ri(r, 2, 9), v = +(a * b).toFixed(2); return { q: `${a} × ${b} = ?`, a: fmt(v), check: within(v, 1e-6), steps: [`Ignore the point: ${Math.round(a * 10)} × ${b} = ${Math.round(a * 10) * b}.`, `Put one decimal place back: ${fmt(v)}.`] }; }
        const d = pick(r, [4, 5, 8, 20, 25, 40]), n = ri(r, 1, d - 1), v = n / d;
        return { q: `Write ${n}/${d} as a decimal`, a: fmt(v), check: within(v, 1e-6), steps: [`Divide the top by the bottom: ${n} ÷ ${d}.`, `${n} ÷ ${d} = ${fmt(v)}`] };
      } },
    { id: 'pct', name: 'Percentages', emoji: '💯', words: ['percent', 'percentage', 'percentages', 'per cent'], weak: [],
      make(L, r) {
        if (L === 3) { const whole = pick(r, [20, 25, 40, 50, 80, 120, 200]), p = pick(r, [5, 10, 15, 20, 25, 30, 40, 45, 60, 75]), part = whole * p / 100; return { q: `What percent of ${whole} is ${fmt(part)}?`, a: `${p}%`, check: t => exact(p)(String(t).replace('%', '')), steps: [`Divide the part by the whole: ${fmt(part)} ÷ ${whole} = ${p / 100}.`, `Times 100: ${p}%.`] }; }
        const p = L === 1 ? pick(r, [10, 25, 50, 20, 75]) : pick(r, [5, 12, 15, 35, 40, 65, 80]), w = L === 1 ? ri(r, 1, 20) * 4 : ri(r, 2, 40) * 20, v = p * w / 100;
        return { q: `${p}% of ${w} = ?`, a: fmt(v), check: within(v, 1e-6), steps: [`${p}% means ${p} out of 100, so multiply by ${p / 100}.`, `${w} × ${p / 100} = ${fmt(v)}`] };
      } },
    { id: 'ratio', name: 'Ratios', emoji: '⚖️', words: ['ratio', 'ratios', 'proportion', 'unitary method'], weak: [],
      make(L, r) {
        if (L === 1) { const a = ri(r, 1, 5), b = ri(r, 1, 5) + (a === 1 ? 1 : 0), g = gcd(a, b), k = ri(r, 2, 6); return { q: `Simplify the ratio ${a / g * k * g}:${b / g * k * g}`, a: `${a / g}:${b / g}`, check: t => { const m = String(t).match(/(\d+)\s*[:to/]+\s*(\d+)/); return !!m && +m[1] === a / g && +m[2] === b / g; }, steps: [`Divide both sides by ${k * g}.`, `${a / g * k * g}:${b / g * k * g} = ${a / g}:${b / g}`] }; }
        if (L === 2) { const a = ri(r, 1, 5), b = ri(r, 1, 6), unit = ri(r, 3, 15), total = (a + b) * unit, big = Math.max(a, b) * unit; return { q: `Share ${total} in the ratio ${a}:${b}. How big is the bigger share?`, a: fmt(big), check: exact(big), steps: [`There are ${a} + ${b} = ${a + b} parts.`, `One part is ${total} ÷ ${a + b} = ${unit}.`, `The bigger share is ${Math.max(a, b)} × ${unit} = ${big}.`] }; }
        const n = ri(r, 2, 6), each = ri(r, 3, 40) / 4, m = ri(r, 3, 12), cost = +(n * each).toFixed(2), v = +(m * each).toFixed(2);
        return { q: `${n} pens cost $${cost.toFixed(2)}. How much do ${m} pens cost?`, a: `$${v.toFixed(2)}`, check: t => within(v, 0.005)(String(t).replace(/[$£€]/g, '')), steps: [`One pen costs $${cost.toFixed(2)} ÷ ${n} = $${each.toFixed(2)}.`, `${m} pens cost ${m} × $${each.toFixed(2)} = $${v.toFixed(2)}.`] };
      } },
    { id: 'pow', name: 'Exponents & powers', emoji: '⚡', words: ['exponent', 'exponents', 'exponentiation', 'powers of', 'indices', 'square number', 'cube number'], weak: ['power', 'powers'],
      make(L, r) {
        if (L === 1) { const a = ri(r, 2, 12), n = a > 5 ? 2 : ri(r, 2, 3), v = a ** n; return { q: `${a}${n === 2 ? '²' : '³'} = ?`, a: fmt(v), check: exact(v), steps: [`${a}${n === 2 ? '²' : '³'} means ${Array(n).fill(a).join(' × ')}.`, `= ${fmt(v)}`] }; }
        if (L === 2) { const a = pick(r, [2, 3, 10]), n = a === 10 ? ri(r, 3, 6) : ri(r, 4, a === 2 ? 10 : 5), v = a ** n; return { q: `${a} to the power ${n} = ?`, a: fmt(v), check: exact(v), steps: [`Multiply ${a} by itself ${n} times.`, `${a}^${n} = ${fmt(v)}`] }; }
        if (r() < 0.5) { const a = pick(r, [2, 3, 5, 7, 'x']), m = ri(r, 2, 9), n = ri(r, 2, 9), same = r() < 0.5; return { q: same ? `${a}^${m} × ${a}^${n} = ${a}^? ` : `${a}^${m + n} ÷ ${a}^${n} = ${a}^?`, a: fmt(same ? m + n : m), check: exact(same ? m + n : m), steps: [same ? 'Multiplying powers of the same number: add the exponents.' : 'Dividing powers of the same number: subtract the exponents.', same ? `${m} + ${n} = ${m + n}` : `${m + n} − ${n} = ${m}`] }; }
        const a = pick(r, [2, 4, 5, 10]), n = ri(r, 1, a === 2 ? 3 : 2), v = 1 / a ** n;
        return { q: `${a}^−${n} = ? (a fraction or decimal)`, a: `1/${a ** n}`, check: within(v, 1e-6), steps: ['A negative exponent means 1 over the positive power.', `${a}^−${n} = 1/${a}^${n} = 1/${a ** n} = ${fmt(v)}`] };
      } },
    { id: 'sqrt', name: 'Square roots', emoji: '√', words: ['square root', 'square roots', 'cube root', 'radical'], weak: ['root'],
      make(L, r) {
        if (L === 1) { const a = ri(r, 2, 12); return { q: `√${a * a} = ?`, a: fmt(a), check: exact(a), steps: [`Which number times itself makes ${a * a}?`, `${a} × ${a} = ${a * a}, so √${a * a} = ${a}.`] }; }
        if (L === 2) { if (r() < 0.5) { const a = ri(r, 13, 30); return { q: `√${a * a} = ?`, a: fmt(a), check: exact(a), steps: [`${a} × ${a} = ${a * a}.`, `So √${a * a} = ${a}.`] }; } const a = ri(r, 2, 10); return { q: `∛${a ** 3} = ? (cube root)`, a: fmt(a), check: exact(a), steps: [`Which number times itself three times makes ${a ** 3}?`, `${a} × ${a} × ${a} = ${a ** 3}, so ∛${a ** 3} = ${a}.`] }; }
        let n = ri(r, 10, 150); while (Number.isInteger(Math.sqrt(n))) n++;
        const v = Math.sqrt(n), lo = Math.floor(v);
        return { q: `√${n} = ? (to 1 decimal place)`, a: v.toFixed(1), check: within(+v.toFixed(1), 0.051), steps: [`${lo}² = ${lo * lo} and ${lo + 1}² = ${(lo + 1) ** 2}, so √${n} is between ${lo} and ${lo + 1}.`, `Try decimals: √${n} ≈ ${v.toFixed(3)}, which rounds to ${v.toFixed(1)}.`] };
      } },
    { id: 'lin', name: 'Linear equations', emoji: '🟰', words: ['linear equation', 'linear equations', 'solving equations', 'solve for x', 'algebra', 'elementary algebra', 'equation'], weak: [],
      make(L, r) {
        const x = ri(r, -9, 12) || 5, a = ri(r, 2, 9), b = ri(r, -15, 15) || 7, sb = b < 0 ? `− ${-b}` : `+ ${b}`;
        if (L === 1) { if (r() < 0.5) return { q: `x ${sb} = ${x + b}. What is x?`, a: fmt(x), check: exact(x), steps: [`${b < 0 ? 'Add' : 'Subtract'} ${Math.abs(b)} on both sides.`, `x = ${x + b} ${b < 0 ? '+' : '−'} ${Math.abs(b)} = ${x}`] }; return { q: `${a}x = ${a * x}. What is x?`, a: fmt(x), check: exact(x), steps: [`Divide both sides by ${a}.`, `x = ${a * x} ÷ ${a} = ${x}`] }; }
        if (L === 2) return { q: `${a}x ${sb} = ${a * x + b}. What is x?`, a: fmt(x), check: exact(x), steps: [`${b < 0 ? 'Add' : 'Subtract'} ${Math.abs(b)} on both sides: ${a}x = ${a * x}.`, `Divide by ${a}: x = ${x}.`] };
        const c = ri(r, 1, a - 1) || 1, d = a * x + b - c * x, sd = d < 0 ? `− ${-d}` : `+ ${d}`;
        return { q: `${a}x ${sb} = ${c === 1 ? '' : c}x ${sd}. What is x?`, a: fmt(x), check: exact(x), steps: [`Take ${c === 1 ? '' : c}x from both sides: ${a - c}x ${sb} = ${d}.`, `${b < 0 ? 'Add' : 'Subtract'} ${Math.abs(b)}: ${a - c}x = ${d - b}.`, `Divide by ${a - c}: x = ${x}.`] };
      } },
    { id: 'quad', name: 'Quadratic equations', emoji: '📈', words: ['quadratic', 'quadratic equation', 'quadratic formula', 'factorising', 'factorizing', 'factoring quadratics', 'completing the square'], weak: [],
      make(L, r) {
        const p = ri(r, -9, 9), q = ri(r, -9, 9), A = L === 3 ? pick(r, [2, 3]) : 1, B = -A * (p + q), C = A * p * q;
        const term = (k, s, first) => (k === 0 ? '' : `${k < 0 ? (first ? '−' : ' − ') : first ? '' : ' + '}${Math.abs(k) === 1 && s ? '' : Math.abs(k)}${s}`);
        const eq = `${term(A, 'x²', true)}${term(B, 'x')}${term(C, '')} = 0`, roots = [...new Set([p, q])].sort((a, b) => a - b);
        const f = n => (n === 0 ? 'x' : `(x ${n > 0 ? '−' : '+'} ${Math.abs(n)})`);
        return { q: `Solve ${eq}`, a: roots.map(v => `x = ${v}`).join(' or '), check: t => { const got = [...new Set(numbersIn(t))].sort((a, b) => a - b); return got.length === roots.length && got.every((v, i) => near(v, roots[i])); },
          steps: [A > 1 ? `Divide everything by ${A} first.` : 'Find two numbers that multiply to the last number and add to the middle one.', `It factors as ${A > 1 ? A : ''}${f(p)}${f(q)} = 0.`, `So x = ${roots.join(' or x = ')}.`] };
      } },
    { id: 'pyth', name: 'Pythagorean theorem', emoji: '📐', words: ['pythagorean theorem', 'pythagoras', 'pythagorean', 'hypotenuse', 'right triangle', 'right-angled triangle'], weak: [],
      make(L, r) {
        const [a0, b0, c0] = pick(r, [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29]]), k = a0 === 3 ? ri(r, 1, 4) : 1, [a, b, c] = [a0 * k, b0 * k, c0 * k];
        if (L === 1) return { q: `A right triangle has legs ${a} and ${b}. How long is the hypotenuse?`, a: fmt(c), check: exact(c), steps: ['a² + b² = c²', `${a}² + ${b}² = ${a * a} + ${b * b} = ${c * c}`, `c = √${c * c} = ${c}`] };
        if (L === 2) return { q: `A right triangle has a hypotenuse of ${c} and one leg of ${a}. How long is the other leg?`, a: fmt(b), check: exact(b), steps: ['b² = c² − a²', `${c}² − ${a}² = ${c * c} − ${a * a} = ${b * b}`, `b = √${b * b} = ${b}`] };
        const x = ri(r, 2, 15), y = ri(r, 2, 15), h = Math.sqrt(x * x + y * y);
        return { q: `A right triangle has legs ${x} and ${y}. How long is the hypotenuse? (to 1 decimal place)`, a: h.toFixed(1), check: within(+h.toFixed(1), 0.051), steps: ['a² + b² = c²', `${x}² + ${y}² = ${x * x + y * y}`, `c = √${x * x + y * y} ≈ ${h.toFixed(1)}`] };
      } },
    { id: 'area', name: 'Area & perimeter', emoji: '🟦', words: ['perimeter', 'circumference', 'area of a circle', 'area of a triangle', 'area of a rectangle'], weak: ['area', 'circle', 'rectangle'],
      make(L, r) {
        const w = ri(r, 2, 20), h = ri(r, 2, 20);
        const forms = L === 1 ? ['rect-area', 'rect-per'] : L === 2 ? ['tri-area', 'rect-per', 'circle-c'] : ['circle-a', 'circle-c', 'tri-area'];
        const f = pick(r, forms);
        if (f === 'rect-area') return { q: `A rectangle is ${w} cm by ${h} cm. What is its area (cm²)?`, a: fmt(w * h), check: exact(w * h), steps: ['Area of a rectangle = length × width.', `${w} × ${h} = ${w * h} cm²`] };
        if (f === 'rect-per') return { q: `A rectangle is ${w} m by ${h} m. What is its perimeter (m)?`, a: fmt(2 * (w + h)), check: exact(2 * (w + h)), steps: ['Perimeter = add up all four sides = 2 × (length + width).', `2 × (${w} + ${h}) = ${2 * (w + h)} m`] };
        if (f === 'tri-area') { const b = w * 2; return { q: `A triangle has a base of ${b} cm and a height of ${h} cm. What is its area (cm²)?`, a: fmt(b * h / 2), check: exact(b * h / 2), steps: ['Area of a triangle = ½ × base × height.', `½ × ${b} × ${h} = ${b * h / 2} cm²`] }; }
        const rad = ri(r, 2, 15), with_ = pi => (f === 'circle-a' ? pi * rad * rad : 2 * pi * rad), v = with_(Math.PI), v314 = with_(3.14);
        return { q: `A circle has a radius of ${rad} cm. What is its ${f === 'circle-a' ? 'area (cm²)' : 'circumference (cm)'}? (to 1 decimal place)`, a: v.toFixed(1), check: t => [v, v314, with_(22 / 7)].some(x => near(num(t), x, 0.06)),   // (π, 3.14 or 22/7 all count)
          steps: [f === 'circle-a' ? 'Area of a circle = π × r².' : 'Circumference = 2 × π × r.', f === 'circle-a' ? `π × ${rad}² = π × ${rad * rad} ≈ ${v.toFixed(1)} cm²` : `2 × π × ${rad} ≈ ${v.toFixed(1)} cm`, '(With π ≈ 3.14 you get ' + v314.toFixed(1) + ', which also counts.)'] };
      } },
    { id: 'stats', name: 'Mean, median & mode', emoji: '📊', words: ['median', 'arithmetic mean', 'mean median mode', 'mean, median', 'statistics', 'average', 'mode (statistics)', 'range (statistics)'], weak: ['mean', 'mode'],
      make(L, r) {
        const n = L === 1 ? 5 : L === 2 ? 6 : 7, xs = Array.from({ length: n }, () => ri(r, 1, 30)), which = pick(r, L === 1 ? ['mean', 'median', 'range'] : ['mean', 'median', 'mode', 'range']);
        if (which === 'mode') { const m = xs[0]; xs[1] = m; xs[2] = m; for (let i = 3; i < n; i++) while (xs.slice(0, i).includes(xs[i]) && xs[i] !== m) xs[i] = ri(r, 1, 30); }
        if (which === 'mean' && L === 1) { const s = xs.reduce((a, b) => a + b, 0); xs[n - 1] += (n - (s % n)) % n; }
        const sorted = xs.slice().sort((a, b) => a - b), sum = xs.reduce((a, b) => a + b, 0), list = xs.join(', ');
        if (which === 'mean') { const v = sum / n; return { q: `What is the mean of ${list}?${Number.isInteger(v) ? '' : ' (to 1 decimal place)'}`, a: Number.isInteger(v) ? fmt(v) : v.toFixed(1), check: within(Number.isInteger(v) ? v : +v.toFixed(1), Number.isInteger(v) ? 1e-9 : 0.051), steps: [`Add them up: ${sum}.`, `Divide by how many there are (${n}): ${sum} ÷ ${n} = ${fmt(+v.toFixed(2))}.`] }; }
        if (which === 'median') { const v = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2; return { q: `What is the median of ${list}?`, a: fmt(v), check: within(v, 1e-9), steps: [`Put them in order: ${sorted.join(', ')}.`, n % 2 ? `The middle one is ${v}.` : `The middle two are ${sorted[n / 2 - 1]} and ${sorted[n / 2]}; halfway between is ${v}.`] }; }
        if (which === 'mode') return { q: `What is the mode of ${list}?`, a: fmt(xs[0]), check: exact(xs[0]), steps: ['The mode is the number that comes up most often.', `${xs[0]} comes up 3 times.`] };
        return { q: `What is the range of ${list}?`, a: fmt(sorted[n - 1] - sorted[0]), check: exact(sorted[n - 1] - sorted[0]), steps: ['Range = biggest − smallest.', `${sorted[n - 1]} − ${sorted[0]} = ${sorted[n - 1] - sorted[0]}`] };
      } },
    { id: 'primes', name: 'Primes & factors', emoji: '🔢', words: ['prime number', 'prime numbers', 'prime factorization', 'prime factorisation', 'greatest common divisor', 'least common multiple', 'highest common factor', 'lowest common multiple', 'factors and multiples'], weak: ['prime', 'factor', 'factors', 'multiple', 'multiples', 'divisor'],
      make(L, r) {
        const isPrime = n => { if (n < 2) return false; for (let k = 2; k * k <= n; k++) if (n % k === 0) return false; return true; };
        if (L === 1) { const n = ri(r, 11, 99); const p = isPrime(n), f = p ? null : [...Array(n).keys()].slice(2).find(k => n % k === 0); return { q: `Is ${n} a prime number? (yes or no)`, a: p ? 'yes' : 'no', check: yesNo(p), steps: p ? [`Try dividing ${n} by 2, 3, 5, 7… up to √${n} ≈ ${Math.floor(Math.sqrt(n))}.`, `Nothing divides it evenly, so ${n} is prime.`] : [`${n} = ${f} × ${n / f}`, `It has factors other than 1 and itself, so it isn't prime.`] }; }
        if (L === 2) { const g = ri(r, 2, 12), a = g * ri(r, 2, 9), b = g * ri(r, 2, 9), G = gcd(a, b), lcm = a * b / G, askG = r() < 0.5; return { q: askG ? `What is the greatest common factor of ${a} and ${b}?` : `What is the least common multiple of ${a} and ${b}?`, a: fmt(askG ? G : lcm), check: exact(askG ? G : lcm), steps: askG ? [`List the factors of each, or divide out shared primes.`, `The biggest number that divides both ${a} and ${b} is ${G}.`] : [`The greatest common factor is ${G}.`, `LCM = ${a} × ${b} ÷ ${G} = ${lcm}.`] }; }
        const ps = Array.from({ length: ri(r, 3, 4) }, () => pick(r, [2, 2, 3, 3, 5, 7, 11])).sort((a, b) => a - b), n = ps.reduce((a, b) => a * b, 1);
        return { q: `Write ${n} as a product of prime numbers`, a: ps.join(' × '), check: t => { const s = String(t).replace(/\^(\d)/g, '^$1').replace(/([0-9]+)\s*\^\s*([0-9]+)|([0-9]+)([²³])/g, (m, a, e, b, sup) => Array(+(e || (sup === '²' ? 2 : 3))).fill(a || b).join('×')); const got = (s.match(/\d+/g) || []).map(Number).sort((a, b) => a - b); return got.join() === ps.join() && got.every(isPrime); },
          steps: [`Keep dividing by the smallest prime that fits: ${ps.map((p, i) => `${ps.slice(i).reduce((a, b) => a * b, 1)} ÷ ${p}`).join(', ')}.`, `${n} = ${ps.join(' × ')}`] };
      } },
  ];
  const BY = Object.fromEntries(SKILLS.map(s => [s.id, s]));
  const MATHY = /\b(math|maths|mathematics|mathematical|arithmetic|algebra|geometry|geometric|calculus|equation|equations|formula|number|numbers|integer|integers|polygon|triangle|shape|two-dimensional|quantity|statistic|statistics|calculation|operation|theorem)\b/i;
  const GENERAL = /^(math|maths|mathematics|arithmetic|algebra|basic math|elementary mathematics|mental math|mental arithmetic|times tables|numbers)$/i;
  // which skills fit a topic (what was typed, plus the article's title and description)
  function detect(...texts) {
    const all = texts.filter(Boolean).join(' · ').toLowerCase(), mathy = MATHY.test(all);
    const has = w => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`).test(all);
    const ids = SKILLS.filter(s => s.words.some(has) || (mathy && s.weak.some(has))).map(s => s.id);
    const general = texts.some(t => t && GENERAL.test(t.trim()));
    return { ids: general && !ids.length ? SKILLS.map(s => s.id) : ids, general, math: mathy || general || ids.length > 0 };
  }
  function make(id, level, r = Math.random) { const s = BY[id]; return s ? { ...s.make(Math.max(1, Math.min(3, level || 1)), r), skill: id } : null; }
  return { SKILLS, detect, make, num };
});
