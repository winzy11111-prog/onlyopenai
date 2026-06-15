const o = require('openai');
const c = new o.OpenAI({ apiKey: 'x' });
console.log('top-level keys:', Object.keys(c).filter(k => !k.startsWith('_')));
console.log('has vectorStores (top):', !!c.vectorStores);
