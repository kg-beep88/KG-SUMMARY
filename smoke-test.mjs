class ClassList {
  add() {}
  remove() {}
  toggle() {}
  contains() { return false; }
}
class Element {
  constructor(id = '') {
    this.id = id;
    this.dataset = {};
    this.classList = new ClassList();
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.required = false;
    this.open = false;
    this.files = [];
  }
  addEventListener() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  reset() {}
  click() {}
  closest() { return null; }
}
const elements = new Map();
function get(id) {
  if (!elements.has(id)) elements.set(id, new Element(id));
  return elements.get(id);
}
const navs = ['calendar','master','settings'].map((view) => { const el = new Element(); el.dataset.view = view; return el; });
const views = ['calendarView','masterView','settingsView'].map((id) => new Element(id));
globalThis.document = {
  title: '',
  querySelector(selector) {
    if (selector.startsWith('#')) return get(selector.slice(1));
    if (selector === '.topbar-actions') return get('topbar-actions');
    return new Element();
  },
  querySelectorAll(selector) {
    if (selector === '.nav-button') return navs;
    if (selector === '.view') return views;
    return [];
  },
  addEventListener() {},
  createElement() { return new Element(); },
};
globalThis.window = {
  location: { origin: 'https://example.github.io', pathname: '/kg/' },
  setTimeout,
  clearTimeout,
};
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
globalThis.confirm = () => true;
globalThis.structuredClone = globalThis.structuredClone || ((value) => JSON.parse(JSON.stringify(value)));

await import('./app.js');
await new Promise((resolve) => setTimeout(resolve, 30));
console.log('Browser setup-mode smoke test passed.');
