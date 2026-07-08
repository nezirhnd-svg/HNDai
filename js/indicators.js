// ==========================
// Indicators Module
// ==========================

// EMA
function EMA(prices, period) {

    if (prices.length < period) return 0;

    const k = 2 / (period + 1);

    let ema = prices[0];

    for (let i = 1; i < prices.length; i++) {

        ema = prices[i] * k + ema * (1 - k);

    }

    return ema;

}

// RSI
function RSI(prices, period = 14) {

    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length; i++) {

        const diff = prices[i] - prices[i - 1];

        if (diff >= 0)
            gains += diff;
        else
            losses -= diff;

    }

    if (losses === 0) return 100;

    const rs = gains / losses;

    return 100 - (100 / (1 + rs));

}

// SMA
function SMA(prices, period) {

    if (prices.length < period) return 0;

    const slice = prices.slice(-period);

    return slice.reduce((a, b) => a + b, 0) / period;

}

// Volume Average
function AverageVolume(volumes, period = 20) {

    if (volumes.length < period) return 0;

    const slice = volumes.slice(-period);

    return slice.reduce((a, b) => a + b, 0) / period;

}
