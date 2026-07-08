let currentCoin = "BTCUSDT";
let currentInterval = "15";
let chart;
let currentCoin = "BTCUSDT";
let currentTimeframe = "15";

const coinSelect = document.getElementById("coinSelect");
const timeframe = document.getElementById("timeframe");
// TradingView Chart
function loadChart() {

document.getElementById("tvchart").innerHTML="";

chart = new TradingView.widget({
    autosize: true,
    symbol: "BINANCE:" + currentCoin,
   interval: currentTimeframe,
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "tr",
    container_id: "tvchart",
    hide_side_toolbar: false,
    allow_symbol_change: true
});

// Binance canlı fiyat
async function updatePrice() {
    try {
        const res = await fetch(
            `https://api.binance.com/api/v3/ticker/price?symbol=${currentCoin}`    
        );

        const data = await res.json();

        const price = Number(data.price);

        // Fiyat
        document.getElementById("entry").innerText = price.toFixed(2);

        // Basit TP / SL
        document.getElementById("sl").innerText =
            (price * 0.99).toFixed(2);

        document.getElementById("tp").innerText =
            (price * 1.02).toFixed(2);

        // Basit AI sinyali (örnek)
        const signal = Math.random();

        if (signal > 0.66) {
            document.getElementById("signal").innerText = "LONG";
            document.getElementById("signal").style.color = "#22c55e";
            document.getElementById("confidence").innerText =
                (80 + Math.random() * 20).toFixed(0) + "%";
        } else if (signal < 0.33) {
            document.getElementById("signal").innerText = "SHORT";
            document.getElementById("signal").style.color = "#ef4444";
            document.getElementById("confidence").innerText =
                (80 + Math.random() * 20).toFixed(0) + "%";
        } else {
            document.getElementById("signal").innerText = "WAIT";
            document.getElementById("signal").style.color = "#facc15";
            document.getElementById("confidence").innerText = "50%";
        }

    } catch (err) {
        console.error(err);
    }
}

updatePrice();
setInterval(updatePrice, 5000);
coinSelect.addEventListener("change", () => {

    currentCoin = coinSelect.value;

    location.reload();

});

timeframe.addEventListener("change", () => {

    currentTimeframe = timeframe.value;

    location.reload();

});
loadChart();
updatePrice();
setInterval(updatePrice,5000);
    document.getElementById("coinSelect").addEventListener("change",function(){

currentCoin=this.value;

loadChart();

updatePrice();

});
