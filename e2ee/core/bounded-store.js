"use strict";

/*
 * Bounded FIFO map used for message→thread / message→sender JID correlation.
 * Oldest entries are evicted once the cap is reached, so long-running bots
 * cannot leak memory through unbounded message caches.
 */

function createBoundedMap(maxEntries) {
    var cap = Number(maxEntries) > 0 ? Number(maxEntries) : 5000;
    var m = new Map();
    return {
        get: function (k) { return m.get(k); },
        has: function (k) { return m.has(k); },
        set: function (k, v) {
            if (m.has(k)) m.delete(k); // refresh recency
            m.set(k, v);
            while (m.size > cap) {
                m.delete(m.keys().next().value);
            }
        },
        delete: function (k) { m.delete(k); },
        clear: function () { m.clear(); },
        get size() { return m.size; }
    };
}

var _installed = {};

/**
 * Install (once per process) a bounded map under `globalName` and return it.
 * Overwrites any pre-existing unbounded Map under that name on first use —
 * the map only ever holds transient JID correlations, so eviction is safe.
 */
function getSharedMap(globalName, maxEntries) {
    if (_installed[globalName]) return _installed[globalName];
    var bounded = createBoundedMap(maxEntries);
    if (typeof global !== "undefined") {
        global[globalName] = bounded;
    }
    _installed[globalName] = bounded;
    return bounded;
}

module.exports = { createBoundedMap: createBoundedMap, getSharedMap: getSharedMap };
