// ==========================
// HNDai Trade Engine
// ==========================

let activeTrade = null;

// Trade Aç
function openTrade(signal, price) {

    if (activeTrade) return;

    activeTrade = {

        side: signal,

        entry: price,

        stopLoss:
            signal === "LONG"
                ? price * 0.99
                : price * 1.01,

        takeProfit:
            signal === "LONG"
                ? price * 1.02
                : price * 0.98,

        status: "OPEN",

        openedAt: new Date()

    };

}

// Trade Kontrol
function checkTrade(price) {

    if (!activeTrade) return;

    if (activeTrade.side === "LONG") {

        // TP
        if (price >= activeTrade.takeProfit) {

            activeTrade.status = "TP";

            activeTrade = null;

            return;

        }

        // SL
        if (price <= activeTrade.stopLoss) {

            activeTrade.status = "SL";

            activeTrade = null;

            return;

        }

    } else {

        // TP
        if (price <= activeTrade.takeProfit) {

            activeTrade.status = "TP";

            activeTrade = null;

            return;

        }

        // SL
        if (price >= activeTrade.stopLoss) {

            activeTrade.status = "SL";

            activeTrade = null;

            return;

        }

    }

}
