// ==========================
// TradeAI Main Engine
// ==========================

let currentCoin = "BTCUSDT";
let currentInterval = "15m";
let engineRunning = false;

// TradingView
function initTradingView() {
    if (
        !window.TradingView ||
        typeof window.TradingView.widget !== "function"
    ) {
        console.warn("TradingView is unavailable; the data engine will continue without the chart.");
        return;
    }

    try {
        new window.TradingView.widget({
            autosize: true,
            symbol: "BINANCE:" + currentCoin,
            interval: "15",
            timezone: "Etc/UTC",
            theme: "dark",
            style: "1",
            locale: "tr",
            container_id: "tvchart",
            hide_side_toolbar: false,
            allow_symbol_change: true
        });
    } catch (err) {
        console.warn("TradingView chart could not be initialized; the data engine will continue.", err);
    }
}

initTradingView();

// Ana Motor
async function startEngine() {

    if (engineRunning) return;

    engineRunning = true;

    try {

    // Binance verilerini çek
    const loadedCandles = await fetchCandles(currentCoin, currentInterval);

    if (!Array.isArray(loadedCandles) || loadedCandles.length < 200) {
        console.error("Engine stopped: at least 200 valid candles are required");
        return;
    }

    // Canlı fiyat
    const price = await fetchPrice(currentCoin);

    if (!Number.isFinite(price) || price <= 0) {
        console.error("Engine stopped: invalid price", price);
        return;
    }

    // Analiz yap
    const result = analyzeMarket();

    // Trade yoksa aç
    if (!activeTrade && result.signal !== "WAIT") {

        openTrade(result.signal, price);

    }

    // Trade varsa kontrol et
    checkTrade(price);

    // Arayüzü güncelle
    updateUI(result, price);

    } finally {
        engineRunning = false;
    }

}

drawOrderBlock();

drawFVG();

drawLiquiditySweep();


// İlk çalıştır
startEngine();

// Her 5 saniyede güncelle
setInterval(startEngine, 5000);
