class SimpleCache {
  constructor(defaultTtlMs = 15 * 60 * 1000) { // 15 minutos por defecto
    this.cache = new Map();
    this.defaultTtl = defaultTtlMs;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, ttlMs = this.defaultTtl) {
    // Si la caché crece demasiado, eliminamos las más antiguas
    if (this.cache.size > 2000) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  clear() {
    this.cache.clear();
  }
}

module.exports = new SimpleCache();

