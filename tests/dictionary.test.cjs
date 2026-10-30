const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// نشغّل شيفرة الصفحة نفسها مع واجهة صغيرة للعناصر، ومن دون شبكة أو حسابات.
async function app(words) {
  const elements = new Map();
  const element = () => ({
    value: '', textContent: '', innerHTML: '', hidden: false,
    addEventListener() {}, querySelectorAll() { return []; },
  });
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const context = vm.createContext({
    console, window: {},
    fetch: async () => ({ ok: true, json: async () => words }),
    document: {
      getElementById: get,
      querySelector: () => element(),
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => ({
        textContent: '',
        get innerHTML() {
          return String(this.textContent).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },
      }),
    },
  });
  vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  return { get, run: source => vm.runInContext(source, context) };
}

const ids = a => [...a.get('trList').innerHTML.matchAll(/data-id="([^"]+)"/g)].map(m => m[1]);
const words = Array.from({ length: 30 }, (_, i) => ({ lat: 'baa', mean: `معنى ${i + 1}` }));
const signedIn = a => a.run("me='reviewer'; db={collection:()=>({doc:()=>({set:async()=>{}})})}");

test('البحث العربي يجد الكلمة من دون حركاتها', async () => {
  const a = await app([{ lat: 'baarí', mean: 'حصان' }]);
  a.get('q').value = 'باري';
  assert.equal(a.run('filtered().length'), 1);
});

test('البحث اللاتيني يتجاهل النبرة وحالة الأحرف', async () => {
  const a = await app([{ lat: 'aryén', mean: 'ماء' }]);
  a.get('q').value = 'ARYEN';
  assert.equal(a.run('filtered().length'), 1);
});

test('البحث يحافظ على تمييز الصوامت المفخمة', async () => {
  const a = await app([{ lat: 'ṭa', mean: 'الأول' }, { lat: 'ta', mean: 'الثاني' }]);
  a.get('q').value = 'ṭa';
  assert.equal(a.run('filtered().length'), 1);
  assert.equal(a.run('filtered()[0].lat'), 'ṭa');
});

test('حفظ دفعة كاملة لا يتخطى الدفعة التالية', async () => {
  const a = await app(words);
  signedIn(a);
  a.run('renderTr()');
  for (const id of ids(a)) {
    await a.run(`save('reviews','${id}__reviewer',{entry:'${id}',verdict:'say',ar:'كلمة'},$('trStatus'),'حُفظت')`);
  }
  assert.equal(a.run('reviews.length'), 10);
  a.get('trNext').onclick();
  assert.equal(ids(a)[0], 'w0011');
  assert.equal(ids(a).at(-1), 'w0020');
});

test('التحديث الحي بعد الحفظ لا يقفز عشر كلمات إضافية', async () => {
  const a = await app(words);
  signedIn(a);
  a.run('renderTr()');
  a.run("reviews=WORDS.slice(0,10).map(w=>({entry:w.id,uid:me,verdict:'say'}))");
  a.get('trNext').onclick();
  assert.equal(ids(a)[0], 'w0011');
});

test('الكلمات المتروكة تعود بعد آخر دفعة', async () => {
  const a = await app(words.slice(0, 12));
  signedIn(a);
  a.run('renderTr()');
  a.run("reviews=WORDS.slice(1,10).map(w=>({entry:w.id,uid:me,verdict:'say'}))");
  a.get('trNext').onclick();
  assert.deepEqual(ids(a), ['w0011', 'w0012', 'w0001']);
});

test('فشل الحفظ لا يُخفي الكلمة من المراجعة', async () => {
  const a = await app(words);
  a.run("me='reviewer'; db={collection:()=>({doc:()=>({set:async()=>{throw new Error('offline')}})})}");
  const result = await a.run("save('reviews','w0001__reviewer',{entry:'w0001',verdict:'say'},$('trStatus'),'حُفظت')");
  assert.equal(result, false);
  assert.equal(a.run('reviews.length'), 0);
});

test('انتهاء المراجعات يُخفي زر الكلمات الأخرى', async () => {
  const a = await app(words);
  signedIn(a);
  a.run("reviews=WORDS.map(w=>({entry:w.id,uid:me,verdict:'say'}));renderTr()");
  assert.equal(ids(a).length, 0);
  assert.equal(a.get('trNext').hidden, true);
});

test('تهيئة الصفحة للقراءة العربية على الهاتف', () => {
  assert.match(html, /<html[^>]*lang="ar"[^>]*dir="rtl"/);
  assert.match(html, /<meta[^>]*name="viewport"[^>]*width=device-width/);
  assert.match(html, /<meta[^>]*charset="utf-8"/i);
});
