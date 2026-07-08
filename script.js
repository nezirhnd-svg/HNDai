// Trade State

let activeTrade = null;

let entryPrice = null;

let stopLoss = null;

let takeProfit = null;

let tradeOpen = false;
// ==============================
// TradeAI Pro - Script v1
// ==============================

let currentCoin = "BTCUSDT";
// =========================
// TRADE ENGINE
// =========================

let activeTrade = null;

let tradeOpen = false;

let entryPrice = 0;

let stopLoss = 0;

let takeProfit = 0;

let tradeSide = "";
let currentInterval = "15";

// TradingView Grafik
function loadChart() {
    document.getElementById("tvchart").innerHTML = "";

    new TradingView.widget({
        autosize: true,
        symbol: "BINANCE:" + currentCoin,
        interval: currentInterval,
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "tr",
        container_id: "tvchart",
        hide_side_toolbar: false,
        allow_symbol_change: false,
        save_image: false
    });
}

// Binance Canlı Fiyat
async function updatePrice() {
    try {
        const res = await fetch(
            `https://api.binance.com/api/v3/ticker/price?symbol=${currentCoin}`
        );

        const data = await res.json();
        const price = parseFloat(data.price);

        document.getElementById("entry").innerText = price.toFixed(2);
        document.getElementById("sl").innerText = (price * 0.99).toFixed(2);
        document.getElementById("tp").innerText = (price * 1.02).toFixed(2);

    } catch (e) {
        console.error(e);
    }
}

// Demo AI
function updateSignal() {

    const rnd = Math.random();

    if (rnd > 0.66) {
        signal.innerText = "LONG";
        signal.style.color = "#22c55e";
        confidence.innerText = "91%";
    }
    else if (rnd < 0.33) {
        signal.innerText = "SHORT";
        signal.style.color = "#ef4444";
        confidence.innerText = "88%";
    }
    else {
        signal.innerText = "WAIT";
        signal.style.color = "#facc15";
        confidence.innerText = "53%";
    }

    bos.innerText = "Bullish";
    choch.innerText = "-";
    ob.innerText = "Detected";
    fvg.innerText = "Open";
    liq.innerText = "Above";

    ema20.innerText = "-";
    ema50.innerText = "-";
    ema200.innerText = "-";
    rsi.innerText = "-";
    macd.innerText = "-";
}

// Coin değiştir
coinSelect.addEventListener("change", () => {

    currentCoin = coinSelect.value;

    loadChart();

    updatePrice();
    async function getCandles() {

    const res = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${currentCoin}&interval=${currentInterval}m&limit=250`
    );

    const data = await res.json();

    return data.map(c => Number(c[4]));

}
function EMA(values, period) {

    const k = 2 / (period + 1);

    let ema = values[0];

    for (let i = 1; i < values.length; i++) {

        ema = values[i] * k + ema * (1 - k);

    }

    return ema;

}
});

// Timeframe değiştir
timeframe.addEventListener("change", () => {

    currentInterval = timeframe.value;

    loadChart();

});

// Başlat
loadChart();
updatePrice();
updateSignal();

setInterval(() => {

    updatePrice();

    updateSignal();

},5000);
async function analyzeMarket() {

    const prices = await getCandles();

    const ema20 = EMA(prices,20);

    const ema50 = EMA(prices,50);

    if(tradeOpen) return;

    if(ema20 > ema50){

        openTrade("LONG");

    }

    if(ema20 < ema50){

        openTrade("SHORT");

    }

}
function openTrade(side){

    tradeOpen = true;

    tradeSide = side;

    entryPrice = Number(document.getElementById("entry").innerText);

    if(side=="LONG"){

        stopLoss = entryPrice * 0.99;

        takeProfit = entryPrice * 1.02;

    }else{

        stopLoss = entryPrice * 1.01;

        takeProfit = entryPrice * 0.98;

    }

    document.getElementById("signal").innerText = side;

    document.getElementById("entry").innerText = entryPrice.toFixed(2);

    document.getElementById("sl").innerText = stopLoss.toFixed(2);

    document.getElementById("tp").innerText = takeProfit.toFixed(2);

}
