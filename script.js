// ==========================
// TradeAI Main Engine
// ==========================

let currentCoin = "BTCUSDT";
let currentInterval = "15m";

// TradingView
new TradingView.widget({
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

// Ana Motor
async function startEngine() {

    // Binance verilerini çek
    await fetchCandles(currentCoin, currentInterval);

    // Canlı fiyat
    const price = await fetchPrice(currentCoin);

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

}

drawOrderBlock(chart);

// İlk çalıştır
startEngine();

// Her 5 saniyede güncelle
setInterval(startEngine, 5000);
