(function () {
    "use strict";

    const HND_MARKET_CATALOG_VERSION = "4.5.1";
    const HND_MARKET_CATALOG_SCHEMA_VERSION = 1;
    const HND_MARKET_CATALOG_CACHE_KEY = "HNDai.marketCatalog.v4.5.1";
    const HND_MARKET_FAVORITES_KEY = "HNDai.marketFavorites.v4.5.1";
    const HND_MARKET_TOP_LIMIT = 50;
    const HND_MARKET_CACHE_TTL_MS = 30 * 60 * 1000;
    const HND_MARKET_STALE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const HND_MARKET_REQUEST_TIMEOUT_MS = 12000;
    const HND_MARKET_MAX_USER_FAVORITES = 20;
    const HND_MARKET_CORE_SYMBOLS = Object.freeze([
        "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"
    ]);
    const HND_MARKET_EXCLUDED_BASE_ASSETS = new Set([
        "USDT", "USDC", "FDUSD", "TUSD", "USDP", "DAI", "AEUR", "EURC",
        "USD1", "RLUSD", "BUSD", "EUR", "TRY", "BRL", "GBP", "AUD",
        "UAH", "PLN", "RON", "ARS", "ZAR", "NGN", "RUB", "BIDR", "IDRT"
    ]);
    const HND_MARKET_CATALOG_DEBUG_REASONS = Object.freeze({
        CORE_MARKETS_RENDERED: "CORE_MARKETS_RENDERED",
        CACHE_LOADED: "CACHE_LOADED",
        STALE_CACHE_LOADED: "STALE_CACHE_LOADED",
        NETWORK_CATALOG_LOADED: "NETWORK_CATALOG_LOADED",
        NETWORK_REFRESH_FAILED: "NETWORK_REFRESH_FAILED",
        STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
        INVALID_CACHE_PAYLOAD: "INVALID_CACHE_PAYLOAD",
        FAVORITE_ADDED: "FAVORITE_ADDED",
        FAVORITE_REMOVED: "FAVORITE_REMOVED",
        FAVORITE_LIMIT_REACHED: "FAVORITE_LIMIT_REACHED",
        SEARCH_UPDATED: "SEARCH_UPDATED",
        CATALOG_ERROR: "CATALOG_ERROR"
    });

    let initialized = false;
    let refreshPromise = null;
    let allMarkets = [];
    let visibleMarkets = [];
    let userFavorites = [];
    let selectedSymbol = "BTCUSDT";
    let searchQuery = "";
    let catalogSource = "CORE_ONLY";
    let catalogStale = false;
    let cacheUpdatedAt = null;
    let lastNetworkRefreshAt = null;
    let lastEvaluation = null;
    let listenersInitialized = false;
    let storageAvailable = true;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function normalizeSymbol(value) {
        const symbol = String(value || "").trim().toUpperCase();
        return /^[A-Z0-9]+$/.test(symbol) ? symbol : "";
    }

    function isLeveragedBaseAsset(baseAsset) {
        return /^.{2,}(?:UP|DOWN|BULL|BEAR|3L|3S|5L|5S)$/.test(String(baseAsset || ""));
    }

    function hasSpotPermission(row) {
        if (row.isSpotTradingAllowed === false) return false;
        if (row.isSpotTradingAllowed === true) return true;
        if (Array.isArray(row.permissions) && row.permissions.includes("SPOT")) return true;
        return Array.isArray(row.permissionSets) && row.permissionSets.some(set =>
            Array.isArray(set) && set.includes("SPOT")
        );
    }

    function isEligibleExchangeSymbol(row) {
        return row && normalizeSymbol(row.symbol) === row.symbol &&
            typeof row.baseAsset === "string" && normalizeSymbol(row.baseAsset) === row.baseAsset &&
            row.quoteAsset === "USDT" && row.status === "TRADING" && hasSpotPermission(row);
    }

    function emptyCounts() {
        return {
            exchangeSymbolsReceived: 0, tickersReceived: 0, spotUsdtEligible: 0,
            excludedStableFiat: 0, excludedLeveraged: 0, excludedInvalid: 0,
            coreMarkets: HND_MARKET_CORE_SYMBOLS.length, topMarkets: 0,
            userFavorites: userFavorites.length, totalMarkets: allMarkets.length,
            visibleMarkets: visibleMarkets.length
        };
    }

    function coreMarkets(source = "CORE_ONLY") {
        return HND_MARKET_CORE_SYMBOLS.map(symbol => ({
            symbol, baseAsset: symbol.slice(0, -4), quoteAsset: "USDT",
            quoteVolume: 0, lastPrice: 0, priceChangePercent: null,
            volumeRank: null, isCore: true, isFavorite: true,
            isTopMarket: false, source
        }));
    }

    function buildDynamicMarketCatalog(exchangeSymbols, tickers, favorites = [], source = "NETWORK") {
        const safeExchange = Array.isArray(exchangeSymbols) ? exchangeSymbols : [];
        const safeTickers = Array.isArray(tickers) ? tickers : [];
        const favoriteSet = new Set(Array.isArray(favorites)
            ? favorites.map(normalizeSymbol).filter(Boolean) : []);
        const tickerMap = new Map();
        const counts = emptyCounts();
        counts.exchangeSymbolsReceived = safeExchange.length;
        counts.tickersReceived = safeTickers.length;

        safeTickers.forEach(row => {
            const symbol = normalizeSymbol(row?.symbol);
            const quoteVolume = Number(row?.quoteVolume);
            const lastPrice = Number(row?.lastPrice);
            const priceChangePercent = row?.priceChangePercent === null ||
                row?.priceChangePercent === undefined ? null : Number(row.priceChangePercent);
            if (symbol && Number.isFinite(quoteVolume) && quoteVolume >= 0 &&
                Number.isFinite(lastPrice) && lastPrice > 0 &&
                (priceChangePercent === null || Number.isFinite(priceChangePercent))) {
                tickerMap.set(symbol, { quoteVolume, lastPrice, priceChangePercent });
            }
        });

        const exchangeMap = new Map();
        safeExchange.forEach(row => {
            const symbol = normalizeSymbol(row?.symbol);
            if (!symbol || exchangeMap.has(symbol)) {
                counts.excludedInvalid++;
                return;
            }
            exchangeMap.set(symbol, row);
        });

        const eligible = [];
        exchangeMap.forEach((row, symbol) => {
            if (!isEligibleExchangeSymbol(row)) {
                counts.excludedInvalid++;
                return;
            }
            counts.spotUsdtEligible++;
            const isCore = HND_MARKET_CORE_SYMBOLS.includes(symbol);
            if (!isCore && HND_MARKET_EXCLUDED_BASE_ASSETS.has(row.baseAsset)) {
                counts.excludedStableFiat++;
                return;
            }
            if (!isCore && isLeveragedBaseAsset(row.baseAsset)) {
                counts.excludedLeveraged++;
                return;
            }
            const ticker = tickerMap.get(symbol);
            if (!ticker || ticker.quoteVolume <= 0) {
                counts.excludedInvalid++;
                return;
            }
            eligible.push({
                symbol, baseAsset: row.baseAsset, quoteAsset: "USDT",
                quoteVolume: ticker.quoteVolume, lastPrice: ticker.lastPrice,
                priceChangePercent: ticker.priceChangePercent,
                volumeRank: null, isCore, isFavorite: isCore || favoriteSet.has(symbol),
                isTopMarket: false, source
            });
        });

        eligible.sort((a, b) => b.quoteVolume - a.quoteVolume ||
            a.symbol.localeCompare(b.symbol));
        eligible.forEach((market, index) => { market.volumeRank = index + 1; });
        const bySymbol = new Map(eligible.map(market => [market.symbol, market]));
        const cores = HND_MARKET_CORE_SYMBOLS.map(symbol => {
            const market = bySymbol.get(symbol);
            return market ? { ...market, isCore: true, isFavorite: true }
                : coreMarkets(source).find(item => item.symbol === symbol);
        });
        const dynamic = eligible.filter(market => !market.isCore)
            .slice(0, HND_MARKET_TOP_LIMIT)
            .map(market => ({ ...market, isTopMarket: true }));
        const included = new Set([...cores, ...dynamic].map(market => market.symbol));
        const extraFavorites = [...favoriteSet].sort().map(symbol => bySymbol.get(symbol))
            .filter(market => market && !included.has(market.symbol))
            .map(market => ({ ...market, isFavorite: true, isTopMarket: false }));
        const markets = [...cores, ...dynamic, ...extraFavorites];
        counts.coreMarkets = cores.length;
        counts.topMarkets = dynamic.length;
        counts.userFavorites = [...favoriteSet].filter(symbol => bySymbol.has(symbol) &&
            !HND_MARKET_CORE_SYMBOLS.includes(symbol)).length;
        counts.totalMarkets = markets.length;
        return { markets, counts };
    }

    function normalizeCachedMarket(row, source) {
        const symbol = normalizeSymbol(row?.symbol);
        const baseAsset = normalizeSymbol(row?.baseAsset);
        const quoteVolume = Number(row?.quoteVolume);
        const lastPrice = Number(row?.lastPrice);
        const priceChangePercent = row?.priceChangePercent === null ? null
            : Number(row?.priceChangePercent);
        if (!symbol || !baseAsset || row?.quoteAsset !== "USDT" ||
            !Number.isFinite(quoteVolume) || quoteVolume < 0 ||
            !Number.isFinite(lastPrice) || lastPrice < 0 ||
            (priceChangePercent !== null && !Number.isFinite(priceChangePercent))) return null;
        return {
            symbol, baseAsset, quoteAsset: "USDT", quoteVolume, lastPrice,
            priceChangePercent, volumeRank: Number.isInteger(row.volumeRank) &&
                row.volumeRank > 0 ? row.volumeRank : null,
            isCore: HND_MARKET_CORE_SYMBOLS.includes(symbol),
            isFavorite: HND_MARKET_CORE_SYMBOLS.includes(symbol) || userFavorites.includes(symbol),
            isTopMarket: row.isTopMarket === true, source
        };
    }

    function safeStorageGet(key) {
        try { return window.localStorage.getItem(key); }
        catch (error) { storageAvailable = false; return null; }
    }

    function safeStorageSet(key, value) {
        try { window.localStorage.setItem(key, value); return true; }
        catch (error) { storageAvailable = false; return false; }
    }

    function loadFavorites() {
        const raw = safeStorageGet(HND_MARKET_FAVORITES_KEY);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) throw new TypeError("Invalid favorites");
            return [...new Set(parsed.map(normalizeSymbol).filter(symbol => symbol &&
                !HND_MARKET_CORE_SYMBOLS.includes(symbol)))].sort()
                .slice(0, HND_MARKET_MAX_USER_FAVORITES);
        } catch (error) { return []; }
    }

    function loadCache() {
        const raw = safeStorageGet(HND_MARKET_CATALOG_CACHE_KEY);
        if (!raw) return null;
        try {
            const payload = JSON.parse(raw);
            if (!payload || payload.schemaVersion !== HND_MARKET_CATALOG_SCHEMA_VERSION ||
                payload.catalogVersion !== HND_MARKET_CATALOG_VERSION ||
                !Number.isFinite(payload.updatedAt) || !Array.isArray(payload.markets)) {
                throw new TypeError("Invalid cache");
            }
            const age = Date.now() - payload.updatedAt;
            if (age < 0 || age > HND_MARKET_STALE_CACHE_MAX_AGE_MS) return null;
            const source = age <= HND_MARKET_CACHE_TTL_MS ? "CACHE" : "STALE_CACHE";
            const markets = payload.markets.map(row => normalizeCachedMarket(row, source))
                .filter(Boolean);
            if (!HND_MARKET_CORE_SYMBOLS.every(symbol =>
                markets.some(market => market.symbol === symbol))) throw new TypeError("Invalid cache");
            return { markets, updatedAt: payload.updatedAt, age, source };
        } catch (error) {
            recordEvaluation(HND_MARKET_CATALOG_DEBUG_REASONS.INVALID_CACHE_PAYLOAD);
            return null;
        }
    }

    function cacheSafeMarkets(markets) {
        return markets.map(market => ({
            symbol: market.symbol, baseAsset: market.baseAsset, quoteAsset: market.quoteAsset,
            quoteVolume: market.quoteVolume, lastPrice: market.lastPrice,
            priceChangePercent: market.priceChangePercent, volumeRank: market.volumeRank,
            isCore: market.isCore, isFavorite: market.isFavorite,
            isTopMarket: market.isTopMarket, source: "CACHE"
        }));
    }

    function isUsableCatalogFallback(snapshot, now = Date.now()) {
        if (!snapshot || typeof snapshot !== "object" ||
            !Array.isArray(snapshot.markets) ||
            !["NETWORK", "CACHE", "STALE_CACHE"].includes(snapshot.source) ||
            !Number.isFinite(snapshot.cacheUpdatedAt) || snapshot.cacheUpdatedAt <= 0 ||
            !Number.isFinite(now)) return false;
        const age = now - snapshot.cacheUpdatedAt;
        if (age < 0 || age > HND_MARKET_STALE_CACHE_MAX_AGE_MS) return false;
        const symbols = snapshot.markets.map(market => normalizeSymbol(market?.symbol));
        if (symbols.some(symbol => !symbol) || new Set(symbols).size !== symbols.length) {
            return false;
        }
        return HND_MARKET_CORE_SYMBOLS.every(symbol => symbols.includes(symbol));
    }

    function updateVisibleMarkets() {
        const query = searchQuery.toUpperCase();
        visibleMarkets = !query ? allMarkets.map(market => ({ ...market }))
            : allMarkets.filter(market => market.symbol.includes(query) ||
                market.baseAsset.includes(query)).map(market => ({ ...market }));
    }

    function createDebug(reason, counts = null, request = null) {
        const cacheAgeMs = Number.isFinite(cacheUpdatedAt) ? Date.now() - cacheUpdatedAt : null;
        return {
            version: HND_MARKET_CATALOG_VERSION,
            schemaVersion: HND_MARKET_CATALOG_SCHEMA_VERSION,
            primaryReason: reason,
            request: {
                exchangeInfoAttempted: request?.exchangeInfoAttempted === true,
                tickerAttempted: request?.tickerAttempted === true,
                primaryHostUsed: request?.primaryHostUsed ?? null,
                fallbackHostUsed: request?.fallbackHostUsed === true,
                durationMs: request?.durationMs ?? null,
                errorName: request?.errorName ?? null,
                errorMessage: request?.errorMessage ?? null
            },
            source: { catalogSource, stale: catalogStale, cacheAgeMs,
                cacheUpdatedAt },
            counts: { ...emptyCounts(), ...(counts || {}),
                userFavorites: userFavorites.length, totalMarkets: allMarkets.length,
                visibleMarkets: visibleMarkets.length },
            selection: { selectedSymbol, searchQuery,
                selectedPreserved: allMarkets.some(market => market.symbol === selectedSymbol) },
            evaluatedAt: Date.now()
        };
    }

    function recordEvaluation(reason, counts, request) {
        lastEvaluation = { debug: createDebug(reason, counts, request) };
        return lastEvaluation;
    }

    function statusText() {
        if (!initialized && catalogSource === "CORE_ONLY") return "Marketler yükleniyor";
        const count = allMarkets.length;
        if (catalogSource === "CACHE") return `${count} market • cache`;
        if (catalogSource === "STALE_CACHE") return `${count} market • eski cache`;
        if (catalogSource === "CORE_ONLY") return `${count} market • çevrimdışı`;
        return `${count} market`;
    }

    function appendGroup(select, label, markets, used) {
        const unique = markets.filter(market => !used.has(market.symbol));
        if (!unique.length) return;
        const group = document.createElement("optgroup");
        group.label = label;
        unique.forEach(market => {
            used.add(market.symbol);
            const option = document.createElement("option");
            option.value = market.symbol;
            option.textContent = market.symbol;
            group.appendChild(option);
        });
        select.appendChild(group);
    }

    function render() {
        updateVisibleMarkets();
        if (typeof document === "undefined") return;
        const select = document.getElementById("coinSelect");
        const status = document.getElementById("marketCatalogStatus");
        const button = document.getElementById("favoriteMarketButton");
        if (status) status.textContent = statusText();
        if (select) {
            const used = new Set();
            const shown = visibleMarkets;
            const core = shown.filter(market => market.isCore);
            const favorites = shown.filter(market => !market.isCore && market.isFavorite);
            const top = shown.filter(market => !market.isCore && market.isTopMarket);
            select.replaceChildren();
            appendGroup(select, "SABİT", core, used);
            appendGroup(select, "FAVORİLER", favorites, used);
            appendGroup(select, "TOP 50 HACİM", top, used);
            const current = allMarkets.find(market => market.symbol === selectedSymbol);
            if (current && !used.has(current.symbol)) appendGroup(select, "MEVCUT MARKET", [current], used);
            if (used.has(selectedSymbol)) select.value = selectedSymbol;
        }
        if (button) {
            const core = HND_MARKET_CORE_SYMBOLS.includes(selectedSymbol);
            const favorite = core || userFavorites.includes(selectedSymbol);
            button.textContent = favorite ? "★" : "☆";
            button.setAttribute("aria-pressed", String(favorite));
            button.disabled = core;
            button.title = core ? "Sabit market" : favorite
                ? "Favorilerden çıkar" : "Favorilere ekle";
            button.setAttribute("aria-label", button.title);
        }
    }

    function setupListeners() {
        if (listenersInitialized || typeof document === "undefined") return;
        const search = document.getElementById("marketSearch");
        const button = document.getElementById("favoriteMarketButton");
        search?.addEventListener("input", event => setSearchQuery(event.target.value));
        button?.addEventListener("click", () => toggleFavorite(selectedSymbol));
        listenersInitialized = true;
    }

    function refresh() {
        if (refreshPromise) return refreshPromise;
        const previousCatalogSnapshot = {
            markets: clone(allMarkets),
            source: catalogSource,
            stale: catalogStale,
            cacheUpdatedAt,
            selectedSymbol,
            searchQuery
        };
        const startedAt = Date.now();
        const request = {
            exchangeInfoAttempted: false, tickerAttempted: false,
            primaryHostUsed: null, fallbackHostUsed: false, durationMs: null,
            errorName: null, errorMessage: null
        };
        refreshPromise = (async () => {
            try {
                const api = window.HNDAPI;
                if (typeof api?.fetchSpotExchangeInfo !== "function" ||
                    typeof api?.fetchSpot24hrTickers !== "function") {
                    throw new Error("Market API unavailable");
                }
                request.exchangeInfoAttempted = true;
                const exchangeSymbols = await api.fetchSpotExchangeInfo({
                    timeoutMs: HND_MARKET_REQUEST_TIMEOUT_MS, silent: true
                });
                const exchangeMeta = api.getLastPublicRequestMeta?.();
                request.tickerAttempted = true;
                const tickers = await api.fetchSpot24hrTickers({
                    timeoutMs: HND_MARKET_REQUEST_TIMEOUT_MS, silent: true
                });
                const tickerMeta = api.getLastPublicRequestMeta?.();
                request.primaryHostUsed = tickerMeta?.host || exchangeMeta?.host || null;
                request.fallbackHostUsed = exchangeMeta?.fallbackHostUsed === true ||
                    tickerMeta?.fallbackHostUsed === true;
                request.durationMs = Date.now() - startedAt;
                const result = buildDynamicMarketCatalog(
                    exchangeSymbols, tickers, userFavorites, "NETWORK"
                );
                allMarkets = result.markets;
                catalogSource = "NETWORK";
                catalogStale = false;
                cacheUpdatedAt = Date.now();
                lastNetworkRefreshAt = cacheUpdatedAt;
                safeStorageSet(HND_MARKET_CATALOG_CACHE_KEY, JSON.stringify({
                    schemaVersion: HND_MARKET_CATALOG_SCHEMA_VERSION,
                    catalogVersion: HND_MARKET_CATALOG_VERSION,
                    updatedAt: cacheUpdatedAt,
                    markets: cacheSafeMarkets(allMarkets)
                }));
                render();
                recordEvaluation(HND_MARKET_CATALOG_DEBUG_REASONS.NETWORK_CATALOG_LOADED,
                    result.counts, request);
                return getState();
            } catch (error) {
                request.durationMs = Date.now() - startedAt;
                request.errorName = String(error?.name || "Error");
                request.errorMessage = String(error?.message || "Market data unavailable").slice(0, 300);
                if (isUsableCatalogFallback(previousCatalogSnapshot)) {
                    allMarkets = clone(previousCatalogSnapshot.markets).map(market => ({
                        ...market,
                        source: "STALE_CACHE"
                    }));
                    catalogSource = "STALE_CACHE";
                    catalogStale = true;
                    cacheUpdatedAt = previousCatalogSnapshot.cacheUpdatedAt;
                    selectedSymbol = previousCatalogSnapshot.selectedSymbol;
                    searchQuery = previousCatalogSnapshot.searchQuery;
                } else {
                    allMarkets = coreMarkets("CORE_ONLY");
                    catalogSource = "CORE_ONLY";
                    catalogStale = false;
                    cacheUpdatedAt = null;
                }
                render();
                recordEvaluation(HND_MARKET_CATALOG_DEBUG_REASONS.NETWORK_REFRESH_FAILED,
                    null, request);
                return getState();
            } finally { refreshPromise = null; }
        })();
        return refreshPromise;
    }

    function init(options = {}) {
        if (initialized) return refreshPromise || Promise.resolve(getState());
        selectedSymbol = normalizeSymbol(options.selectedSymbol) || selectedSymbol;
        allMarkets = coreMarkets("CORE_ONLY");
        userFavorites = loadFavorites();
        setupListeners();
        render();
        recordEvaluation(storageAvailable
            ? HND_MARKET_CATALOG_DEBUG_REASONS.CORE_MARKETS_RENDERED
            : HND_MARKET_CATALOG_DEBUG_REASONS.STORAGE_UNAVAILABLE);
        const cache = loadCache();
        initialized = true;
        if (cache) {
            allMarkets = cache.markets;
            catalogSource = cache.source;
            catalogStale = cache.source === "STALE_CACHE";
            cacheUpdatedAt = cache.updatedAt;
            render();
            recordEvaluation(cache.source === "CACHE"
                ? HND_MARKET_CATALOG_DEBUG_REASONS.CACHE_LOADED
                : HND_MARKET_CATALOG_DEBUG_REASONS.STALE_CACHE_LOADED);
            if (cache.source === "CACHE") return Promise.resolve(getState());
        }
        return refresh();
    }

    function getMarkets() { return clone(allMarkets); }
    function getVisibleMarkets() { return clone(visibleMarkets); }
    function getFavorites() { return [...userFavorites]; }
    function isFavorite(symbol) {
        const normalized = normalizeSymbol(symbol);
        return HND_MARKET_CORE_SYMBOLS.includes(normalized) || userFavorites.includes(normalized);
    }
    function isSupportedSymbol(symbol) {
        const normalized = normalizeSymbol(symbol);
        return allMarkets.some(market => market.symbol === normalized);
    }
    function setSelectedSymbol(symbol) {
        const normalized = normalizeSymbol(symbol);
        if (!normalized || !isSupportedSymbol(normalized)) return false;
        selectedSymbol = normalized;
        render();
        return true;
    }
    function setSearchQuery(query) {
        searchQuery = String(query || "").trim();
        render();
        recordEvaluation(HND_MARKET_CATALOG_DEBUG_REASONS.SEARCH_UPDATED);
        return getVisibleMarkets();
    }
    function toggleFavorite(symbol = selectedSymbol) {
        const normalized = normalizeSymbol(symbol);
        if (!normalized || !isSupportedSymbol(normalized)) return false;
        if (HND_MARKET_CORE_SYMBOLS.includes(normalized)) return true;
        let reason;
        if (userFavorites.includes(normalized)) {
            userFavorites = userFavorites.filter(item => item !== normalized);
            reason = HND_MARKET_CATALOG_DEBUG_REASONS.FAVORITE_REMOVED;
        } else {
            if (userFavorites.length >= HND_MARKET_MAX_USER_FAVORITES) {
                recordEvaluation(HND_MARKET_CATALOG_DEBUG_REASONS.FAVORITE_LIMIT_REACHED);
                render();
                return false;
            }
            userFavorites = [...userFavorites, normalized].sort();
            reason = HND_MARKET_CATALOG_DEBUG_REASONS.FAVORITE_ADDED;
        }
        allMarkets = allMarkets.map(market => ({ ...market,
            isFavorite: market.isCore || userFavorites.includes(market.symbol) }));
        safeStorageSet(HND_MARKET_FAVORITES_KEY, JSON.stringify(userFavorites));
        render();
        recordEvaluation(reason);
        return true;
    }
    function getLastDebug() { return clone(lastEvaluation?.debug || null); }
    function explainLastEvaluation() { return clone(lastEvaluation); }
    function getState() {
        return clone({
            version: HND_MARKET_CATALOG_VERSION,
            schemaVersion: HND_MARKET_CATALOG_SCHEMA_VERSION,
            initialized, source: catalogSource, stale: catalogStale,
            cacheUpdatedAt, lastNetworkRefreshAt, selectedSymbol, searchQuery,
            coreCount: allMarkets.filter(market => market.isCore).length,
            topMarketCount: allMarkets.filter(market => market.isTopMarket).length,
            favoriteCount: userFavorites.length, totalMarketCount: allMarkets.length,
            visibleMarketCount: visibleMarkets.length, favorites: userFavorites,
            markets: allMarkets, visibleMarkets, lastEvaluation
        });
    }

    window.HNDMarketCatalog = {
        init, refresh, getState, getMarkets, getVisibleMarkets, getFavorites,
        toggleFavorite, isFavorite, isSupportedSymbol, setSelectedSymbol,
        setSearchQuery, getLastDebug, explainLastEvaluation
    };
})();
